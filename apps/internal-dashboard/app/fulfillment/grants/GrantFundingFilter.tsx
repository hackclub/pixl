"use client";

import { useRouter } from "next/navigation";
import { NativeSelect } from "@/app/_ui/ui";
import { ELIGIBILITY_LABEL, ELIGIBILITY_RISK_FILTERS } from "@/lib/eligibility/format";

// One compact select instead of the fulfillment queue's full filter panel.
// Options are in risk order so the same order as the table sort is visible.
export function GrantFundingFilter({
  scope,
  funding,
}: {
  scope: "pending" | "open";
  funding: string;
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hc-muted">Funding</span>
      <NativeSelect
        value={funding}
        aria-label="Filter grant rows by funding status"
        title="Sorted least to most risk: Covered, Review, Unverified, Restricted, Insufficient"
        onChange={(event) => {
          const params = new URLSearchParams();
          if (scope === "open") params.set("scope", "open");
          if (event.target.value !== "all") params.set("funding", event.target.value);
          const query = params.toString();
          router.push(`/fulfillment/grants${query ? `?${query}` : ""}`, { scroll: false });
        }}
      >
        <option value="all">All</option>
        {ELIGIBILITY_RISK_FILTERS.map((status) => (
          <option key={status} value={status}>
            {ELIGIBILITY_LABEL[status]}
          </option>
        ))}
        <option value="not_loaded">Not loaded</option>
      </NativeSelect>
    </label>
  );
}
