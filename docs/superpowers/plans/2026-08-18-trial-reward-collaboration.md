# Trial Reward Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each collaborator on a Trial-linked ship who individually clears the Trial's `min_hours` gets their own full Trial reward (prize-or-pixels choice), not just the owner, and the ship can be approved as long as *anyone* on it clears the minimum, not only the owner.

**Architecture:** Mirror the existing owner-side mechanism (`projects.trial_reward_choice`/`trial_held_px`/`trial_prize_px` + the `POST /api/projects/:id/trial-reward` settlement route) onto `project_collaborators`, reusing the exact prize/pixel-slice math the owner path already uses. No new tables, no change to the owner's existing flow.

**Tech Stack:** Bun/Express server (`apps/server`), Next.js dashboard (`apps/dashboard`, Next 16/React 19), plain HTML/JS web-shell (`apps/game/web`), Postgres via a Supabase-shaped `pgCompat` client. No automated test suite exists for `apps/server`/`apps/dashboard` (confirmed, CLAUDE.md: "no root-level test suite"), so verification steps use `bunx tsc --noEmit` / `tsc --noEmit` typechecks plus manual end-to-end checks against a local dev server, not a fabricated test framework.

Spec: `docs/superpowers/specs/2026-08-18-trial-reward-collaboration-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/server/drizzle/0131_collaborator_trial_reward.sql` (create) | New columns on `project_collaborators` mirroring `projects`' trial-reward columns |
| `apps/server/src/db/schema.ts` (modify) | Drizzle schema for the three new columns, if `project_collaborators` is declared there |
| `apps/dashboard/app/actions.ts` (modify) | `reviewProject()`: compute per-collaborator credited hours up front, loosen the approval gate, hold/settle each qualifying collaborator's Trial reward in the payout loop |
| `apps/server/src/routes/projects.ts` (modify) | Generalize `POST /api/projects/:id/trial-reward` to accept an accepted collaborator, not just the owner; `GET /api/projects` exposes a collaborator's own trial-reward fields |
| `apps/game/web/projects/index.html` (modify) | `renderCollabProjectView()` gets its own trial-claim block + claim handler, reading the collaborator-scoped fields |
| `apps/dashboard/app/_components/ReviewForm.tsx` (modify) | `CollaboratorHoursInput` shows whether that collaborator's current hours clear the Trial's minimum |

---

### Task 1: Migration - trial-reward columns on `project_collaborators`

**Files:**
- Create: `apps/server/drizzle/0131_collaborator_trial_reward.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Collaborators can now individually earn a Trial's reward (prize or held
-- pixels), same as the owner already can (see 0121_trial_reward_choice.sql,
-- 0126_trial_prize_px.sql). Same three columns, same semantics, just scoped
-- to a project_collaborators row instead of a projects row:
--   trial_reward_choice: '' = nothing pending / not a Trial ship for this
--     person, 'pending' = they cleared min_hours and haven't chosen yet,
--     'item' = kept the prize, 'pixels' = took the held pixels instead.
--   trial_held_px: the full payout this collaborator's own hours produced,
--     held back at approval instead of credited immediately.
--   trial_prize_px: the pixel value of the Trial's minimum-hours slice for
--     THIS collaborator's hours , what they forfeit by keeping the prize.
--
-- Target: the orchard/CNPG database. Idempotent. Run in psql.

alter table project_collaborators add column if not exists trial_reward_choice text not null default '';
alter table project_collaborators add column if not exists trial_held_px integer not null default 0;
alter table project_collaborators add column if not exists trial_prize_px integer not null default 0;

create index if not exists project_collaborators_trial_reward_choice_idx
  on project_collaborators (trial_reward_choice)
  where trial_reward_choice = 'pending';
```

- [ ] **Step 2: Check whether `project_collaborators` is declared in the Drizzle schema file**

Run: `grep -n "project_collaborators" /home/ridit/Documents/Pixl/apps/server/src/db/schema.ts`

If it returns matches, add the three new columns to that table definition, matching the existing style for the other columns on that table (e.g. `approvedHours: integer("approved_hours")` pattern, check the exact style used for `hackatime_seconds`/`approved_hours` on the same table and copy it exactly, don't guess a different casing/type convention). If it returns nothing, `project_collaborators` isn't Drizzle-declared (queries go through `pgCompat`'s Supabase-shaped `.from()` builder instead) and this step is a no-op, skip to Step 3.

- [ ] **Step 3: Apply the migration**

This repo's migrations run via `apps/server/src/scripts/apply-migrations.js` against Orchard Postgres in the deployed pod (`drizzle-kit migrate` OOMs there, see `[[orchard-migration-2026-08]]`). Confirm with the user whether to apply it now via `exec_in_pod` (see `[[feedback_prod_db_access_pattern]]` memory for the exact no-credentials-exposed pattern) or let it ride on the next deploy's migration step - don't apply it unprompted given this session's history with prod actions.

- [ ] **Step 4: Commit**

```bash
git add apps/server/drizzle/0131_collaborator_trial_reward.sql
git commit -m "db: add trial reward columns to project_collaborators"
```

(Include `apps/server/src/db/schema.ts` in the `git add` too if Step 2 changed it.)

---

### Task 2: Loosen the approval gate - anyone clears `min_hours`, not just the owner

**Files:**
- Modify: `apps/dashboard/app/actions.ts:862-873`

- [ ] **Step 1: Move the collaborator fetch earlier and compute credited hours up front**

Find this block (currently right after the approval status update, around line 905 in the current file):

```ts
  const { data: collabRows } = await db
    .from("project_collaborators")
    .select("id, user_id, hackatime_seconds")
    .eq("project_id", projectId)
    .eq("status", "accepted");
  const collaborators = (collabRows ?? []) as { id: number; user_id: string; hackatime_seconds: number | null }[];
```

Delete it from that location - it moves earlier in Step 2.

- [ ] **Step 2: Replace the existing gate check**

Find:

```ts
  const creditHours = approvedHours ?? claimedHours;

  // A Trial's min-hours requirement is a hard floor on approval: if the
  // credited hours (after any deflation) don't clear it, this can't be
  // approved , the reviewer has to request changes instead.
  if (linkedTrial?.min_hours != null && creditHours < Number(linkedTrial.min_hours)) {
    redirect(
      `${back}?error=${encodeURIComponent(
        `Credited hours (${creditHours}h) are below "${linkedTrial.name}"'s ${linkedTrial.min_hours}h minimum , use Request Changes instead, or credit at least ${linkedTrial.min_hours}h.`,
      )}`,
    );
  }
```

Replace with:

```ts
  const creditHours = approvedHours ?? claimedHours;

  // Collaborator credited hours are needed for the min-hours gate below (a
  // collaborator can individually clear a Trial even when the owner doesn't)
  // and reused by the payout loop further down, so they're computed once,
  // up front, instead of twice. See [[trial-reward-collaboration]].
  const { data: collabRows } = await db
    .from("project_collaborators")
    .select("id, user_id, hackatime_seconds, trial_reward_choice")
    .eq("project_id", projectId)
    .eq("status", "accepted");
  const collaborators = (collabRows ?? []) as {
    id: number;
    user_id: string;
    hackatime_seconds: number | null;
    trial_reward_choice: string;
  }[];
  const collaboratorCreditHours = new Map<number, number>(); // keyed by collaborator row id
  for (const c of collaborators) {
    const cClaimedHours = await claimedHoursForCollaborator(projectId, c.user_id, c.hackatime_seconds);
    const rawHours = Number(String(formData.get(`collabHours_${c.id}`) ?? cClaimedHours));
    const cCreditHours = Number.isFinite(rawHours)
      ? Math.min(cClaimedHours, Math.max(0, Math.round(rawHours * 10) / 10))
      : cClaimedHours;
    collaboratorCreditHours.set(c.id, cCreditHours);
  }

  // A Trial's min-hours requirement is a hard floor on approval, but it's a
  // per-ship floor: it only blocks if NEITHER the owner NOR any collaborator
  // individually clears it. Whoever clears it earns their own Trial reward
  // (payout loop below); whoever doesn't just gets the normal split payout.
  const anyoneClearsMinHours =
    linkedTrial?.min_hours == null ||
    creditHours >= Number(linkedTrial.min_hours) ||
    collaborators.some(
      (c) => (collaboratorCreditHours.get(c.id) ?? 0) >= Number(linkedTrial.min_hours),
    );
  if (!anyoneClearsMinHours) {
    redirect(
      `${back}?error=${encodeURIComponent(
        `Credited hours are below "${linkedTrial!.name}"'s ${linkedTrial!.min_hours}h minimum for everyone on this ship , use Request Changes instead, or credit at least ${linkedTrial!.min_hours}h for someone.`,
      )}`,
    );
  }
```

- [ ] **Step 3: Remove the now-duplicate collaborator fetch after the approval update**

A second copy of the `collabRows`/`collaborators` fetch still exists right after the `projects` status-update-to-`approved` query (this is the block Step 1 told you to delete, do it now if you haven't). After deleting it, the line right below it:

```ts
  const allBeneficiaryIds = [project.user_id, ...collaborators.map((c) => c.user_id)];
```

should now reference the `collaborators` computed in Step 2 (same variable name, now defined earlier) - no change needed to this line itself, just confirm it still compiles once the earlier duplicate declaration is gone (two `const collaborators = ...` in the same function scope is a syntax error, so this step isn't optional).

- [ ] **Step 4: Typecheck**

Run: `cd /home/ridit/Documents/Pixl/apps/dashboard && bunx tsc --noEmit 2>&1 | head -50`
Expected: no errors mentioning `actions.ts`. (Pre-existing unrelated errors elsewhere in the dashboard, if any, aren't this task's concern - only check for new ones in the file you touched.)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/actions.ts
git commit -m "reviewProject: approve if anyone on the ship clears the trial's min_hours, not just the owner"
```

---

### Task 3: Per-collaborator Trial hold + reward in the payout loop

**Files:**
- Modify: `apps/dashboard/app/actions.ts` (the collaborator split-payout loop, ~line 995-1032 in the pre-Task-2 file, line numbers shift after Task 2's edits, find it by the comment below)

- [ ] **Step 1: Replace the collaborator payout loop**

Find the loop starting with the comment `// Split payout: every accepted collaborator is credited independently...`:

```ts
  for (const c of collaborators) {
    const cClaimedHours = await claimedHoursForCollaborator(projectId, c.user_id, c.hackatime_seconds);
    const rawHours = Number(String(formData.get(`collabHours_${c.id}`) ?? cClaimedHours));
    const cCreditHours = Number.isFinite(rawHours)
      ? Math.min(cClaimedHours, Math.max(0, Math.round(rawHours * 10) / 10))
      : cClaimedHours;
    await db.from("project_collaborators").update({ approved_hours: cCreditHours }).eq("id", c.id);
    const cPayout = await creditBeneficiary(
      c.user_id,
      project.id,
      project.project_type,
      cCreditHours,
      current.shipped_at,
      by,
      allBeneficiaryIds.filter((id) => id !== c.user_id),
      tierUsed,
    );
    let cCredited: string;
    if (cPayout.alreadyPx > 0 && cPayout.deltaPx > 0) {
      cCredited = `\n\n+${cPayout.deltaPx} pixels for what's new (${cPayout.totalPx} pixels total for this project , ${cCreditHours}h approved).`;
    } else if (cPayout.alreadyPx > 0 && cPayout.deltaPx <= 0) {
      cCredited = `\n\nNo new pixels this time , you already earned ${cPayout.alreadyPx} pixels on this project.`;
    } else {
      cCredited = `\n\n${cPayout.totalPx} pixels credited for ${cCreditHours}h approved.`;
    }
    if (cPayout.deltaPx > 0)
      cCredited += ` Your rate: ${cPayout.pxRate} px/h ($${(cPayout.pxRate * 0.07).toFixed(2)}/hr).`;
    if (cPayout.goalNote && cPayout.deltaPx > 0) cCredited += cPayout.goalNote;
    if (cPayout.referralNote && cPayout.deltaPx > 0) cCredited += cPayout.referralNote;
    await notifyOwner(
      c.user_id,
      "Project approved!",
      `"${project.name}" passed review , approved by ${reviewer}. Congrats on shipping!${cCredited}`,
    );
  }
```

Replace with:

```ts
  // Split payout: every accepted collaborator is credited independently at
  // their own rate tier for their own submitted hours slice (capped at what
  // they actually tracked , see claimedHoursForCollaborator). A collaborator
  // whose own hours clear the Trial's min_hours gets the same held-reward
  // treatment the owner gets , see [[trial-reward-collaboration]] , instead
  // of an immediate payout.
  for (const c of collaborators) {
    const cCreditHours = collaboratorCreditHours.get(c.id)!;
    await db.from("project_collaborators").update({ approved_hours: cCreditHours }).eq("id", c.id);

    const cTrialChoice = c.trial_reward_choice;
    const cHoldForTrial =
      !!linkedTrial &&
      cCreditHours >= Number(linkedTrial.min_hours ?? 0) &&
      cTrialChoice !== "pixels";

    const cPayout = await creditBeneficiary(
      c.user_id,
      project.id,
      project.project_type,
      cCreditHours,
      current.shipped_at,
      by,
      allBeneficiaryIds.filter((id) => id !== c.user_id),
      tierUsed,
      cHoldForTrial,
    );

    let cCredited: string;
    if (cHoldForTrial && cTrialChoice !== "item") {
      const cTrialPrizePx = Math.min(
        Math.max(Math.round(projectPayoutPx(trialMinHours, tierUsed, 0) * cPayout.goalMult), 0),
        cPayout.totalPx,
      );
      const cBeyondPx = Math.max(cPayout.totalPx - cTrialPrizePx, 0);
      cCredited =
        `\n\nTrial "${linkedTrial!.name}" complete! You've earned "${trialPrize!.name}" for the first ` +
        `${trialMinHours}h, plus ${cBeyondPx} pixels for the hours beyond that. Head to the project ` +
        `page to claim the prize (default), or skip it and take all ${cPayout.totalPx} pixels instead.`;
      const { error: cChoiceError } = await db
        .from("project_collaborators")
        .update({ trial_reward_choice: "pending", trial_held_px: cPayout.totalPx, trial_prize_px: cTrialPrizePx })
        .eq("id", c.id);
      if (cChoiceError) console.error("reviewProject (collab trial choice)", cChoiceError.message);
    } else if (cHoldForTrial) {
      cCredited = `\n\nYou kept "${trialPrize!.name}" as your Trial reward on this one, plus the pixels for the hours past the ${trialMinHours}h minimum.`;
    } else if (cPayout.alreadyPx > 0 && cPayout.deltaPx > 0) {
      cCredited = `\n\n+${cPayout.deltaPx} pixels for what's new (${cPayout.totalPx} pixels total for this project , ${cCreditHours}h approved).`;
    } else if (cPayout.alreadyPx > 0 && cPayout.deltaPx <= 0) {
      cCredited = `\n\nNo new pixels this time , you already earned ${cPayout.alreadyPx} pixels on this project.`;
    } else {
      cCredited = `\n\n${cPayout.totalPx} pixels credited for ${cCreditHours}h approved.`;
    }
    if (cPayout.deltaPx > 0 && !(cHoldForTrial && cTrialChoice === "item"))
      cCredited += ` Your rate: ${cPayout.pxRate} px/h ($${(cPayout.pxRate * 0.07).toFixed(2)}/hr).`;
    if (cPayout.goalNote && cPayout.deltaPx > 0) cCredited += cPayout.goalNote;
    if (cPayout.referralNote && cPayout.deltaPx > 0) cCredited += cPayout.referralNote;
    await notifyOwner(
      c.user_id,
      "Project approved!",
      `"${project.name}" passed review , approved by ${reviewer}. Congrats on shipping!${cCredited}`,
    );
  }
```

Note: `trialMinHours` and `trialPrize` are already computed once earlier in the function for the owner's payout (`const trialMinHours = ...`, `const trialPrize = linkedTrial ? await trialPrizeFor(linkedTrial) : null;`) - this loop reuses those same two variables, it does not recompute them.

- [ ] **Step 2: Typecheck**

Run: `cd /home/ridit/Documents/Pixl/apps/dashboard && bunx tsc --noEmit 2>&1 | head -50`
Expected: no new errors in `actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app/actions.ts
git commit -m "reviewProject: collaborators who clear a trial's min_hours get their own held reward"
```

---

### Task 4: Generalize the settlement route for collaborators

**Files:**
- Modify: `apps/server/src/routes/projects.ts:703-829`

- [ ] **Step 1: Replace the route**

Find `router.post("/api/projects/:id/trial-reward", ...)` (starts at line 703) through its closing `});` (line 829). Replace the entire handler body with:

```ts
router.post("/api/projects/:id/trial-reward", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  const choice = String(req.body?.choice ?? "");
  if (choice !== "item" && choice !== "pixels")
    return res.status(400).json({ ok: false, error: "bad_choice" });

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, status, approved_hours, sidequest_id, user_id, trial_reward_choice, trial_held_px, trial_prize_px",
    )
    .eq("id", id)
    .maybeSingle();
  if (!project) return res.status(404).json({ ok: false });

  // Owner, or an accepted collaborator with their own pending Trial reward on
  // this ship (see [[trial-reward-collaboration]]) , each settles against
  // their own row, independently of what the other picks.
  const isOwner = project.user_id === session.userId;
  let collabRow: {
    id: number;
    trial_reward_choice: string;
    trial_held_px: number;
    trial_prize_px: number;
  } | null = null;
  if (!isOwner) {
    const { data } = await supabase
      .from("project_collaborators")
      .select("id, trial_reward_choice, trial_held_px, trial_prize_px")
      .eq("project_id", id)
      .eq("user_id", session.userId)
      .eq("status", "accepted")
      .maybeSingle();
    collabRow = data;
  }
  if (!isOwner && !collabRow) return res.status(404).json({ ok: false });

  const rewardChoice = isOwner ? project.trial_reward_choice : collabRow!.trial_reward_choice;
  if (project.status !== "approved" || rewardChoice !== "pending")
    return res.status(400).json({ ok: false, error: "nothing_to_claim" });

  // A Trial can be deleted out from under an approved ship (it has happened,
  // see [[trial-npc-link-drift]]). That must not strand the player's pixels,
  // so only the prize branch actually needs the row.
  const { data: trial } = await supabase
    .from("sidequests")
    .select("id, name, reward, prize_shop_item_id")
    .eq("id", project.sidequest_id as number)
    .maybeSingle();
  if (!trial && choice === "item")
    return res.status(400).json({ ok: false, error: "trial_missing" });
  const trialLabel = (trial?.name as string) || "this Trial";

  // Claim the choice first, on whichever row this beneficiary owns. If
  // someone else's request (or a double-click) already took it, this matches
  // no rows and we stop before paying anything out.
  const table = isOwner ? "projects" : "project_collaborators";
  const matchId = isOwner ? id : collabRow!.id;
  const { data: claimed } = await supabase
    .from(table)
    .update({ trial_reward_choice: choice })
    .eq("id", matchId)
    .eq("trial_reward_choice", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return res.status(409).json({ ok: false, error: "already_claimed" });

  const heldPx = Math.max(Number(isOwner ? project.trial_held_px : collabRow!.trial_held_px) || 0, 0);
  // The prize covers the Trial's minimum hours; those pixels (trial_prize_px)
  // are what you forfeit by keeping the prize. Everything beyond the minimum
  // is paid in pixels either way.
  const prizePx = Math.max(Number(isOwner ? project.trial_prize_px : collabRow!.trial_prize_px) || 0, 0);
  const beyondPx = Math.max(heldPx - prizePx, 0);

  if (choice === "pixels") {
    const { error } = await supabase.rpc("credit_project_pixels", {
      p_user_id: session.userId,
      p_project_id: id,
      p_amount: heldPx,
      p_hours: Number(project.approved_hours) || 0,
      p_created_by: "trial_reward",
    });
    if (error) {
      console.error("[projects] trial pixels payout failed", error);
      await supabase.from(table).update({ trial_reward_choice: "pending" }).eq("id", matchId);
      return res.status(500).json({ ok: false });
    }
    void addNotification(
      session.userId,
      "Trial reward: pixels",
      `You took the pixels for "${trialLabel}". ${heldPx} pixels are in your wallet.`,
    );
    return res.json({ ok: true, choice, pixels: heldPx });
  }

  // The prize itself: a $0 order, so it walks the same fulfilment pipeline as
  // anything bought with pixels. Prefers the Trial's linked catalog item,
  // falls back to its free-text reward as a custom order ops fulfils by hand.
  // The order is attributed to session.userId (owner or collaborator) via
  // shop_orders.user_id , fulfilment doesn't need to know which one it was.
  let itemId: number | null = null;
  let itemName = (trial!.reward as string) || (trial!.name as string);
  if (trial!.prize_shop_item_id) {
    const { data: prizeItem } = await supabase
      .from("shop_items")
      .select("id, name")
      .eq("id", trial!.prize_shop_item_id)
      .maybeSingle();
    if (prizeItem) {
      itemId = prizeItem.id as number;
      itemName = prizeItem.name as string;
    }
  }
  const { data: order, error: orderError } = await supabase
    .from("shop_orders")
    .insert({
      user_id: session.userId,
      item_id: itemId,
      item_name: itemName,
      option: `Trial: ${trial!.name}`,
      price: 0,
      status: "pending",
    })
    .select("id")
    .single();
  if (orderError || !order) {
    console.error("[projects] trial prize order failed", orderError);
    await supabase.from(table).update({ trial_reward_choice: "pending" }).eq("id", matchId);
    return res.status(500).json({ ok: false });
  }
  // trial_prize_order_id only exists on `projects` (owner-only column) ,
  // nothing currently reads it back for a collaborator, and the order is
  // already correctly attributed via shop_orders.user_id regardless of who
  // claimed it, so no equivalent column was added to project_collaborators.
  if (isOwner) await supabase.from("projects").update({ trial_prize_order_id: order.id }).eq("id", id);
  // Keeping the prize still pays out the pixels for hours past the minimum.
  if (beyondPx > 0) {
    const { error: pxError } = await supabase.rpc("credit_project_pixels", {
      p_user_id: session.userId,
      p_project_id: id,
      p_amount: beyondPx,
      p_hours: Number(project.approved_hours) || 0,
      p_created_by: "trial_reward",
    });
    if (pxError) console.error("[projects] trial beyond-min pixels payout failed", pxError);
  }
  void addNotification(
    session.userId,
    "Trial reward claimed",
    beyondPx > 0
      ? `"${itemName}" is on its way for finishing "${trial!.name}", plus ${beyondPx} pixels for the hours past the minimum. Track the prize in your orders.`
      : `"${itemName}" is on its way for finishing "${trial!.name}". Track it in your orders.`,
  );
  res.json({ ok: true, choice, item: itemName, pixels: beyondPx });
});
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/ridit/Documents/Pixl/apps/server && bunx tsc -p tsconfig.json --noEmit 2>&1 | head -50`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/routes/projects.ts
git commit -m "projects: let a collaborator settle their own trial reward, not just the owner"
```

---

### Task 5: Expose a collaborator's own trial fields from `GET /api/projects`

**Files:**
- Modify: `apps/server/src/routes/projects.ts:32-135` (the `GET /api/projects` handler)

- [ ] **Step 1: Widen the collaborator select and build a per-project lookup**

Find:

```ts
  const { data: collabRows } = await supabase
    .from("project_collaborators")
    .select("project_id")
    .eq("user_id", session.userId)
    .eq("status", "accepted");
  const collabProjectIds = (collabRows ?? []).map((r) => r.project_id as number);
```

Replace with:

```ts
  const { data: collabRows } = await supabase
    .from("project_collaborators")
    .select("project_id, trial_reward_choice, trial_held_px, trial_prize_px")
    .eq("user_id", session.userId)
    .eq("status", "accepted");
  const collabProjectIds = (collabRows ?? []).map((r) => r.project_id as number);
  // A collaborator's own Trial-reward state, separate from the project row's
  // (owner's) fields of the same name , see [[trial-reward-collaboration]].
  // Prefixed "my_" so the client can tell the two apart on the same object.
  const myCollabTrialFields = new Map(
    (collabRows ?? []).map((r) => [
      r.project_id as number,
      {
        my_trial_reward_choice: (r.trial_reward_choice as string) || "",
        my_trial_held_px: Number(r.trial_held_px) || 0,
        my_trial_prize_px: Number(r.trial_prize_px) || 0,
      },
    ]),
  );
```

- [ ] **Step 2: Merge the fields into the response for collaborating (non-owned) projects**

Find:

```ts
  res.json({
    ok: true,
    projects: projects.map((p) => ({
      ...p,
      pixels_earned: earned.get(p.id as number) ?? 0,
      sidequest_name: p.sidequest_id
        ? (trialName.get(p.sidequest_id as number) ?? null)
        : null,
      trial_prize_name: p.sidequest_id
        ? (trialPrize.get(p.sidequest_id as number) ?? null)
        : null,
    })),
  });
```

Replace with:

```ts
  res.json({
    ok: true,
    projects: projects.map((p) => ({
      ...p,
      pixels_earned: earned.get(p.id as number) ?? 0,
      sidequest_name: p.sidequest_id
        ? (trialName.get(p.sidequest_id as number) ?? null)
        : null,
      trial_prize_name: p.sidequest_id
        ? (trialPrize.get(p.sidequest_id as number) ?? null)
        : null,
      ...(p.is_owner === false ? myCollabTrialFields.get(p.id as number) : {}),
    })),
  });
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/ridit/Documents/Pixl/apps/server && bunx tsc -p tsconfig.json --noEmit 2>&1 | head -50`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/projects.ts
git commit -m "projects: GET /api/projects exposes a collaborator's own trial reward fields"
```

---

### Task 6: Web UI - collaborator trial-claim block

**Files:**
- Modify: `apps/game/web/projects/index.html`

- [ ] **Step 1: Add `collabTrialRewardHtml()` and `claimCollabTrialReward()`**

Find `function trialRewardHtml(p) {` (around line 3113) and add these two new functions directly after the closing `}` of `claimTrialReward` (around line 3163, right before the `trialForProject` comment):

```js
      // Same shape as trialRewardHtml/claimTrialReward, but reads a
      // collaborator's own trial fields (my_trial_reward_choice etc., added
      // by GET /api/projects for non-owner rows) instead of the project's
      // owner-scoped fields. See [[trial-reward-collaboration]].
      function collabTrialRewardHtml(p) {
        const choice = p.my_trial_reward_choice || "";
        if (!choice) return "";
        const prize = p.trial_prize_name || "the Trial reward";
        if (choice === "item")
          return `<div class="trial-claim"><div class="trial-claim-taken">Trial reward claimed: <b>${Pixl.esc(prize)}</b>. Track it in <a href="/orders/">your orders</a>.</div></div>`;
        if (choice === "pixels")
          return `<div class="trial-claim"><div class="trial-claim-taken">You took the pixels for this Trial instead of the reward.</div></div>`;
        const total = Math.round(Number(p.my_trial_held_px) || 0);
        const beyond = Math.max(total - Math.round(Number(p.my_trial_prize_px) || 0), 0);
        return `
      <div class="trial-claim">
        <div class="trial-claim-h">YOUR TRIAL REWARD</div>
        <p>
          ${Pixl.esc(p.sidequest_name || "This Trial")} is done! By default you keep <b>${Pixl.esc(prize)}</b>${beyond > 0 ? ` and still earn <b>${beyond} pixels</b> for the hours past the minimum` : ""}.
          Prefer pure pixels? Skip the prize to take all <b>${total}</b> instead. It's final either way.
        </p>
        <div class="trial-claim-opts">
          <button class="btn" id="ctr-item">KEEP ${Pixl.esc(prize.toUpperCase())}${beyond > 0 ? ` + ${beyond} PX` : ""}</button>
          <button class="btn dark" id="ctr-px">SKIP PRIZE, TAKE ${total} PX</button>
        </div>
      </div>`;
      }

      async function claimCollabTrialReward(p, choice, prize, total, beyond) {
        const body =
          choice === "item"
            ? `You'll get "${prize}"${beyond > 0 ? ` plus ${beyond} pixels for the hours past the minimum` : ""}, and give up taking all ${total} pixels. This can't be undone.`
            : `You'll get all ${total} pixels and give up "${prize}". This can't be undone.`;
        if (
          !(await Pixl.confirm({
            title: choice === "item" ? "Keep the prize?" : "Skip the prize?",
            body,
            confirmText: choice === "item" ? "Keep the prize" : "Take all pixels",
          }))
        )
          return;
        for (const id of ["ctr-item", "ctr-px"]) if ($(id)) $(id).disabled = true;
        const r = await Pixl.send("POST", `/api/projects/${p.id}/trial-reward`, { choice });
        if (!r.ok) {
          for (const id of ["ctr-item", "ctr-px"]) if ($(id)) $(id).disabled = false;
          return Pixl.toast(err(r.error), true);
        }
        Pixl.toast(
          choice === "item"
            ? `"${prize}" is on the way${beyond > 0 ? ` (+${beyond} pixels)` : ""}, check your orders.`
            : `+${total} pixels.`,
        );
        await loadProjects();
        const fresh = projects.find((x) => x.id === p.id) || p;
        renderCollabProjectView(fresh);
      }
```

- [ ] **Step 2: Render the claim block in `renderCollabProjectView`**

Find (around line 2353-2356):

```js
      <div class="proj-meta" style="margin-bottom:18px">
        ${p.repo_url ? `<a class="btn ghost" href="${Pixl.esc(p.repo_url)}" target="_blank" rel="noreferrer">REPO</a>` : ""}
        ${p.demo_url ? `<a class="btn ghost" href="${Pixl.esc(p.demo_url)}" target="_blank" rel="noreferrer">DEMO</a>` : ""}
      </div>

      <div class="section-h">COLLABORATORS</div>
```

Replace with:

```js
      <div class="proj-meta" style="margin-bottom:18px">
        ${p.repo_url ? `<a class="btn ghost" href="${Pixl.esc(p.repo_url)}" target="_blank" rel="noreferrer">REPO</a>` : ""}
        ${p.demo_url ? `<a class="btn ghost" href="${Pixl.esc(p.demo_url)}" target="_blank" rel="noreferrer">DEMO</a>` : ""}
      </div>
      ${collabTrialRewardHtml(p)}

      <div class="section-h">COLLABORATORS</div>
```

- [ ] **Step 3: Wire the claim buttons**

Find, near the end of `renderCollabProjectView` (right after the `initMdBar();` line, around line 2400):

```js
        initMdBar();
        $("j-img-file").addEventListener("change", async () => {
```

Replace with:

```js
        initMdBar();
        if ($("ctr-item") && $("ctr-px")) {
          const prize = p.trial_prize_name || "the Trial reward";
          const total = Math.round(Number(p.my_trial_held_px) || 0);
          const beyond = Math.max(total - Math.round(Number(p.my_trial_prize_px) || 0), 0);
          $("ctr-item").addEventListener("click", () => claimCollabTrialReward(p, "item", prize, total, beyond));
          $("ctr-px").addEventListener("click", () => claimCollabTrialReward(p, "pixels", prize, total, beyond));
        }
        $("j-img-file").addEventListener("change", async () => {
```

- [ ] **Step 4: Manual verification**

There's no automated test harness for this page. Run the server + web-shell locally (`bun run --cwd apps/server dev`, plus however the web-shell is served in dev per this repo's existing README/scripts), have two test accounts where one owns a Trial-linked project and invites the other as a collaborator, both log Hackatime/journal hours clearing the Trial's `min_hours`, ship it, and approve it as a reviewer. Confirm:
- The collaborator's project list/detail view shows the "YOUR TRIAL REWARD" block with their own numbers (not the owner's).
- Clicking either claim button on the collaborator's side settles only their row (`project_collaborators.trial_reward_choice`), doesn't touch the owner's `projects.trial_reward_choice`.
- The owner's own claim UI (unchanged `trialRewardHtml`/`claimTrialReward`) still works exactly as before.

- [ ] **Step 5: Commit**

```bash
git add apps/game/web/projects/index.html
git commit -m "web: collaborators can claim their own trial reward"
```

---

### Task 7: Reviewer-facing per-collaborator min-hours indicator

**Files:**
- Modify: `apps/dashboard/app/_components/ReviewForm.tsx:221-240,379-381`

- [ ] **Step 1: Update `CollaboratorHoursInput` to accept and show the trial minimum**

Find:

```tsx
function CollaboratorHoursInput({ c }: { c: CollaboratorHours }) {
  const [value, setValue] = useState(c.claimedHours);
  return (
    <Label className="flex items-center justify-between gap-2 font-normal text-muted-foreground">
      {c.name}&apos;s hours to credit (decrease only)
      <Input
        name={`collabHours_${c.id}`}
        type="number"
        step="0.1"
        min="0"
        max={c.claimedHours}
        value={value}
        onChange={(e) =>
          setValue(Math.min(c.claimedHours, Math.max(0, Number(e.target.value) || 0)))
        }
        className="w-28 text-sm"
      />
    </Label>
  );
}
```

Replace with:

```tsx
function CollaboratorHoursInput({
  c,
  trialMinHours,
  trialName,
}: {
  c: CollaboratorHours;
  trialMinHours?: number | null;
  trialName?: string;
}) {
  const [value, setValue] = useState(c.claimedHours);
  const clearsTrial = trialMinHours != null && value >= trialMinHours;
  return (
    <div className="flex flex-col gap-1">
      <Label className="flex items-center justify-between gap-2 font-normal text-muted-foreground">
        {c.name}&apos;s hours to credit (decrease only)
        <Input
          name={`collabHours_${c.id}`}
          type="number"
          step="0.1"
          min="0"
          max={c.claimedHours}
          value={value}
          onChange={(e) =>
            setValue(Math.min(c.claimedHours, Math.max(0, Number(e.target.value) || 0)))
          }
          className="w-28 text-sm"
        />
      </Label>
      {trialMinHours != null && (
        <span
          className={`text-[11px] font-medium ${
            clearsTrial ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
          }`}
        >
          {clearsTrial
            ? `Clears "${trialName}"'s ${trialMinHours}h minimum , gets their own Trial reward.`
            : `Below "${trialName}"'s ${trialMinHours}h minimum , normal pixel payout only.`}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Pass the trial info down at the call site**

Find:

```tsx
      {collaborators.map((c) => (
        <CollaboratorHoursInput key={c.id} c={c} />
      ))}
```

Replace with:

```tsx
      {collaborators.map((c) => (
        <CollaboratorHoursInput key={c.id} c={c} trialMinHours={trial?.minHours} trialName={trial?.name} />
      ))}
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/ridit/Documents/Pixl/apps/dashboard && bunx tsc --noEmit 2>&1 | head -50`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/_components/ReviewForm.tsx
git commit -m "review: show reviewers whether each collaborator's hours clear the trial minimum"
```

---

## Self-Review Notes

- **Spec coverage:** all six numbered design sections have a task (schema → Task 1, gate → Task 2, payout loop → Task 3, settlement route → Task 4, web UI → Task 6, reviewer indicator → Task 7); Task 5 (exposing the fields via `GET /api/projects`) is the concrete answer to the spec's open question about "where exactly a collaborator sees their own pending reward." Edge cases from the spec (re-approval not reopening an already-settled choice) are handled by the `cTrialChoice !== "pixels"` / `!== "item"` guards in Task 3, mirroring the owner's existing guards exactly.
- **Type consistency:** `collaboratorCreditHours` (Task 2) is read in both the gate check and Task 3's loop by the same key (`c.id`, the `project_collaborators` row id) - confirmed consistent. `my_trial_reward_choice`/`my_trial_held_px`/`my_trial_prize_px` (Task 5) are read by exactly those names in Task 6's `collabTrialRewardHtml`/button-wiring - confirmed consistent. `trialMinHours`/`trialName` prop names (Task 7) match `trial?.minHours`/`trial?.name`, the same `TrialInfo` shape already used elsewhere in `ReviewForm.tsx`.
- **No placeholders:** every step has complete, copy-pasteable code; the one deliberately-deferred decision (Task 1 Step 3, when to actually run the migration against prod) is a scheduling question for the user given this session's history with prod actions, not a missing detail.
