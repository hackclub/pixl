"use server";

// Project create/edit/ship/delete and file uploads. Each action calls
// exactly one apps/server endpoint through guardedAction.
import { z } from "zod";
import { guardedAction, json } from "@/lib/guarded-action";

const pid = z.coerce.number().int().positive().max(2_147_483_647);
const url = z.string().trim().max(2048);
const PROJECT_TYPES = ["web", "windows", "mac", "linux", "cross_platform", "python", "android", "ios", "hardware", "cad", "other"] as const;

const projectFields = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000),
  repoUrl: z.string().trim().max(500),
  demoUrl: z.string().trim().max(10000),
  imageUrl: url,
  usedAi: z.boolean(),
  aiNotes: z.string().max(2000),
  projectType: z.enum(PROJECT_TYPES),
  level: z.number().int().min(1).max(4),
  kind: z.enum(["software", "hardware"]),
  needsFunding: z.boolean(),
  finishedBuild: z.boolean(),
  fundingUsd: z.number().min(0).max(100000),
  bomUrl: url,
  cartScreenshotUrls: z.array(url).max(20),
  sidequestId: z.number().int().positive().nullable(),
  hackatimeProjects: z.array(z.string().max(200)).max(200),
  otherYsws: z.boolean(),
  otherYswsNotes: z.string().max(2000),
});

const revalidate = (id?: number) => (id ? ["/projects", `/projects/${id}`] : ["/projects"]);

export const createProject = guardedAction(
  "project.create",
  projectFields,
  (body) => ({ method: "POST", path: "/api/projects", body: json(body) }),
  { revalidate: revalidate(), pick: (d: { project?: { id?: unknown } }) => ({ id: Number(d?.project?.id) }) },
);

export const updateProject = guardedAction(
  "project.update",
  z.object({ id: pid, fields: projectFields }),
  ({ id, fields }) => ({ method: "PUT", path: `/api/projects/${id}`, body: json(fields), target: `project:${id}` }),
  { revalidate: ["/projects"], pick: () => ({ saved: true }) },
);

export const deleteProject = guardedAction(
  "project.delete",
  z.object({ id: pid }),
  ({ id }) => ({ method: "DELETE", path: `/api/projects/${id}`, target: `project:${id}` }),
  { revalidate: revalidate(), pick: () => ({ deleted: true }) },
);

export const checkProjectReadme = guardedAction(
  "project.readme_check",
  z.object({ id: pid, repoUrl: z.string().trim().min(1).max(500) }),
  ({ id, repoUrl }) => ({ method: "POST", path: `/api/projects/${id}/readme-check`, body: json({ repoUrl }), target: `project:${id}` }),
  {
    pick: (d: { status: "passed" | "too_short" | "missing" | "unavailable" | "unsupported"; chars: number | null; minChars: number }) => ({
      status: d.status,
      chars: d.chars,
      minChars: d.minChars,
    }),
  },
);

export const shipProject = guardedAction(
  "project.ship",
  z.object({
    id: pid,
    otherYsws: z.boolean(),
    eligibilityAttested: z.boolean(),
    shipNote: z.string().max(2000),
    updateNotes: z.string().max(8000).optional(),
    otherYswsNotes: z.string().max(2000).optional(),
    sidequestId: z.number().int().min(0),
    acceptNoTrialPrize: z.boolean().optional(),
  }),
  ({ id, ...body }) => ({ method: "POST", path: `/api/projects/${id}/ship`, body: json(body), target: `project:${id}` }),
  { revalidate: ["/projects"], pick: () => ({ shipped: true }) },
);

export const unshipProject = guardedAction(
  "project.unship",
  z.object({ id: pid }),
  ({ id }) => ({ method: "POST", path: `/api/projects/${id}/unship`, target: `project:${id}` }),
  { revalidate: ["/projects"], pick: () => ({ unshipped: true }) },
);

export const claimTrialReward = guardedAction(
  "project.trial_reward",
  z.object({ id: pid, choice: z.enum(["item", "pixels"]) }),
  ({ id, choice }) => ({
    method: "POST",
    path: `/api/projects/${id}/trial-reward`,
    body: json({ choice }),
    target: `project:${id}`,
  }),
  { revalidate: ["/projects", "/orders"], pick: () => ({ claimed: true }) },
);

// ---- uploads ---------------------------------------------------------------

// Images (up to 15MB) are NOT a Server Action: they go through the
// /api/uploads/image route handler (lib/upload-route.ts) so the global Server
// Action body limit can stay at 1MB. A 512KB CSV fits under that limit.
const MAX_CSV_BYTES = 512 * 1024;

const bomForm = z.instanceof(FormData).transform((fd, ctx) => {
  const file = fd.get("file");
  const projectId = Number(fd.get("projectId"));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    ctx.addIssue({ code: "custom", message: "project required" });
    return z.NEVER;
  }
  if (!(file instanceof Blob) || file.size === 0 || file.size > MAX_CSV_BYTES) {
    ctx.addIssue({ code: "custom", message: "bad csv" });
    return z.NEVER;
  }
  return { file, projectId };
});

export const uploadBom = guardedAction(
  "upload.bom",
  bomForm,
  ({ file, projectId }) => ({
    method: "POST",
    path: `/api/projects/${projectId}/bom`,
    body: { kind: "raw", value: file, contentType: "text/csv" },
    target: `project:${projectId}`,
  }),
  { pick: (d: { url?: unknown }) => ({ url: typeof d?.url === "string" ? d.url : "" }) },
);
