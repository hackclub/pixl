import { Badge } from "@/components/ui/badge";

export function BlackoutBadge({ className = "" }: { className?: string }) {
  return (
    <Badge
      variant="warning"
      className={`font-bold uppercase tracking-wide text-[0.65rem] border border-amber-400/60 ${className}`}
      title="Operation Blackout entry"
    >
      Blackout
    </Badge>
  );
}
