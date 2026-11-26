import { requirePage, can } from "@/lib/guard";
import { listBans, listBanLog, listBanProposals, banIsActive } from "@/lib/db";
import { LiftBanForm } from "@/app/_components/Moderate";
import { confirmBanProposal, rejectBanProposal } from "@/app/actions";
import {
  ActionButton,
  Badge,
  Card,
  EmptyRow,
  LinkTabs,
  Muted,
  PageHeader,
  Table,
  TextLink,
  formatDate,
  formatDateTime,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

const DESCRIPTIONS = {
  bans: "Every ban ever issued, newest first. Lifting removes all active bans for that player.",
  proposed: "Ban proposals from before moderators were removed, waiting on an owner to confirm or reject.",
  logs: "Every ban and lift action with who did it, newest first.",
};

export default async function BansPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requirePage("owner");
  const canConfirm = can(access, "owner");
  const { tab } = await searchParams;
  const active = tab === "logs" ? "logs" : tab === "proposed" ? "proposed" : "bans";
  const [bans, log, proposals] = await Promise.all([
    active === "bans" ? listBans() : Promise.resolve([]),
    active === "logs" ? listBanLog() : Promise.resolve([]),
    listBanProposals("pending"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Bans" description={DESCRIPTIONS[active]} />

      <Card padding="flush">
        <LinkTabs
          active={active}
          tabs={[
            { key: "bans", href: "/bans", label: "Bans" },
            {
              key: "proposed",
              href: "/bans?tab=proposed",
              label: "Proposed",
              count: proposals.length || undefined,
            },
            { key: "logs", href: "/bans?tab=logs", label: "Ban log" },
          ]}
        />

        {active === "bans" && (
          <Table headers={["Player", "Reason", "Banned by", "Expires", "Status", "Issued", ""]}>
            {bans.map((b) => {
              const isActive = banIsActive(b);
              return (
                <tr key={b.id}>
                  <td>
                    <TextLink href={`/players/${b.user_id}`} className="font-bold">
                      {b.users?.real_name || b.users?.display_name || b.user_id}
                    </TextLink>
                  </td>
                  <td className="max-w-64">
                    <div className="truncate">{b.reason || <Muted>-</Muted>}</div>
                  </td>
                  <td>{b.banned_by}</td>
                  <td className="whitespace-nowrap">
                    <Muted>{b.expires_at ? formatDateTime(b.expires_at) : "Never"}</Muted>
                  </td>
                  <td>
                    {isActive ? (
                      <Badge tone="danger">Active</Badge>
                    ) : b.lifted_at ? (
                      <Badge tone="success">Lifted</Badge>
                    ) : (
                      <Badge>Expired</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <Muted>{formatDate(b.created_at)}</Muted>
                  </td>
                  <td>{isActive && <LiftBanForm userId={b.user_id} />}</td>
                </tr>
              );
            })}
            {bans.length === 0 && <EmptyRow colSpan={7} title="No bans issued yet" icon="checkmark-all" />}
          </Table>
        )}

        {active === "proposed" && (
          <Table headers={["Player", "Reason", "Length", "Proposed", ""]}>
            {proposals.map((p) => {
              const name = p.users?.real_name || p.users?.display_name || p.user_id;
              return (
                <tr key={p.id}>
                  <td>
                    <TextLink href={`/players/${p.user_id}`} className="font-bold">
                      {name}
                    </TextLink>
                  </td>
                  <td className="max-w-md break-words">{p.reason}</td>
                  <td className="whitespace-nowrap">{p.hours > 0 ? `${p.hours}h` : "Permanent"}</td>
                  <td>
                    {p.proposed_by}
                    <div className="text-xs">
                      <Muted>{formatDateTime(p.created_at)}</Muted>
                    </div>
                  </td>
                  <td>
                    {canConfirm ? (
                      <div className="flex justify-end gap-2">
                        <form action={confirmBanProposal}>
                          <input type="hidden" name="id" value={p.id} />
                          <ActionButton
                            variant="danger"
                            size="sm"
                            pendingLabel="Confirming..."
                            confirm={`Confirm the ban on ${name}?`}
                          >
                            Confirm ban
                          </ActionButton>
                        </form>
                        <form action={rejectBanProposal}>
                          <input type="hidden" name="id" value={p.id} />
                          <ActionButton variant="outline" size="sm" pendingLabel="Rejecting...">
                            Reject
                          </ActionButton>
                        </form>
                      </div>
                    ) : (
                      <Muted className="text-xs">Only owners can decide</Muted>
                    )}
                  </td>
                </tr>
              );
            })}
            {proposals.length === 0 && (
              <EmptyRow colSpan={5} title="No bans waiting on confirmation" icon="checkmark-all" />
            )}
          </Table>
        )}

        {active === "logs" && (
          <Table headers={["Action", "Who", "Player", "Detail", "When"]}>
            {log.map((r) => (
              <tr key={r.id}>
                <td>
                  <Badge tone={r.action === "ban" ? "danger" : "success"}>
                    {r.action === "ban" ? "Banned" : "Lifted"}
                  </Badge>
                </td>
                <td className="font-bold">{r.actor}</td>
                <td>
                  <TextLink href={`/players/${r.user_id}`} className="font-bold">
                    {r.player_name}
                  </TextLink>
                </td>
                <td className="max-w-md break-words">{r.detail}</td>
                <td className="whitespace-nowrap">
                  <Muted>{formatDateTime(r.created_at)}</Muted>
                </td>
              </tr>
            ))}
            {log.length === 0 && <EmptyRow colSpan={5} title="No ban actions yet" icon="history" />}
          </Table>
        )}
      </Card>
    </div>
  );
}
