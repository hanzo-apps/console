import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { tableColumnsToSqlFilter, datetimeFilterToPrismaSql } from "./filterToPrisma";
import { promptsTableCols } from "../tableDefinitions/promptsTable";
import type { FilterState } from "../types";

// These tests pin the SQLite dialect emitted by the application-database filter
// translator. The application DB is SQLite (Hanzo Base), so the generated SQL
// must never contain Postgres-only constructs (ILIKE, `::` casts, ARRAY[...],
// `&&`/`@>` array operators, `->>`/`->` JSON operators).
const POSTGRES_ONLY = [/\bILIKE\b/i, /::/, /\bARRAY\s*\[/i, /->>/, /(^|[^&])&&([^&]|$)/, /@>/, /<@/];

function render(filters: FilterState): string {
  const sql = tableColumnsToSqlFilter(filters, promptsTableCols, "prompts");
  return sql.sql;
}

function assertNoPostgresOnly(sql: string) {
  for (const pattern of POSTGRES_ONLY) {
    expect(sql, `SQL must not contain Postgres-only syntax matching ${pattern}: ${sql}`).not.toMatch(pattern);
  }
}

describe("tableColumnsToSqlFilter (SQLite dialect)", () => {
  it("uses LIKE (not ILIKE) for string contains", () => {
    const sql = render([{ type: "string", column: "name", operator: "contains", value: "abc" }]);
    expect(sql).toMatch(/\bLIKE\b/);
    assertNoPostgresOnly(sql);
  });

  it("wraps wildcards for contains / starts with / ends with", () => {
    const cont = tableColumnsToSqlFilter(
      [{ type: "string", column: "name", operator: "contains", value: "abc" }],
      promptsTableCols,
      "prompts",
    );
    expect(cont.values).toContain("%abc%");

    const starts = tableColumnsToSqlFilter(
      [{ type: "string", column: "name", operator: "starts with", value: "abc" }],
      promptsTableCols,
      "prompts",
    );
    expect(starts.values).toContain("abc%");

    const ends = tableColumnsToSqlFilter(
      [{ type: "string", column: "name", operator: "ends with", value: "abc" }],
      promptsTableCols,
      "prompts",
    );
    expect(ends.values).toContain("%abc");
  });

  it("emits NOT LIKE for does-not-contain", () => {
    const sql = render([{ type: "string", column: "name", operator: "does not contain", value: "abc" }]);
    expect(sql).toMatch(/NOT\s+LIKE/);
    assertNoPostgresOnly(sql);
  });

  it("uses IN / NOT IN for stringOptions", () => {
    const anyOf = render([{ type: "stringOptions", column: "type", operator: "any of", value: ["text", "chat"] }]);
    expect(anyOf).toMatch(/\bIN\b/);
    assertNoPostgresOnly(anyOf);

    const noneOf = render([{ type: "stringOptions", column: "type", operator: "none of", value: ["text"] }]);
    expect(noneOf).toMatch(/NOT\s+IN/);
    assertNoPostgresOnly(noneOf);
  });

  it("uses json_each for arrayOptions overlap / containment, never ARRAY[] or && / @>", () => {
    const anyOf = render([{ type: "arrayOptions", column: "tags", operator: "any of", value: ["a", "b"] }]);
    expect(anyOf).toMatch(/json_each/);
    expect(anyOf).toMatch(/EXISTS/);
    assertNoPostgresOnly(anyOf);

    const allOf = render([{ type: "arrayOptions", column: "tags", operator: "all of", value: ["a", "b"] }]);
    expect(allOf).toMatch(/json_each/);
    expect(allOf).toMatch(/COUNT\(DISTINCT value\)/);
    assertNoPostgresOnly(allOf);

    const noneOf = render([{ type: "arrayOptions", column: "tags", operator: "none of", value: ["a"] }]);
    expect(noneOf).toMatch(/NOT\s+EXISTS/);
    assertNoPostgresOnly(noneOf);
  });

  it("treats empty 'all of' as match-all and empty 'any of' as match-none", () => {
    expect(render([{ type: "arrayOptions", column: "tags", operator: "all of", value: [] }])).toContain("1 = 1");
    expect(render([{ type: "arrayOptions", column: "tags", operator: "any of", value: [] }])).toContain("1 = 0");
  });

  it("uses json_extract for stringObject/numberObject JSON paths, never ->>", () => {
    const strObjSql = tableColumnsToSqlFilter(
      [{ type: "stringObject", column: "config", key: "model", operator: "=", value: "gpt" }],
      promptsTableCols,
      "prompts",
    );
    expect(strObjSql.sql).toMatch(/json_extract/);
    // The JSON path is bound as a parameter (safer than inlining).
    expect(strObjSql.values).toContain("$.model");
    assertNoPostgresOnly(strObjSql.sql);

    const numObj = render([{ type: "numberObject", column: "config", key: "temp", operator: ">=", value: 1 }]);
    expect(numObj).toMatch(/json_extract/);
    expect(numObj).toMatch(/CAST\(json_extract/);
    assertNoPostgresOnly(numObj);
  });

  it("binds datetime as a parameter without Postgres timestamp casts", () => {
    const sql = tableColumnsToSqlFilter(
      [{ type: "datetime", column: "createdAt", operator: ">=", value: new Date("2024-01-01T00:00:00.000Z") }],
      promptsTableCols,
      "prompts",
    );
    expect(sql.sql).not.toMatch(/timestamp/i);
    assertNoPostgresOnly(sql.sql);
    expect(sql.values.some((v) => v instanceof Date)).toBe(true);
  });

  it("binds number filters without ::DOUBLE PRECISION casts", () => {
    const sql = render([{ type: "number", column: "version", operator: ">", value: 3 }]);
    expect(sql).not.toMatch(/double precision/i);
    assertNoPostgresOnly(sql);
  });

  it("datetimeFilterToPrismaSql binds a Date param and drops the timestamp cast", () => {
    const sql = datetimeFilterToPrismaSql('p."created_at"', ">=", new Date("2024-01-01T00:00:00.000Z"));
    expect(sql.sql).not.toMatch(/timestamp/i);
    expect(sql.values.some((v) => v instanceof Date)).toBe(true);
  });

  it("returns Prisma.empty for an empty filter list", () => {
    expect(tableColumnsToSqlFilter([], promptsTableCols, "prompts")).toBe(Prisma.empty);
  });
});
