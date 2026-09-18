const MAX_CSV_ROWS = 1_000;
const MAX_CSV_CELL_BYTES = 4_096;

export type BomCsvValidation = { readonly ok: true } | { readonly ok: false; readonly error: "invalid_csv" };

// RFC4180 quote placement, not just balanced-quote counting: a `"` is only
// legal as the very first character of a field (opening a quoted field), or
// doubled inside one (an escaped literal quote). A bare quote anywhere else
// - mid unquoted field, or trailing content after a field's closing quote -
// is malformed and must be rejected here, not silently unwound by
// sanitizeBomCsv's parser (which would otherwise just drop the stray quote
// characters and merge the field around them).
function isCsvRow(row: string): boolean {
  const n = row.length;
  let columns = 1;
  let i = 0;
  for (;;) {
    if (row[i] === '"') {
      i++;
      for (;;) {
        if (i >= n) return false; // unterminated quoted field
        if (row[i] === '"') {
          if (row[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      if (i < n && row[i] !== ",") return false; // junk after the closing quote
    } else {
      while (i < n && row[i] !== ",") {
        if (row[i] === '"') return false; // quote not at the start of a field
        i++;
      }
    }
    if (i >= n) break;
    columns++;
    i++;
  }
  return columns >= 2;
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
