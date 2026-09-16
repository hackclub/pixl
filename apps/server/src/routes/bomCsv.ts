const MAX_CSV_ROWS = 1_000;
const MAX_CSV_CELL_BYTES = 4_096;

export type BomCsvValidation = { readonly ok: true } | { readonly ok: false; readonly error: "invalid_csv" };

function isCsvRow(row: string): boolean {
  let quoted = false;
  let columns = 1;
  for (let index = 0; index < row.length; index++) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      columns++;
    }
  }
  return !quoted && columns >= 2;
}

export function validateBomCsv(buffer: Buffer): BomCsvValidation {
  if (buffer.length === 0 || buffer.includes(0)) return { ok: false, error: "invalid_csv" };

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { ok: false, error: "invalid_csv" };
  }
  const rows = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter((row) => row.trim());
  if (rows.length < 2 || rows.length > MAX_CSV_ROWS) return { ok: false, error: "invalid_csv" };
  if (rows.some((row) => Buffer.byteLength(row) > MAX_CSV_CELL_BYTES || !isCsvRow(row)))
    return { ok: false, error: "invalid_csv" };
  return { ok: true };
}
