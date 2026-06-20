import { Prisma } from "@prisma/client";
import { ColumnDefinition, type TableNames } from "../tableDefinitions";
import { FilterState } from "../types";
import { filterOperators, timeFilter } from "../interfaces/filters";
import { z } from "zod";
import { logger } from "./logger";

// SQLite (Hanzo Base) is the application database. SQLite `LIKE` is
// case-insensitive for ASCII by default, so it is the direct replacement for
// Postgres `ILIKE`. The former Postgres array columns (e.g. prompt
// tags/labels) are now JSON-TEXT columns, so array membership is expressed
// with `json_each(...)` instead of the Postgres array operators (`&&`, `@>`).
const operatorReplacements = {
  "any of": "IN",
  "none of": "NOT IN",
  contains: "LIKE",
  "does not contain": "NOT LIKE",
  "starts with": "LIKE",
  "ends with": "LIKE",
};

/**
 * SECURITY: This function must only be used, when all its inputs were verified with zod.
 */
export function tableColumnsToSqlFilterAndPrefix(
  filters: FilterState,
  tableColumns: ColumnDefinition[],
  table: TableNames,
): Prisma.Sql {
  const sql = tableColumnsToSqlFilter(filters, tableColumns, table);
  if (sql === Prisma.empty) {
    return Prisma.empty;
  }
  return Prisma.join([Prisma.raw("AND "), sql], "");
}

/**
 * SECURITY: This function must only be used, when all its inputs were verified with zod.
 * Converts filter state and table columns to a Prisma SQL filter (SQLite dialect).
 */
export function tableColumnsToSqlFilter(
  filters: FilterState,
  tableColumns: ColumnDefinition[],
  table: TableNames,
): Prisma.Sql {
  const internalFilters = filters.map((filter) => {
    // Get column definition to map column to internal name, e.g. "t.id"
    const col = tableColumns.find(
      (c) =>
        // TODO: Only use id instead of name
        c.name === filter.column || c.id === filter.column,
    );
    if (!col) {
      logger.error("Invalid filter column", filter.column);
      throw new Error("Invalid filter column: " + filter.column);
    }
    const colPrisma = Prisma.raw(col.internal);
    return {
      condition: filter,
      internalColumn: colPrisma,
      column: col,
      table: table,
    };
  });

  const statements = internalFilters.map((filterAndColumn) => {
    const filter = filterAndColumn.condition;
    const col = filterAndColumn.internalColumn;

    // Array membership against JSON-TEXT columns: handled wholesale because the
    // SQLite shape (json_each EXISTS) differs structurally from the other
    // operators (no single binary operator applies).
    if (filter.type === "arrayOptions") {
      return arrayOptionsCondition(col, filter.operator, filter.value);
    }

    switch (filter.type) {
      case "datetime": {
        // Prisma serializes a JS Date into a SQLite INTEGER (epoch ms), which
        // is exactly how DateTime columns are stored — bind it directly.
        const operator = Prisma.raw(filter.operator); // checked by zod
        return Prisma.sql`${col} ${operator} ${filter.value}`;
      }
      case "number": {
        const operator = Prisma.raw(filter.operator); // checked by zod
        return Prisma.sql`${col} ${operator} ${filter.value}`;
      }
      case "boolean": {
        const operator = Prisma.raw(filter.operator); // checked by zod
        return Prisma.sql`${col} ${operator} ${filter.value}`;
      }
      case "numberObject": {
        // JSON path read + numeric compare. json_extract returns the JSON
        // number; CAST to REAL keeps comparisons numeric.
        const operator = Prisma.raw(filter.operator); // checked by zod
        return Prisma.sql`CAST(json_extract(${col}, ${"$." + filter.key}) AS REAL) ${operator} ${filter.value}`;
      }
      case "stringObject": {
        const target = Prisma.sql`json_extract(${col}, ${"$." + filter.key})`;
        return stringCondition(target, filter.operator, filter.value);
      }
      case "string":
      case "stringOptions": {
        if (filter.type === "stringOptions") {
          const operator = Prisma.raw(operatorReplacements[filter.operator as keyof typeof operatorReplacements]);
          const values = Prisma.sql`(${Prisma.join(filter.value.map((v) => Prisma.sql`${v}`))})`;
          return Prisma.sql`${col} ${operator} ${values}`;
        }
        return stringCondition(col, filter.operator, filter.value);
      }
      case "categoryOptions":
        // LFE-4815: Support category options in postgres
        logger.warn("Category options not supported in the application database");
        throw new Error("Category options not supported in the application database");
      case "null":
        return Prisma.sql`${col} ${Prisma.raw(filter.operator)} `;
      case "positionInTrace":
        logger.warn("Position-in-trace filters are not supported in the application database");
        throw new Error("Position-in-trace filters not supported in the application database");
    }

    // Exhaustive switch above; this is unreachable but keeps the compiler happy.
    throw new Error("Unhandled filter type");
  });
  if (statements.length === 0) {
    return Prisma.empty;
  }
  // FOR SECURITY: We join the statements with " AND " to prevent SQL injection.
  // IF WE EVER CHANGE THIS, WE MUST ENSURE THAT USERS ONLY ACCESS THE DATA THEY ARE ALLOWED TO.
  // Example: Or condition on charts API on projectId would break this.
  return Prisma.join(statements, " AND ");
}

/**
 * Build a string comparison in the SQLite dialect. `contains`/`starts with`/
 * `ends with` map to `LIKE` with the wildcard wrapped around the bound value;
 * `=` is a plain equality. SQLite `LIKE` is ASCII case-insensitive, matching
 * Postgres `ILIKE` for ASCII text.
 */
function stringCondition(target: Prisma.Sql, operator: string, value: string): Prisma.Sql {
  switch (operator) {
    case "contains":
    case "does not contain": {
      const op = Prisma.raw(operatorReplacements[operator]);
      return Prisma.sql`${target} ${op} ${"%" + value + "%"}`;
    }
    case "starts with": {
      const op = Prisma.raw(operatorReplacements[operator]);
      return Prisma.sql`${target} ${op} ${value + "%"}`;
    }
    case "ends with": {
      const op = Prisma.raw(operatorReplacements[operator]);
      return Prisma.sql`${target} ${op} ${"%" + value}`;
    }
    default:
      // "=" and any other equality-style operator validated by zod.
      return Prisma.sql`${target} ${Prisma.raw(operator)} ${value}`;
  }
}

/**
 * Array membership against a JSON-TEXT column (former Postgres `String[]`).
 *  - "any of"  → the array shares at least one value with the filter (overlap)
 *  - "all of"  → the array contains every filter value (containment)
 *  - "none of" → the array shares no value with the filter
 */
function arrayOptionsCondition(col: Prisma.Sql, operator: string, values: string[]): Prisma.Sql {
  // "all of" with an empty selection is the UI's "waiting for selection" state:
  // it matches everything (no constraint).
  if (values.length === 0) {
    return operator === "all of" ? Prisma.sql`1 = 1` : Prisma.sql`1 = 0`;
  }
  const valueList = Prisma.sql`(${Prisma.join(values.map((v) => Prisma.sql`${v}`))})`;
  const overlap = Prisma.sql`EXISTS (SELECT 1 FROM json_each(${col}) WHERE value IN ${valueList})`;
  switch (operator) {
    case "any of":
      return overlap;
    case "none of":
      return Prisma.sql`NOT ${overlap}`;
    case "all of":
      // Every filter value must be present in the JSON array.
      return Prisma.sql`(SELECT COUNT(DISTINCT value) FROM json_each(${col}) WHERE value IN ${valueList}) = ${values.length}`;
    default:
      throw new Error("Unsupported array operator: " + operator);
  }
}

const dateOperators = filterOperators["datetime"];

export const datetimeFilterToPrismaSql = (
  safeColumn: string,
  operator: (typeof dateOperators)[number],
  value: Date,
) => {
  if (!dateOperators.includes(operator)) {
    throw new Error("Invalid operator: " + operator);
  }
  if (isNaN(value.getTime())) {
    throw new Error("Invalid date: " + value.toString());
  }

  // Bind the JS Date directly: Prisma serializes it to a SQLite INTEGER
  // (epoch ms), matching how DateTime columns are physically stored.
  return Prisma.sql`AND ${Prisma.raw(safeColumn)} ${Prisma.raw(operator)} ${value}`;
};

export const datetimeFilterToPrisma = (timestampFilter: z.infer<typeof timeFilter>) => {
  const prismaTimestampFilter =
    timestampFilter.operator === ">="
      ? { gte: timestampFilter.value }
      : timestampFilter.operator === ">"
        ? { gt: timestampFilter.value }
        : timestampFilter.operator === "<="
          ? { lte: timestampFilter.value }
          : timestampFilter.operator === "<"
            ? { lt: timestampFilter.value }
            : {};
  return prismaTimestampFilter;
};
