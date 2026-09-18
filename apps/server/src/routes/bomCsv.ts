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

function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (quoted) {
      if (c === '"') {
        if (row[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

// A cell starting with =, +, -, or @ is a live formula to Excel/Sheets , same
// neutralization as the staff CSV export (apps/dashboard/app/api/projects/
// export/route.ts). Reviewers open a shipped BOM straight in a spreadsheet
// via the "Download BOM" link, so a player-uploaded CSV needs the same
// treatment before it's stored, not just data staff generate themselves.
function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /["\n,]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

// Assumes the buffer already passed validateBomCsv - only called after that.
export function sanitizeBomCsv(buffer: Buffer): Buffer {
  const text = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
  const rows = text.split(/\r\n|\n|\r/).filter((row) => row.trim());
  const sanitized = rows.map((row) => parseCsvRow(row).map(csvCell).join(",")).join("\r\n");
  return Buffer.from(sanitized, "utf-8");
}
