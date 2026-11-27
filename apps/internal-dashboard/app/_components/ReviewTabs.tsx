"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CountBadge } from "@/app/_ui/ui";

export function ReviewTabs({
  isSuper,
  canSpotCheck,
  canFraudReview,
  fraudOnly,
  pending,
  spotCheckCount,
  proposedBanCount,
}: {
  isSuper: boolean;
  /** Owners and final reviewers (second_pass) work the Spot check queue. */
  canSpotCheck: boolean;
  canFraudReview: boolean;
  fraudOnly: boolean;
  pending?: number;
  spotCheckCount?: number;
  proposedBanCount?: number;
}) {
  const pathname = usePathname();
  // A fraud reviewer sees the Fraud reviews tab and nothing else.
  const tabs: { href: string; label: string; count?: number }[] = fraudOnly
    ? []
    : [
        { href: "/review", label: "Needs review", count: pending },
        { href: "/review/reviewed", label: "Reviewed" },
        { href: "/review/stats", label: "Stats" },
        { href: "/review/ending-score", label: "Pixl ending score" },
      ];
  if (canFraudReview) {
    // Every score Robert's fraud reviewer has given, newest first, including
    // projects that already left Spot check.
    tabs.push({ href: "/review/fraud-reviews", label: "Fraud reviews" });
  }
  if (isSuper) {
    // A first-pass "ban" verdict is only a proposal (see reviewProject). It
    // sits in second_review like any other second-pass work, but is easy to
    // miss there, so it gets its own read-only tab.
    tabs.push({ href: "/review/proposed-bans", label: "Proposed bans", count: proposedBanCount });
  }
  if (canSpotCheck) tabs.push({ href: "/review/spot-check", label: "Spot check", count: spotCheckCount });
  if (isSuper) {
    tabs.push({ href: "/review/log", label: "Reviewer log" });
    tabs.push({ href: "/review/audit", label: "Audit notes" });
  }
  // The guidelines gate only fires once per guidelines version, so this is
  // the way back in for anyone who skipped or wants a refresher.
  if (!fraudOnly) tabs.push({ href: "/review/guidelines", label: "Guidelines" });

  const active = tabs.find((t) => t.href === pathname)?.href ?? tabs[0]?.href;

  return (
    <div className="hc-tabs hc-tabs-fill mb-6" role="tablist">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="hc-tab gap-2" role="tab" aria-selected={t.href === active}>
          {t.label}
          {t.count ? <CountBadge>{t.count}</CountBadge> : null}
        </Link>
      ))}
    </div>
  );
}
