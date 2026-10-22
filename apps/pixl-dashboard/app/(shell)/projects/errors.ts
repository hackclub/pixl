// Project-specific error copy (ported from the old page's ERRORS map).
import type { ActionDetails } from "@/lib/guarded-action-core";
import { humanizeError } from "@/lib/errors";

const ERRORS: Record<string, string> = {
  name_required: "Give it a name first.",
  repo_not_git: "The repo link must point to a Git repository.",
  repo_not_github: "The repo link must point to a Git repository.",
  ai_notes_required: "Describe how you used AI (at least 10 characters).",
  repo_required: "Add a GitHub repo link before shipping.",
  demo_required: "Add a demo / playable link before shipping.",
  description_required: "Add a description before shipping.",
  image_required: "Upload a thumbnail before shipping.",
  repo_not_found: "That repo link doesn't load. Is it public?",
  demo_unreachable: "The demo link is unreachable.",
  demo_is_repo: "The demo can't be your GitHub repo. Use a playable build or a Releases page.",
  demo_invalid: "That demo link isn't a valid URL.",
  hackatime_hours_required: "Link Hackatime projects with at least 1 hour of coding first.",
  hackatime_unavailable: "Hackatime is unreachable right now, try again in a bit.",
  update_notes_required: "Describe what changed in this update.",
  update_notes_too_short: "Update notes need at least 100 characters.",
  other_ysws_notes_required: "Describe what you updated since your other YSWS submission.",
  other_ysws_notes_too_short: "That description needs at least 100 characters.",
  already_shipped: "This one is already in the review queue.",
  project_banned: "This project is banned and can't be shipped.",
  cdn_not_configured: "Image uploads aren't configured on the server.",
  cdn_failed: "Image upload failed, try again.",
  file_too_large: "That file is too big.",
  invalid_csv: "Upload a valid BOM CSV with a header and at least one part.",
  project_not_found: "That project isn't available.",
  project_required: "Save the project before uploading a BOM.",
  unsupported_type: "That file type isn't supported, use PNG, JPG, or WebP.",
  empty_body: "That upload came through empty, try again.",
  // Any image URL not on the Hack Club CDN (thumbnail, journal images, cart
  // screenshots): the server rejects it so nobody can track viewers.
  invalid_image_url: "Images must be uploaded through Pixl (re-upload this image).",
  busy: "Uploads are busy, try again in a moment.",
  // Redeeming a join code for a project whose owner removed you.
  removed: "You were removed from this project.",
  journal_too_short: "Log more detail: journals need about 100 characters of writing per hour (images don't count).",
  journal_images_required: "Add at least one image to this entry, more for longer sessions.",
  not_in_review: "A reviewer has already started on this project, so it can't be unshipped now. You'll be able to edit it once the review is done.",
  project_in_review: "This project is in review, so its journal is locked until the review is done.",
  trial_hours_below_minimum: "This Trial needs more tracked hours before you can ship it.",
  eligibility_attestation_required: "Confirm this isn't a school assignment or paid Hack Club work before shipping.",
  hca_verification_required: "Verify your identity on Hack Club Auth before shipping.",
  hca_ineligible:
    "You're not eligible to ship. Hack Club Auth has this identity as ineligible for YSWS programs. If you think that's a mistake, reach out to the Pixl team.",
  address_required: "Add a mailing address before shipping.",
  trial_not_accepted: "Accept that Trial in the game first (talk to its NPC), then you can pick it.",
  bom_required: "Upload a Bill of Materials (.csv) before shipping a funded project.",
  cart_screenshot_required: "Upload at least one cart screenshot (with shipping) before shipping a funded project.",
  funding_amount_required: "Enter how much funding you need before shipping.",
  design_demo_invalid: "A CAD Models demo needs a kicanvas.org link (or a video) showing the design.",
  build_demo_video_required:
    "A hardware demo needs to be a video (YouTube, Vimeo, Loom, Streamable, or Google Drive) showing it working.",
  already_imported: "You've already imported that one.",
  // Operation Blackout
  not_accepting_entries: "Operation Blackout isn't taking entries right now.",
  cannot_withdraw:
    "It's already being reviewed for Blackout, you can only opt out before shipping or while changes are requested.",
};

export function projectError(code: string | null | undefined): string {
  return (code && ERRORS[code]) || humanizeError(code);
}

/**
 * Like projectError, but uses the whitelisted server details (journal
 * need/have/hours) for the old page's specific copy. `contentLength` is the
 * journal body the player just submitted (known client-side).
 */
export function projectErrorWith(
  code: string | null | undefined,
  details?: ActionDetails,
  ctx: { contentLength?: number } = {},
): string {
  const d = details ?? {};
  if (code === "journal_too_short" && d.need != null && d.hours != null) {
    const have = ctx.contentLength != null ? ` (you have ${ctx.contentLength})` : "";
    return `Logging ${d.hours}h needs at least ${d.need} characters of writing${have}.`;
  }
  if (code === "journal_images_required" && d.need != null) {
    const have = d.have != null ? ` (you have ${d.have})` : "";
    return `This entry needs ${d.need} image${d.need === 1 ? "" : "s"}${have}.`;
  }
  return projectError(code);
}

/** "Not quite there yet" dialog body for a Trial below its hours minimum. */
export function trialHoursCopy(details?: ActionDetails): string {
  const tail = "You can still ship it, you'll get pixels for the hours you put in, but not this Trial's prize.";
  if (details?.need != null && details.have != null) {
    return `This Trial needs at least ${details.need}h tracked, you're at ${details.have}h. ${tail}`;
  }
  return `This Trial needs more tracked hours than you have. ${tail}`;
}

const HCA_RECHECK_COPY: Record<string, { title: string; body: string }> = {
  pending: {
    title: "Still under review",
    body: "Hack Club Auth has your verification as pending, so Pixl can't confirm it yet. Re-check once it's approved there.",
  },
  needs_submission: {
    title: "Finish verifying",
    body: "Hack Club Auth still needs you to finish identity verification. Do that at auth.hackclub.com, then re-check.",
  },
  unknown: {
    title: "Verify with Hack Club Auth",
    body: "Pixl doesn't have a verified status for your Hack Club account yet. Already verified? Re-check to pull your latest status from Hack Club Auth.",
  },
};

/** Identity-check dialog copy keyed by the server's hca_status. */
export function hcaRecheckCopy(status: string | undefined): { title: string; body: string } {
  return status && Object.hasOwn(HCA_RECHECK_COPY, status) ? HCA_RECHECK_COPY[status] : HCA_RECHECK_COPY.unknown;
}
