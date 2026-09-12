import { requirePagePerm } from "@/lib/guard";
import { countPendingReviews, countSecondPassReviews, countSpotCheckProjects } from "@/lib/db";
import { ReviewTabs } from "@/app/_components/ReviewTabs";

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
  // Scoped to the viewer's role. This used to call countPendingReviews() with
  // no arguments, which returns the raw global shipped + second_review count -
  // so a plain reviewer's "Needs review" badge included final-pass work they
  // can't see in the queue below it or action at all, and disagreed with the
  // sidebar badge (app/layout.tsx), which was already passing the viewer.
  const [pending, secondPassCount, spotCheckCount] = await Promise.all([
    countPendingReviews({
      viewer: access.session.slackId,
      canSecondPass: access.canSecondPass,
    }),
    access.isSuper ? countSecondPassReviews() : Promise.resolve(undefined),
    access.isSuper ? countSpotCheckProjects() : Promise.resolve(undefined),
  ]);
  return (
    <div>
      <ReviewTabs
        isSuper={access.isSuper}
        pending={pending}
        secondPassCount={secondPassCount}
        spotCheckCount={spotCheckCount}
      />
      {children}
    </div>
  );
}
