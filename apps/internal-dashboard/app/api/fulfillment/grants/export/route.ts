import { NextResponse } from "next/server";
import { guardedRoute } from "@/lib/guard";
import { grantCsv, selectGrantRows, type GrantExportRow } from "@/lib/grantExport";
import { loadGrantExportFiltered, parseGrantScope } from "@/lib/grantExportData";

export const dynamic = "force-dynamic";

function csvDownload(rows: GrantExportRow[], filename: string): NextResponse {
  return new NextResponse(grantCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// The download behind /fulfillment/grants. Owner-only because the file is a
// batch of buyer emails; guardedRoute writes the audit row. A plain GET also
// means the checkbox form doesn't need a CSRF-protected POST just to download
// a read-only file.
//
// ?ids=225&ids=402 narrows the file to the checked rows. The rows are re-read
// from the same owner-only loader and filtered server-side, so a stale checkbox
// or a hand-crafted id can never add a different order to the file.
export const GET = guardedRoute("api.fulfillment.grants_export", "owner", async (_access, request): Promise<NextResponse> => {
  const url = new URL(request.url);
  const scope = parseGrantScope(url.searchParams.get("scope"));
  const ids = new Set<number>();
  for (const raw of url.searchParams.getAll("ids")) {
    const id = Number(raw);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }

  const { rows } = await loadGrantExportFiltered(scope, url.searchParams.get("funding"));
  if (rows.length === 0) return new NextResponse("No grant rows to export.", { status: 409 });

  const selected = ids.size > 0 ? selectGrantRows(rows, ids) : rows;
  if (selected.length === 0) {
    return new NextResponse("None of the selected rows are still available to export.", { status: 409 });
  }

  const kind = ids.size > 0 ? "selected" : scope;
  return csvDownload(selected, `pixl-grants-${kind}-${new Date().toISOString().slice(0, 10)}.csv`);
});
