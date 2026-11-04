// Editor form state shared by the project form and the ship panel (shipping
// first saves what the form currently holds, like the old page did).
import type { Project } from "../types";

export interface FormState {
  name: string;
  description: string;
  repoUrl: string;
  demoUrl: string;
  imageUrl: string;
  kind: "software" | "hardware";
  projectType: string;
  isGame: boolean;
  level: number;
  usedAi: boolean;
  aiNotes: string;
  needsFunding: boolean;
  finishedBuild: boolean;
  fundingUsd: string;
  bomUrl: string;
  cartUrls: string[];
  sidequestId: string;
  hackatime: string[];
  otherYsws: boolean;
  otherYswsNotes: string;
  /** Approved project being shipped again as an update. */
  isUpdate: boolean;
  updateNotes: string;
}

export type SetForm = (patch: Partial<FormState>) => void;

export function initialForm(p: Partial<Project>, trialId?: number | null): FormState {
  return {
    name: p.name ?? "",
    description: p.description ?? "",
    repoUrl: p.repo_url ?? "",
    demoUrl: p.demo_url ?? "",
    imageUrl: p.image_url ?? "",
    kind: p.kind === "hardware" ? "hardware" : "software",
    projectType: p.project_type ?? "other",
    isGame: p.is_game === true,
    level: p.level ?? 1,
    usedAi: !!p.used_ai,
    aiNotes: p.ai_notes ?? "",
    needsFunding: !!p.needs_funding,
    finishedBuild: !!p.finished_build,
    fundingUsd: p.funding_usd ? String(p.funding_usd) : "",
    bomUrl: p.bom_url ?? "",
    cartUrls: [...(p.cart_screenshot_urls ?? [])],
    sidequestId: p.sidequest_id != null ? String(p.sidequest_id) : trialId ? String(trialId) : "",
    hackatime: [...(p.hackatime_projects ?? [])],
    otherYsws: !!p.other_ysws,
    otherYswsNotes: p.other_ysws_notes ?? "",
    isUpdate: p.status === "approved" && !p.rejected_at,
    updateNotes: "",
  };
}

const TYPES = new Set(["web", "windows", "mac", "linux", "cross_platform", "python", "android", "ios", "hardware", "cad", "other"]);

/** Body for POST /api/projects and PUT /api/projects/:id. */
export function toFields(f: FormState) {
  return {
    name: f.name.trim(),
    description: f.description.trim(),
    repoUrl: f.repoUrl.trim(),
    demoUrl: f.demoUrl.trim(),
    imageUrl: f.imageUrl,
    usedAi: f.usedAi,
    aiNotes: f.aiNotes.trim(),
    projectType: (TYPES.has(f.projectType) ? f.projectType : "other") as "other",
    isGame: f.isGame,
    level: Math.min(Math.max(Math.trunc(f.level) || 1, 1), 4),
    kind: f.kind,
    needsFunding: f.kind === "hardware" && f.needsFunding,
    finishedBuild: f.kind === "hardware" && f.finishedBuild,
    fundingUsd: Math.min(Math.max(Number(f.fundingUsd) || 0, 0), 100000),
    bomUrl: f.bomUrl,
    cartScreenshotUrls: f.cartUrls,
    sidequestId: f.sidequestId ? Number(f.sidequestId) : null,
    hackatimeProjects: f.hackatime,
    otherYsws: f.otherYsws,
    otherYswsNotes: f.otherYsws ? f.otherYswsNotes.trim() : "",
  };
}
