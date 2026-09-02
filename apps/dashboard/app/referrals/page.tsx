import { redirect } from "next/navigation";
import { requirePagePerm } from "@/lib/guard";
import {
  listReferrals,
  referrerLeaderboard,
  REFERRAL_BOOST_PX_PER_HOUR,
  REFERRAL_BOOST_SHIP_CAP,
  REFERRAL_MILESTONE_EVERY,
  REFERRAL_MILESTONE_PX,
  REFERRAL_TIERS,
} from "@/lib/db";
import { config } from "@/app/_generated/config";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ReferralsPage() {
  const access = await requirePagePerm(["referrals"]);

  const referrals = await listReferrals();
  const leaderboard = await referrerLeaderboard(referrals);

  const rewarded = referrals.filter((r) => r.rewarded_at);
  const totalPixelsPaid =
    rewarded.reduce((s, r) => s + (Number(r.reward_pixels) || 0), 0) +
    leaderboard.reduce((s, r) => s + r.milestones * REFERRAL_MILESTONE_PX, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Referrals</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          A referrer is paid once their referred player ships a project clearing an hour tier
          (
          {[...REFERRAL_TIERS]
            .sort((a, b) => a.minHours - b.minHours)
            .map((t) => `${t.minHours}h → ${t.px}px/$${(t.px * config.economy.pixelValueUsd).toFixed(2)}`)
            .join(", ")}
          ), then the referral closes. Every {REFERRAL_MILESTONE_EVERY} rewarded referrals also
          pays a {REFERRAL_MILESTONE_PX}px (~$
          {(REFERRAL_MILESTONE_PX * config.economy.pixelValueUsd).toFixed(2)}) milestone bonus.
          Referred players get a flat +{REFERRAL_BOOST_PX_PER_HOUR}px/hr (~$
          {(REFERRAL_BOOST_PX_PER_HOUR * config.economy.pixelValueUsd).toFixed(2)}/hr) boost on
          their first {REFERRAL_BOOST_SHIP_CAP} approved ships. 1px = $
          {config.economy.pixelValueUsd.toFixed(2)}.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total referrals</div>
          <div className="text-2xl font-semibold mt-1">{referrals.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Rewarded</div>
          <div className="text-2xl font-semibold mt-1">{rewarded.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Open (unrewarded)</div>
          <div className="text-2xl font-semibold mt-1">{referrals.length - rewarded.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Pixels paid out</div>
          <div className="text-2xl font-semibold mt-1">
            {totalPixelsPaid} <span className="text-sm text-muted-foreground">(${(totalPixelsPaid * config.economy.pixelValueUsd).toFixed(2)})</span>
          </div>
        </Card>
      </div>

      <Card className="p-5 md:p-6 gap-4">
        <div className="text-sm font-semibold">Top referrers</div>
        {leaderboard.length === 0 ? (
          <div className="text-sm text-muted-foreground">No referrals yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referrer</TableHead>
                <TableHead>Rewarded / Total</TableHead>
                <TableHead>Milestones</TableHead>
                <TableHead className="text-right">Pixels earned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.slice(0, 25).map((r) => (
                <TableRow key={r.referrerId}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    {r.rewarded} / {r.total}
                  </TableCell>
                  <TableCell>{r.milestones > 0 ? <Badge variant="secondary">{r.milestones}</Badge> : "-"}</TableCell>
                  <TableCell className="text-right">
                    {r.pixelsEarned}px (${(r.pixelsEarned * config.economy.pixelValueUsd).toFixed(2)})
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-5 md:p-6 gap-4">
        <div className="text-sm font-semibold">All referrals</div>
        {referrals.length === 0 ? (
          <div className="text-sm text-muted-foreground">No referrals yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referrer</TableHead>
                <TableHead>Referred</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Boost used</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {referrals.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.referrer_name}</TableCell>
                  <TableCell>{r.referred_name}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(r.created_at)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.boosted_ships}/{REFERRAL_BOOST_SHIP_CAP}
                  </TableCell>
                  <TableCell>
                    {r.rewarded_at ? (
                      <Badge>
                        rewarded {r.reward_tier} &middot; {r.reward_pixels}px
                      </Badge>
                    ) : (
                      <Badge variant="outline">open</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
