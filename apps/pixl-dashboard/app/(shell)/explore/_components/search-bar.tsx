"use client";

// Search + filters that live in the URL (?q=&tier=&shipped=), so the Server
// Component page does the fetch. Typing is debounced; selects apply at once.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select, spinnerSm } from "@/components/ui/primitives";
import { filtersQuery, parseFilters } from "../lib";

export interface FilterValues {
  q: string;
  tier?: string;
  shipped?: string;
}

export function SearchBar({
  initial,
  placeholder,
  filters = false,
}: {
  initial: FilterValues;
  placeholder: string;
  filters?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [v, setV] = useState<FilterValues>(initial);
  const [pending, startTransition] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const qs = filtersQuery(parseFilters({ q: v.q, tier: v.tier, shipped: v.shipped }));
      startTransition(() => router.replace(`${pathname}${qs}`, { scroll: false }));
    }, 350);
    return () => clearTimeout(t);
  }, [v, pathname, router]);

  return (
    <div className="mb-[18px] flex flex-wrap items-center gap-2.5" aria-busy={pending}>
      <Input
        className="min-w-[180px] flex-1"
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={64}
        value={v.q}
        onChange={(e) => setV((s) => ({ ...s, q: e.target.value }))}
      />
      {filters ? (
        <>
          <Select
            className="w-auto"
            aria-label="Tier"
            value={v.tier ?? "all"}
            onChange={(e) => setV((s) => ({ ...s, tier: e.target.value }))}
          >
            <option value="all">ALL TIERS</option>
            <option value="1">TIER 1</option>
            <option value="2">TIER 2</option>
            <option value="3">TIER 3</option>
            <option value="4">TIER 4</option>
          </Select>
          <Select
            className="w-auto"
            aria-label="Shipped"
            value={v.shipped ?? "all"}
            onChange={(e) => setV((s) => ({ ...s, shipped: e.target.value }))}
          >
            <option value="all">ALL PROJECTS</option>
            <option value="shipped">SHIPPED</option>
            <option value="unshipped">UNSHIPPED</option>
          </Select>
        </>
      ) : null}
      {pending ? <span className={spinnerSm} aria-hidden /> : null}
    </div>
  );
}
