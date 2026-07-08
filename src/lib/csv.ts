/**
 * CSV export — one pure serializer + one browser download helper.
 *
 * `toCSV` is RFC 4180: a field containing a comma, a double-quote, or a newline is
 * wrapped in double-quotes and its internal quotes are doubled; everything else is
 * emitted bare. It is pure (no DOM), so it is unit-tested directly and reused by
 * every "Export CSV" across the console (usage, audit, logs, billing) — ONE
 * serializer, no per-view reimplementation.
 *
 * `downloadCSV` is the browser side: it builds a text/csv Blob and clicks a
 * synthetic <a download>. It no-ops on the server (SSR has no document), so a
 * component can call it unconditionally.
 */

/** Coerce one cell to its CSV text (null/undefined → empty; numbers via String). */
const cell = (v: string | number | boolean | null | undefined): string => {
  if (v === null || v === undefined) return ''
  return String(v)
}

/** Quote a field iff it contains a comma, a double-quote, or a newline (RFC 4180). */
const escapeField = (s: string): string =>
  /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s

/**
 * Serialize a header row + data rows to a CSV string. Rows shorter than the header
 * are padded with empty cells; longer rows are emitted in full (never truncated —
 * losing a column silently would corrupt an export). Lines are CRLF-joined per the
 * spec so Excel and Numbers both parse cleanly.
 */
export function toCSV(headers: string[], rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  const head = headers.map((h) => escapeField(cell(h))).join(',')
  const body = rows.map((row) => {
    const cells: string[] = []
    const n = Math.max(headers.length, row.length)
    for (let i = 0; i < n; i++) cells.push(escapeField(cell(row[i])))
    return cells.join(',')
  })
  return [head, ...body].join('\r\n')
}

/**
 * Trigger a client-side download of `csv` as `filename`. No-op on the server.
 * A BOM is prepended so spreadsheet apps detect UTF-8 (keeps non-ASCII labels
 * intact). The object URL is revoked after the click so the blob is not leaked.
 */
export function downloadCSV(filename: string, csv: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Convenience: serialize + download in one call. */
export function exportCSV(
  filename: string,
  headers: string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>,
): void {
  downloadCSV(filename, toCSV(headers, rows))
}
