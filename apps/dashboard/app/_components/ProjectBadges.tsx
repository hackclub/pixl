import { Badge as UIBadge } from "@/components/ui/badge";

type Tone = "gray" | "green" | "amber" | "rose" | "blue" | "violet";

const TONE_VARIANT = {
  gray: "secondary",
  green: "success",
  amber: "warning",
  rose: "destructive",
  blue: "info",
  violet: "violet",
} as const;

export function Badge({
  tone = "gray",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return <UIBadge variant={TONE_VARIANT[tone]}>{children}</UIBadge>;
}

const STATUS: Record<string, { label: string; tone: Tone; dot: string }> = {
  draft: { label: "Draft", tone: "gray", dot: "bg-gray-400" },
  ai_review: { label: "AI pre-screen", tone: "blue", dot: "bg-blue-500" },
  shipped: { label: "In review", tone: "amber", dot: "bg-amber-500" },
  fraud_review: { label: "Fraud review", tone: "blue", dot: "bg-blue-500" },
  second_review: { label: "Final review", tone: "violet", dot: "bg-violet-500" },
  approved: { label: "Approved", tone: "green", dot: "bg-emerald-500" },
  needs_changes: { label: "Needs changes", tone: "rose", dot: "bg-rose-500" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "gray" as const, dot: "bg-gray-400" };
  return (
    <Badge tone={s.tone}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </Badge>
  );
}

const LEVEL_NAMES = ["Greenhorn", "Deputy", "Outlaw", "Legend"];

export function LevelBadge({ level }: { level: number }) {
  const idx = Math.min(Math.max(Math.round(level) || 1, 1), 4);
  return (
    <Badge tone="blue">
      L{idx} · {LEVEL_NAMES[idx - 1]}
    </Badge>
  );
}

const TYPE_LABELS: Record<string, string> = {
  web: "Web playable",
  windows: "Windows",
  mac: "Mac",
  linux: "Linux",
  cross_platform: "Cross-platform",
  python: "Python",
  android: "Android",
  ios: "iOS",
  hardware: "Hardware",
  cad: "CAD models",
  other: "Other / not sure",
};

// The kind of thing the maker shipped, so a reviewer knows how to run/judge it.
export function TypeBadge({ type }: { type?: string | null }) {
  if (!type) return null;
  return <Badge tone="gray">{TYPE_LABELS[type] ?? type}</Badge>;
}

// Reviewer-nominated standout project. Cosmetic only, see toggleProjectPeak.
export function BeaconBadge() {
  return <Badge tone="amber">★ Beacon</Badge>;
}

// Hardware-only funding ask, set by the player via needs_funding. See the
// funding panel in review/[id]/page.tsx for the BOM / cart screenshot detail.
export function FundingBadge({
  needsFunding,
  fundingUsd,
}: {
  needsFunding: boolean;
  fundingUsd?: number | null;
}) {
  if (!needsFunding) return null;
  return (
    <Badge tone="green">
      Funding: {fundingUsd ? `$${Number(fundingUsd).toFixed(2)}` : "requested"}
    </Badge>
  );
}

export function ShipBadges({
  project,
}: {
  project: { is_update: boolean; used_ai: boolean; other_ysws: boolean };
}) {
  return (
    <>
      {project.is_update && <Badge tone="blue">Update</Badge>}
      {project.used_ai && <Badge tone="violet">AI used</Badge>}
      {project.other_ysws && <Badge tone="amber">Other YSWS disclosed</Badge>}
    </>
  );
}
