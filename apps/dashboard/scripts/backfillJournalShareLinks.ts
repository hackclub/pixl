// One-off backfill: set the "Justification - Alternate Tracking Method"
// Airtable field for every already-approved project that (a) was already
// pushed to Airtable (has an airtable_record_id - a never-pushed approved
// project gets this field naturally whenever it's eventually sent) and (b)
// actually has journal entries to link to. Going forward, pushProjectToAirtable
// does this automatically on every new approval/re-push - see actions.ts.
//
// Deliberately PATCHes only this one field via pushProjectRecord, not a full
// re-push (which would also re-fetch Hackatime data for every historical
// project and risk clobbering any field a teammate hand-edited in Airtable
// since the original push).
//
// Run once, from inside the pixl-dashboard pod (needs its
// AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN and DATABASE_URL):
//   bun run scripts/backfillJournalShareLinks.ts
// Idempotent - re-running only touches projects still missing the field's
// underlying token, and PATCHing the same value twice is harmless.
import { db, ensureJournalShareToken } from "../lib/db";
import { pushProjectRecord } from "../lib/airtable";
import { config } from "../app/_generated/config";

async function main() {
  const { data: candidates, error } = await db
    .from("projects")
    .select("id, name, airtable_record_id")
    .eq("status", "approved")
    .not("airtable_record_id", "is", null);
  if (error) {
    console.error("backfill: candidate query failed", error.message);
    process.exit(1);
  }

  console.log(`backfill: ${candidates?.length ?? 0} approved + already-in-Airtable projects to check`);

  let updated = 0;
  let skippedNoJournals = 0;
  let failed = 0;

  for (const project of candidates ?? []) {
    const { count } = await db
      .from("project_journals")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id);
    if (!count) {
      skippedNoJournals++;
      continue;
    }

    const token = await ensureJournalShareToken(project.id as number);
    if (!token) {
      console.error(`backfill: could not get/generate a token for project ${project.id}`);
      failed++;
      continue;
    }
    const journalShareUrl = `${config.urls.play}/journals/${project.id}/${token}`;

    const result = await pushProjectRecord(
      { "Justification - Alternate Tracking Method": journalShareUrl },
      project.airtable_record_id as string,
    );
    if (!result.ok) {
      console.error(`backfill: Airtable patch failed for project ${project.id} (${project.name}): ${result.error}`);
      failed++;
      continue;
    }
    updated++;
    console.log(`backfill: updated project ${project.id} (${project.name}) -> ${journalShareUrl}`);
  }

  console.log(`backfill: done - ${updated} updated, ${skippedNoJournals} skipped (no journals), ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
