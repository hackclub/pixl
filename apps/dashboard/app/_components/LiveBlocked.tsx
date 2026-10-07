import { Card } from "@/components/ui/card";

// Stand-in for a page that is nothing but PII (fulfillment, Slack lookup, ...)
// while live mode is on. Rendered instead of the page, so the data is never
// even fetched.
export function LiveBlocked({
  what,
  reason = "This page is full of personal details",
}: {
  what: string;
  reason?: string;
}) {
  return (
    <Card className="p-8 max-w-lg mx-auto mt-10 text-center gap-2">
      <div className="text-base font-semibold">{what} is hidden in live mode</div>
      <div className="text-sm text-muted-foreground">
        {reason}, so it stays closed while you are live. Turn off live mode in the top bar to open it.
      </div>
    </Card>
  );
}
