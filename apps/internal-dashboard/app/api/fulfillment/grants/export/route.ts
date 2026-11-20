import { NextResponse } from "next/server";
import { guardedRoute } from "@/lib/guard";
import { grantCsv } from "@/lib/grantExport";
import { loadGrantExport, parseGrantScope } from "@/lib/grantExportData";

export const dynamic = "force-dynamic";

// The download behind /fulfillment/grants. Owner-only because the file is a
// batch of buyer emails; guardedRoute writes the audit row.
export const GET = guardedRoute("api.fulfillment.grants_export", "owner", async (_access, request): Promise<NextResponse> => {
  const scope = parseGrantScope(new URL(request.url).searchParams.get("scope"));
  const { rows } = await loadGrantExport(scope);
  if (rows.length === 0) return new NextResponse("No grant rows to export.", { status: 409 });

  return new NextResponse(grantCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pixl-grants-${scope}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
