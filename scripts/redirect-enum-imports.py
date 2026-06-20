#!/usr/bin/env python3
"""Redirect former-Prisma-enum imports away from @prisma/client.

The 32 enums no longer exist in the generated Prisma client (the columns are
now `String` on SQLite). They are re-exported from the package barrel via
packages/shared/src/db-enums.ts. Any module importing one of these names from
`@prisma/client` would get `undefined` (value) or a missing type, so rewrite
those imports to pull the enum from the canonical shim:

- files under packages/shared/src/**  -> a relative import of `db-enums`
- files under web/** and worker/**     -> `@hanzo/console`

Non-enum names in the same import (PrismaClient, Prisma, etc.) stay on
`@prisma/client`. `type`-only qualifiers are preserved.
"""

import os
import re
import sys

ENUMS = {
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
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARED_SRC = os.path.join(ROOT, "packages", "shared", "src")

IMPORT_RE = re.compile(
    r'^import\s+\{(?P<body>[^}]*)\}\s+from\s+["\']@prisma/client["\'];?\s*$'
)


def split_member(m: str):
    """Return (is_type, name) for an import specifier like 'type Foo' or 'Foo'."""
    m = m.strip()
    if not m:
        return None
    parts = m.split()
    if len(parts) == 2 and parts[0] == "type":
        return (True, parts[1])
    return (False, m)


def shim_source_for(path: str) -> str:
    """Where this file should import the enums from."""
    if path.startswith(SHARED_SRC + os.sep):
        rel = os.path.relpath(os.path.join(SHARED_SRC, "db-enums"), os.path.dirname(path))
        if not rel.startswith("."):
            rel = "./" + rel
        return rel.replace(os.sep, "/")
    return "@hanzo/console"


def process(path: str) -> bool:
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()

    changed = False
    out = []
    for line in lines:
        m = IMPORT_RE.match(line.rstrip("\n"))
        if not m:
            out.append(line)
            continue

        members = [split_member(x) for x in m.group("body").split(",")]
        members = [x for x in members if x]
        enum_members = [(t, n) for (t, n) in members if n in ENUMS]
        other_members = [(t, n) for (t, n) in members if n not in ENUMS]

        if not enum_members:
            out.append(line)
            continue

        changed = True
        # Keep non-enum names on @prisma/client (if any remain).
        if other_members:
            kept = ", ".join((f"type {n}" if t else n) for (t, n) in other_members)
            out.append(f'import {{ {kept} }} from "@prisma/client";\n')
        # Emit the enum names from the shim.
        enum_str = ", ".join((f"type {n}" if t else n) for (t, n) in enum_members)
        out.append(f'import {{ {enum_str} }} from "{shim_source_for(path)}";\n')

    if changed:
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(out)
    return changed


def main():
    files = sys.argv[1:]
    n = 0
    for path in files:
        if process(path):
            n += 1
            print("rewrote", os.path.relpath(path, ROOT))
    print(f"total files rewritten: {n}")


if __name__ == "__main__":
    main()
