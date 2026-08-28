import { requirePagePerm } from "@/lib/guard";
import { GuidelinesGate } from "@/app/_components/GuidelinesGate";

export const dynamic = "force-dynamic";

// The first-time guidelines gate. Reviewer-only, but deliberately does NOT call
// requireGuidelinesAck (that's what redirects here) — otherwise it would loop.
export default async function ReviewGuidelinesPage() {
  await requirePagePerm(["review"]);
  return <GuidelinesGate />;
}
