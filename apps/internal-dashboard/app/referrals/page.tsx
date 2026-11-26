import { requirePage } from "@/lib/guard";
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
import {
  Badge,
  Card,
  CardHeader,
  CountBadge,
  EmptyRow,
  Muted,
  PageHeader,
  Stat,
  StatGrid,
  Table,
  formatDate,
} from "@/app/_ui/ui";
import PaginatedTable from "@/app/_ui/PaginatedTable";

export const dynamic = "force-dynamic";

const usd = (px: number) => `$${(px * config.economy.pixelValueUsd).toFixed(2)}`;

export default async function ReferralsPage() {
  await requirePage("owner");

  const referrals = await listReferrals();
  const leaderboard = await referrerLeaderboard(referrals);

  const rewarded = referrals.filter((r) => r.rewarded_at);
  const totalPixelsPaid =
    rewarded.reduce((s, r) => s + (Number(r.reward_pixels) || 0), 0) +
    leaderboard.reduce((s, r) => s + r.milestones * REFERRAL_MILESTONE_PX, 0);
  const tiers = [...REFERRAL_TIERS]
    .sort((a, b) => a.minHours - b.minHours)
    .map((t) => `${t.minHours}h pays ${t.px}px (${usd(t.px)})`)
    .join(", ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Referrals"
        count={referrals.length}
        description={
          <>
            A referrer is paid once their referred player ships a project clearing an hour tier ({tiers}), then
            the referral closes. Every {REFERRAL_MILESTONE_EVERY} rewarded referrals also pays a{" "}
            {REFERRAL_MILESTONE_PX}px (~{usd(REFERRAL_MILESTONE_PX)}) milestone bonus. Referred players get a flat +
            {REFERRAL_BOOST_PX_PER_HOUR}px/hr (~{usd(REFERRAL_BOOST_PX_PER_HOUR)}/hr) boost on their first{" "}
            {REFERRAL_BOOST_SHIP_CAP} approved ships. 1px = ${config.economy.pixelValueUsd.toFixed(2)}.
          </>
        }
      />

      <StatGrid>
        <Stat label="Total referrals" value={referrals.length} icon="friend" />
        <Stat label="Rewarded" value={rewarded.length} icon="checkmark" tone="success" />
        <Stat label="Open (unrewarded)" value={referrals.length - rewarded.length} icon="clock" />
        <Stat label="Pixels paid out" value={`${totalPixelsPaid}px`} hint={usd(totalPixelsPaid)} icon="bank" />
      </StatGrid>

      <Card padding="flush">
        <CardHeader title="Top referrers" icon="leader" count={Math.min(25, leaderboard.length)} />
        <Table headers={["Referrer", "Rewarded / Total", "Milestones", "Pixels earned"]}>
          {leaderboard.slice(0, 25).map((r) => (
            <tr key={r.referrerId}>
              <td className="font-bold">{r.name}</td>
              <td>
                {r.rewarded} / {r.total}
              </td>
              <td>{r.milestones > 0 ? <CountBadge>{r.milestones}</CountBadge> : <Muted>-</Muted>}</td>
              <td>
                {r.pixelsEarned}px <Muted>({usd(r.pixelsEarned)})</Muted>
              </td>
            </tr>
          ))}
          {leaderboard.length === 0 && <EmptyRow colSpan={4} title="No referrals yet" icon="friend" />}
        </Table>
      </Card>

      <Card padding="flush">
        <CardHeader title="All referrals" icon="list" count={referrals.length} />
        {referrals.length === 0 ? (
          <Table headers={["Referrer", "Referred", "Created", "Boost used", "Status"]}>
            <EmptyRow colSpan={5} title="No referrals yet" icon="friend" />
          </Table>
        ) : (
          <PaginatedTable
            pageSize={25}
            headers={["Referrer", "Referred", "Created", "Boost used", "Status"]}
            rows={referrals.map((r) => (
              <tr key={r.id}>
                <td className="font-bold">{r.referrer_name}</td>
                <td>{r.referred_name}</td>
                <td className="text-sm">
                  <Muted>{formatDate(r.created_at)}</Muted>
                </td>
                <td>
                  <Muted>
                    {r.boosted_ships}/{REFERRAL_BOOST_SHIP_CAP}
                  </Muted>
                </td>
                <td>
                  {r.rewarded_at ? (
                    <Badge tone="success">
                      rewarded {r.reward_tier} · {r.reward_pixels}px
                    </Badge>
                  ) : (
                    <Badge tone="neutral" outline>
                      open
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          />
        )}
      </Card>
    </div>
  );
}
