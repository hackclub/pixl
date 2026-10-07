"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useLiveMode } from "@/app/_components/LiveMode";

export function ReviewTabs({
  isSuper,
  canSecondPass,
  pending,
  secondPassCount,
  secondPassHours,
  spotCheckCount,
  proposedBanCount,
}: {
  isSuper: boolean;
  canSecondPass: boolean;
  pending?: number;
  secondPassCount?: number;
  secondPassHours?: number;
  spotCheckCount?: number;
  proposedBanCount?: number;
}) {
  const pathname = usePathname();
  const live = useLiveMode();
  const tabs: { href: string; label: string; count?: number; extra?: string }[] = [
    { href: "/review", label: "Needs review", count: pending },
    { href: "/review/reviewed", label: "Reviewed" },
    { href: "/review/stats", label: "Stats" },
  ];
  if (canSecondPass) {
    // Anyone who can do the final pass - supers, and anyone else granted the
    // SECOND_PASS marker (e.g. a Sponsor, see addSponsor in app/actions.ts,
    // which promises "review access, including the final pass"). This used to
    // be nested under the isSuper block below, which silently hid the tab
    // from non-super second-pass reviewers even though they could already
    // work the same queue via /review's "Awaiting your final pass" section ,
    // that's easy to miss buried in the main queue, this is a dedicated view
    // of just that stage.
    tabs.push({
      href: "/review/second-pass",
      label: "Second pass",
      count: secondPassCount,
      // Total hours sitting in the queue, not just how many projects - a
      // project count alone doesn't say whether the queue is five quick
      // ships or five 40-hour builds.
      extra: secondPassHours ? `${secondPassHours}h` : undefined,
    });
  }
  if (isSuper) {
    // A first-pass reviewer's "ban" verdict is only a proposal (see
    // reviewProject) - it sits in second_review like any other second-pass
    // work, but a proposed ban is easy to miss buried in that general queue,
    // so it gets its own tab. Read-only list; confirming/overturning still
    // happens on the project's own review page.
    tabs.push({ href: "/review/proposed-bans", label: "Proposed bans", count: proposedBanCount });
    // An optional QA pass over the same second_review stage - not an action
    // queue, just "has a super glanced at how this was first-pass reviewed".
    // Separate from Second pass above since it never blocks or resolves a
    // project, only dismisses itself once spot-checked.
    tabs.push({ href: "/review/spot-check", label: "Spot check", count: spotCheckCount });
    tabs.push({ href: "/review/log", label: "Reviewer log" });
    // Internal reviewer notes - the tab disappears while live (the page
    // itself also refuses to render).
    if (!live) tabs.push({ href: "/review/audit", label: "Audit notes" });
  }
  // The gate that forces a first-time read-through (or a "Skip for now")
  // only fires once per guidelines version, so this is the way back in for
  // anyone who skipped, or just wants a refresher, without the gate blocking
  // every other review page for them again.
  tabs.push({ href: "/review/guidelines", label: "Guidelines" });

  const active = tabs.find((t) => t.href === pathname)?.href ?? "/review";

  return (
    <Tabs value={active} className="mb-6">
      <TabsList variant="line" className="h-auto border-b border-border w-full justify-start rounded-none pb-0">
        {tabs.map((t) => (
          <TabsTrigger key={t.href} value={t.href} asChild className="pb-3">
            <Link href={t.href}>
              {t.label}
              {t.count ? (
                <Badge
                  variant={t.href === active ? "default" : "secondary"}
                  className="ml-1"
                >
                  {t.count}
                </Badge>
              ) : null}
              {t.extra && (
                <span className="ml-1 text-xs text-muted-foreground" title="Total hours pending in this queue">
                  {t.extra}
                </span>
              )}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
