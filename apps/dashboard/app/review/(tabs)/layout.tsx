import { requirePagePerm } from "@/lib/guard";
import { countPendingReviews, countSecondPassReviews } from "@/lib/db";
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
  const [pending, secondPassCount] = await Promise.all([
    countPendingReviews(),
    access.isSuper ? countSecondPassReviews() : Promise.resolve(undefined),
  ]);
  return (
    <div>
      <ReviewTabs isSuper={access.isSuper} pending={pending} secondPassCount={secondPassCount} />
      {children}
    </div>
  );
}
