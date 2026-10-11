// The photo on a link-preview card (../project-og.ts, ../player-og.ts,
// ../shop-og.ts). Those image URLs are player- or DB-controlled and the
// endpoints are public, so this is where the cost of one card stays bounded:
//
// - safeFetchBytes (./safeFetch.ts) re-checks every redirect hop and caps
//   the download,
// - decodePNG (./png.ts) refuses oversized images before allocating,
// - and a global budget caps how many remote images get fetched (and so
//   decoded) per window. The handlers ignore every query param but `id`, so
//   `?id=1&x=<random>` sails past any cache in front of them - without this
//   a flood of those keeps the one Bun process busy downloading and
//   decoding. Over budget the card renders without its photo, and the
//   handlers cache that only briefly.
import { safeFetchBytes } from "./safeFetch.ts";

export const IMAGE_BUDGET = { limit: 10, windowMs: 10_000 };

// Fixed-window counter: take() is true while the current window still has
// room, false once `limit` images have been fetched in it.
export function createImageBudget(limit: number, windowMs: number, now: () => number = Date.now) {
  let windowStart = -Infinity;
  let used = 0;
  return function take(): boolean {
    const t = now();
    if (t - windowStart >= windowMs) {
      windowStart = t;
      used = 0;
    }
    if (used >= limit) return false;
    used++;
    return true;
  };
}

const takeImageSlot = createImageBudget(IMAGE_BUDGET.limit, IMAGE_BUDGET.windowMs);

export interface CardImage {
  bytes: Uint8Array | null;
  // The photo was skipped to stay inside the budget, not because it's
  // missing or broken - the caller shouldn't cache that card for long.
  throttled: boolean;
}

export async function fetchCardImage(
  url: string | null | undefined,
  tag: string,
  take: () => boolean = takeImageSlot,
): Promise<CardImage> {
  if (!url) return { bytes: null, throttled: false };
  if (!take()) return { bytes: null, throttled: true };
  try {
    return { bytes: await safeFetchBytes(url), throttled: false };
  } catch (err) {
    console.error(`[${tag}] image fetch failed`, err);
    return { bytes: null, throttled: false };
  }
}
