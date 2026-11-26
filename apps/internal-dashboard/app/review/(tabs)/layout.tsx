import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requirePage, landingFor } from "@/lib/guard";
import { countReviewTabs } from "@/lib/db";
import { ReviewTabs } from "@/app/_components/ReviewTabs";
import { PageHeader } from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

type TabProps = React.ComponentProps<typeof ReviewTabs>;

// Streams badges
async function ReviewTabsWithCounts({
  wants,
  ...tabProps
}: Omit<TabProps, "pending" | "spotCheckCount" | "proposedBanCount"> & {
  wants: { pending: boolean; spotCheck: boolean; proposedBans: boolean } | null;
}) {
  const counts = wants ? await countReviewTabs() : null;
  return (
    <ReviewTabs
      {...tabProps}
      pending={wants?.pending ? counts?.pending : undefined}
      spotCheckCount={wants?.spotCheck ? counts?.spotCheck : undefined}
      proposedBanCount={wants?.proposedBans ? counts?.proposedBans : undefined}
    />
  );
}

// Shared chrome for every /review/* tab. Keeping the tab bar (and its badge
// count queries) in the layout means it stays mounted across tab clicks, and
// loading.tsx only swaps the content below it.
export default async function ReviewLayout({ children }: { children: React.ReactNode }) {
  // Fraud reviewers get in too, but only to the Fraud reviews tab: every
  // other tab page re-checks requirePage("reviewer") and bounces them.
  const access = await requirePage("staff");
  if (!access.isReviewer && !access.canFraudReview) redirect(landingFor(access));
  const fraudOnly = !access.isReviewer && !access.isOwner;
  // Spot check is worked by owners and final reviewers (second_pass).
  const canSpotCheck = access.isOwner || access.canSecondPass;
  const tabProps = {
    isSuper: access.isOwner,
    canSpotCheck,
    canFraudReview: access.canFraudReview,
    fraudOnly,
  };
  const countsNeeded = !fraudOnly || canSpotCheck || access.isOwner;
  const wants = { pending: !fraudOnly, spotCheck: canSpotCheck, proposedBans: access.isOwner };

  return (
    <div>
      <PageHeader
        title="Review"
        description={fraudOnly ? "Robert's fraud scores." : "Ship queue, verdict history and reviewer stats."}
      />
      <Suspense fallback={<ReviewTabs {...tabProps} />}>
        <ReviewTabsWithCounts {...tabProps} wants={countsNeeded ? wants : null} />
      </Suspense>
      {children}
    </div>
  );
}
