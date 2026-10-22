// Ship checklist + blockers, ported from the old page's shipBlockers(). These
// mirror apps/server's ship validation so the button doesn't promise a ship
// the server will refuse. No economy math: hours are server-reported seconds.
import { canShip, type HtStats, type Project } from "../types";
import { htBlockerText, htTotals, isKicanvasUrl, isVideoUrl } from "../format";
import type { FormState } from "./editor-state";

export interface ShipInputs {
  eligible: boolean;
}

export interface CheckItem {
  ok: boolean;
  label: string;
}

export function checklist(form: FormState, stats: HtStats | null, cutoffMs: number): CheckItem[] {
  const isHw = form.kind === "hardware";
  const { counted } = htTotals(stats, form.hackatime);
  const items: CheckItem[] = [
    { ok: !!form.repoUrl.trim(), label: "GitHub repo linked" },
    { ok: !!form.demoUrl.trim(), label: "Demo link added" },
    { ok: !!form.description.trim(), label: "Description written" },
    { ok: !!form.imageUrl, label: "Thumbnail uploaded" },
    isHw
      ? { ok: true, label: "Hardware: hours come from your journal (Hackatime optional)" }
      : { ok: counted >= 3600, label: counted >= 3600 ? "At least 1h of Hackatime linked" : `Hackatime: ${htBlockerText(stats, form.hackatime, cutoffMs)}` },
  ];
  if (isHw && form.needsFunding) {
    items.push(
      { ok: !!form.bomUrl, label: "BOM (.csv) uploaded" },
      { ok: form.cartUrls.length > 0, label: "Cart screenshot(s) added" },
      { ok: Number(form.fundingUsd) > 0, label: "Funding amount entered" },
    );
  }
  return items;
}

export function shipBlockers(
  project: Pick<Project, "status" | "rejected_at">,
  form: FormState,
  stats: HtStats | null,
  cutoffMs: number,
  eligible: boolean,
): string[] {
  const b: string[] = [];
  if (!form.repoUrl.trim()) b.push("add a GitHub repo");
  if (!form.demoUrl.trim()) b.push("add a demo / playable link");
  if (!form.description.trim()) b.push("write a description");
  if (!form.imageUrl) b.push("upload a thumbnail");
  const isHw = form.kind === "hardware";
  if (!isHw && htTotals(stats, form.hackatime).counted < 3600) b.push(htBlockerText(stats, form.hackatime, cutoffMs));
  if (isHw && form.demoUrl.trim()) {
    const demo = form.demoUrl.trim();
    if (form.projectType === "cad") {
      if (!isKicanvasUrl(demo) && !isVideoUrl(demo)) b.push("add a kicanvas.org design link (or a video) as your demo");
    } else if (form.finishedBuild && !isVideoUrl(demo)) {
      b.push("add a video demo showing the build working");
    }
  }
  if (isHw && form.needsFunding) {
    if (!form.bomUrl) b.push("upload a BOM (.csv)");
    if (!form.cartUrls.length) b.push("add a cart screenshot (with shipping)");
    if (!(Number(form.fundingUsd) > 0)) b.push("enter how much funding you need");
  }
  if (!eligible) b.push("confirm this isn't a school assignment or paid Hack Club work");
  if (form.isUpdate && form.updateNotes.trim().length < 100) b.push("describe what changed (100+ characters)");
  if (form.otherYsws && form.otherYswsNotes.trim().length < 100) b.push("describe what you updated (100+ characters)");
  if (!canShip(project)) b.push("this project can't be shipped right now");
  return b;
}
