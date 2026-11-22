import { NextResponse } from "next/server";
import { guardedRoute } from "@/lib/guard";
import { grantCsv, selectGrantRows, type GrantExportRow } from "@/lib/grantExport";
import { loadGrantExport, parseGrantScope } from "@/lib/grantExportData";

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
// batch of buyer emails; guardedRoute writes the audit row.
export const GET = guardedRoute("api.fulfillment.grants_export", "owner", async (_access, request): Promise<NextResponse> => {
  const scope = parseGrantScope(new URL(request.url).searchParams.get("scope"));
  const { rows } = await loadGrantExport(scope);
  if (rows.length === 0) return new NextResponse("No grant rows to export.", { status: 409 });

  return csvDownload(rows, `pixl-grants-${scope}-${new Date().toISOString().slice(0, 10)}.csv`);
});

// Checkbox download: only the ids the owner ticked. The rows are re-read from
// the same owner-only loader and filtered server-side, so a stale checkbox or
// a hand-crafted id can never add a different order to the file.
export const POST = guardedRoute("api.fulfillment.grants_export_selected", "owner", async (_access, request): Promise<NextResponse> => {
  const form = await request.formData();
  const scope = parseGrantScope(String(form.get("scope") ?? ""));
  const ids = new Set<number>();
  for (const raw of form.getAll("ids")) {
    const id = Number(raw);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  if (ids.size === 0) return new NextResponse("Select at least one grant row to export.", { status: 400 });

  const { rows } = await loadGrantExport(scope);
  const selected = selectGrantRows(rows, ids);
  if (selected.length === 0) {
    return new NextResponse("None of the selected rows are still available to export.", { status: 409 });
  }

  return csvDownload(selected, `pixl-grants-selected-${new Date().toISOString().slice(0, 10)}.csv`);
});
