import { NextResponse } from "next/server";
import { getAccess } from "@/lib/guard";
import { db } from "@/lib/db";
import { parseAuditNote } from "@/lib/auditNote";
import { decryptPII } from "@/lib/crypto";

export const dynamic = "force-dynamic";

// Every approved project, shaped to Hack Club's YSWS Unified Database required
// fields, so wiring the real Airtable push (once the sponsor hands over
// access) is a small diff rather than a redesign. Interim/manual export until
// then , see the "ysws-submission-fields" migration.
export async function GET(): Promise<NextResponse> {
  const access = await getAccess();
  if (!access?.isSuper) return new NextResponse("Forbidden", { status: 403 });

  const { data: projects, error } = await db
    .from("projects")
    .select(
      "id, name, description, repo_url, demo_url, image_url, approved_hours, system_note, user_id",
    )
    .eq("status", "approved")
    .is("archived_at", null)
    .order("id", { ascending: true });
  if (error) return new NextResponse("Database error", { status: 500 });
  const rows = projects ?? [];

  const userIds = [...new Set(rows.map((p) => p.user_id))];
  const { data: users } = userIds.length
    ? await db
        .from("users")
        .select(
          "id, first_name, last_name, real_name, email, birthday, address_line1, address_line2, address_city, address_state, address_country, address_postal",
        )
        .in("id", userIds)
    : { data: [] };
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  const projectIds = rows.map((p) => p.id);
  const { data: audits } = projectIds.length
    ? await db
        .from("review_audits")
        .select("project_id, audit_note, created_at")
        .in("project_id", projectIds)
        .eq("verdict", "approved")
        .order("created_at", { ascending: false })
    : { data: [] };
  // Most recent approval audit note per project (a project can be re-approved
  // after an update ships again).
  const auditByProject = new Map<number, string>();
  for (const a of audits ?? []) {
    if (!auditByProject.has(a.project_id)) auditByProject.set(a.project_id, a.audit_note ?? "");
  }

  // A cell starting with =, +, -, or @ is a live formula to Excel/Sheets,
  // prefix with a leading quote so these (name, description, audit notes...)
  // render as inert text instead of executing when the sheet is opened.
  const esc = (s: string) => {
    const str = String(s ?? "");
    const safe = /^[=+\-@]/.test(str) ? `'${str}` : str;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const header = [
    "Code URL",
    "Playable URL",
    "First Name",
    "Last Name",
    "Email",
    "Birthday",
    "Address Line 1",
    "Address Line 2",
    "City",
    "State",
    "Country",
    "ZIP",
    "Screenshot",
    "Description",
    "Hours",
    "Hours Justification",
    "Override Duplicate Justification",
    "Override Age Justification",
  ];
  const lines = [header.join(",")];
  for (const p of rows) {
    const u = userById.get(p.user_id);
    // real_name is "First Last" from HCA , fall back to splitting it on the
    // first space for players who signed up before first_name/last_name were
    // captured separately (see 0076_ysws_submission_fields.sql).
    const [fallbackFirst, ...fallbackRest] = (u?.real_name ?? "").split(" ");
    const firstName = u?.first_name || fallbackFirst || "";
    const lastName = u?.last_name || fallbackRest.join(" ") || "";
    const auditNote = auditByProject.get(p.id) ?? "";
    const sections = parseAuditNote(auditNote);
    lines.push(
      [
        esc(p.repo_url ?? ""),
        esc(p.demo_url ?? ""),
        esc(firstName),
        esc(lastName),
        esc(u?.email ?? ""),
        esc(decryptPII(u?.birthday)),
        esc(decryptPII(u?.address_line1)),
        esc(decryptPII(u?.address_line2)),
        esc(decryptPII(u?.address_city)),
        esc(decryptPII(u?.address_state)),
        esc(decryptPII(u?.address_country)),
        esc(decryptPII(u?.address_postal)),
        esc(p.image_url ?? ""),
        esc(p.description ?? ""),
        p.approved_hours ?? "",
        esc(auditNote),
        esc(p.system_note ?? ""),
        esc(sections["AGE JUSTIFICATION"]),
      ].join(","),
    );
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pixl-ysws-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
