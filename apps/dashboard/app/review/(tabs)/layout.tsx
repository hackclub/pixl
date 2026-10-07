import { requirePagePerm } from "@/lib/guard";
import {
  countPendingReviews,
  countSecondPassReviews,
  sumSecondPassHours,
  countSpotCheckProjects,
  countProposedBanProjects,
} from "@/lib/db";
import { ReviewTabs } from "@/app/_components/ReviewTabs";
import { ShowReviewerNames } from "@/app/_components/ShowReviewerNames";
import { getLiveMode, getHideReviewers } from "@/lib/liveModeServer";

export const dynamic = "force-dynamic";

// Shared chrome for every /review/* page. ReviewTabs used to be rendered
// separately inside each page, so it (and its badge-count queries) unmounted
// and re-fetched on every single tab click, which is what made switching
// tabs feel slow, this keeps the tab bar mounted across navigations, with a
// route-level loading.tsx (see loading.tsx in this folder) swapping only the
// content below it while a tab's own data loads.
export default async function ReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await requirePagePerm(["review"]);
  // "Needs review" is first-pass ("shipped") work only, for every viewer
  // regardless of role - second-pass work has its own "Second pass"
  // tab/badge below, so folding it in here just made this badge show a
  // combined total that didn't match either queue.
  const [pending, secondPassCount, secondPassHours, spotCheckCount, proposedBanCount] = await Promise.all([
    countPendingReviews({ viewer: access.session.slackId }),
    access.canSecondPass ? countSecondPassReviews() : Promise.resolve(undefined),
    access.canSecondPass ? sumSecondPassHours() : Promise.resolve(undefined),
    access.isSuper ? countSpotCheckProjects() : Promise.resolve(undefined),
    access.isSuper ? countProposedBanProjects() : Promise.resolve(undefined),
  ]);
  const [live, hideReviewers] = await Promise.all([getLiveMode(), getHideReviewers()]);
  return (
    <>
      <ReviewTabs
        isSuper={access.isSuper}
        canSecondPass={access.canSecondPass}
        pending={pending}
        secondPassCount={secondPassCount}
        secondPassHours={secondPassHours}
        spotCheckCount={spotCheckCount}
        proposedBanCount={proposedBanCount}
      />
      {/* While live, other reviewers' names are hidden on every review tab;
          this reveals (or re-hides) them. */}
      {live && (
        <div className="flex justify-end mb-4">
          <ShowReviewerNames hidden={hideReviewers} />
        </div>
      )}
      {children}
    </>
  );
}
