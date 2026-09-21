/** Rendering of history rows for the export buttons. */

export interface ExportRow {
  raw_text: string;
  processed_text: string;
  mode: string;
  language: string;
  created_at: string;
}

/**
 * RFC 4180 field quoting: wrap when the value holds a comma, quote or newline,
 * and double any embedded quote. Transcripts routinely contain all three, so a
 * plain join would corrupt the file.
 */
function cell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function historyToCsv(rows: ExportRow[]): string {
  return [
    "created_at,mode,language,raw_text,processed_text",
    ...rows.map((r) =>
      [r.created_at, r.mode, r.language, r.raw_text, r.processed_text].map(cell).join(","),
    ),
  ].join("\n");
}

export function historyToText(rows: ExportRow[]): string {
  return rows.map((r) => r.processed_text || r.raw_text).join("\n");
}
