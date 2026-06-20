#!/usr/bin/env python3
"""One-shot transform of the Prisma schema from PostgreSQL to SQLite (Hanzo Base).

Idempotent-ish, but intended to run once against the committed Postgres schema.
- datasource: postgresql -> sqlite, drop directUrl/shadowDatabaseUrl
- remove all `enum {}` blocks (SQLite has no native enums; modelled as String,
  with the TS enum values preserved in packages/shared/src/db-enums.ts)
- enum-typed field declarations -> String, preserving ?/@default/@map
  (@default(VALUE) -> @default("VALUE"))
- scalar arrays (String[]/Int[]) -> String JSON columns, default JSON-encoded
- strip @db.Json/@db.JsonB/@db.Text/@db.VarChar(..)/@db.Char(..)
"""

import json
import re
import sys

SCHEMA = "packages/shared/prisma/schema.prisma"

ENUMS = [
    "ApiKeyScope", "Role", "LegacyPrismaObservationType",
    "LegacyPrismaObservationLevel", "LegacyPrismaScoreSource",
    "ScoreConfigDataType", "AnnotationQueueStatus", "AnnotationQueueObjectType",
    "DatasetStatus", "CommentObjectType", "NotificationChannel",
    "NotificationType", "AuditLogRecordType", "EvalTemplateType",
    "EvalTemplateSourceCodeLanguage", "JobType", "JobConfigState",
    "EvaluatorBlockReason", "JobExecutionStatus", "BlobStorageIntegrationFileType",
    "BlobStorageIntegrationType", "BlobStorageExportMode",
    "AnalyticsIntegrationExportSource", "DashboardWidgetViews",
    "DashboardWidgetChartType", "ActionType", "ActionExecutionStatus",
    "MonitorThresholdOperator", "MonitorView", "MonitorSeverity",
    "MonitorStatus", "SurveyName",
]
ENUM_SET = set(ENUMS)

# Per-value @map for SurveyName: the stored string differs from the member name.
SURVEY_MAP = {"ORG_ONBOARDING": "org_onboarding", "USER_ONBOARDING": "user_onboarding"}


def transform(text: str) -> str:
    lines = text.split("\n")
    out = []

    # ---- 1) datasource block ----
    # Replace the whole `datasource db { ... }` block.
    joined = "\n".join(lines)
    joined = re.sub(
        r'datasource db \{[^}]*\}',
        'datasource db {\n'
        '  provider = "sqlite"\n'
        '  url      = env("DATABASE_URL")\n'
        '}',
        joined,
        count=1,
    )
    lines = joined.split("\n")

    # ---- 2) drop enum blocks ----
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r'^enum\s+(\w+)\s*\{', line)
        if m:
            # skip until matching closing brace
            depth = line.count("{") - line.count("}")
            i += 1
            while i < len(lines) and depth > 0:
                depth += lines[i].count("{") - lines[i].count("}")
                i += 1
            # also swallow a single trailing blank line left behind
            if i < len(lines) and result and result[-1].strip() == "" and lines[i].strip() == "":
                i += 1
            continue
        result.append(line)
        i += 1
    lines = result

    # ---- 3) field-level rewrites ----
    field_re = re.compile(
        r'^(?P<indent>\s+)(?P<name>\w+)\s+(?P<type>\w+)(?P<opt>\?|\[\])?(?P<rest>\s.*)?$'
    )

    new_lines = []
    for line in lines:
        fm = field_re.match(line)
        if not fm:
            # still strip @db.* attributes on any stray line
            new_lines.append(strip_db_attrs(line))
            continue

        indent = fm.group("indent")
        name = fm.group("name")
        typ = fm.group("type")
        opt = fm.group("opt") or ""
        rest = fm.group("rest") or ""

        # 3a) enum-typed scalar field -> String
        if typ in ENUM_SET and opt != "[]":
            rest2 = quote_enum_defaults(rest)
            line = f"{indent}{name} String{opt}{rest2}"
            new_lines.append(strip_db_attrs(line))
            continue

        # 3b) scalar array (String[]/Int[]) -> String JSON column
        if opt == "[]" and typ in ("String", "Int", "Float", "Boolean", "BigInt", "DateTime", "Decimal", "Bytes", "Json"):
            rest2 = json_encode_array_default(rest)
            # ensure a default exists so inserts without the field still work
            if "@default(" not in rest2:
                # insert default after the type, before any other attrs/comment
                rest2 = rest2.lstrip()
                prefix = ' @default("[]")'
                rest2 = f"{prefix} {rest2}".rstrip() if rest2 else prefix
            line = f"{indent}{name} String{rest2}"
            new_lines.append(line)
            continue

        # 3c) plain field: strip @db.* attrs
        new_lines.append(strip_db_attrs(line))

    return "\n".join(new_lines)


def strip_db_attrs(line: str) -> str:
    # Remove @db.Json @db.JsonB @db.Text @db.VarChar(n) @db.Char(n) etc.
    line = re.sub(r'\s*@db\.\w+(\([^)]*\))?', '', line)
    return line


def quote_enum_defaults(rest: str) -> str:
    # @default(PROJECT) -> @default("PROJECT")  (skip @default(now()), [], dbgenerated, etc.)
    def repl(m):
        val = m.group(1).strip()
        if val == "" or val.endswith(")") or val.startswith("[") or val.startswith('"'):
            return m.group(0)
        if re.match(r'^[A-Z][A-Z0-9_]*$', val):
            return f'@default("{val}")'
        return m.group(0)

    return re.sub(r'@default\(([^)]*)\)', repl, rest)


def json_encode_array_default(rest: str) -> str:
    # @default([]) -> @default("[]"); @default(["NEW"]) -> @default("[\"NEW\"]")
    def repl(m):
        inner = m.group(1).strip()
        if not inner.startswith("["):
            return m.group(0)
        # parse the Prisma array literal into JSON text
        try:
            # Prisma uses ["a", "b"] / [] — valid JSON already for string arrays.
            parsed = json.loads(inner)
        except json.JSONDecodeError:
            # fall back: empty
            parsed = []
        encoded = json.dumps(parsed, separators=(", ", ": "))
        escaped = encoded.replace("\\", "\\\\").replace('"', '\\"')
        return f'@default("{escaped}")'

    return re.sub(r'@default\((\[[^\]]*\])\)', repl, rest)


def main():
    with open(SCHEMA, encoding="utf-8") as f:
        text = f.read()
    new = transform(text)
    with open(SCHEMA, "w", encoding="utf-8") as f:
        f.write(new)
    print("transform applied")


if __name__ == "__main__":
    main()
