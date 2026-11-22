import { markGrantSent, unclaimOrder } from "@/app/actions";
import { GrantSelectionToolbar } from "./GrantSelectionToolbar";
import { requirePage } from "@/lib/guard";
import { GRANT_SCOPE_LABEL, loadGrantExportPage, parseGrantScope } from "@/lib/grantExportData";
import { GRANT_STAGE_LABEL } from "@/lib/fulfillmentGrant";
import { ELIGIBILITY_HINT, ELIGIBILITY_LABEL, ELIGIBILITY_SHORT, ELIGIBILITY_TONE } from "@/lib/eligibility/format";
import {
  ActionButton,
  Badge,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  Details,
  EmptyState,
  Field,
  Input,
  Mono,
  Muted,
  PageHeader,
  Stat,
  StatGrid,
  Table,
  TextLink,
  buttonClass,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Turns the grant orders waiting in fulfillment into the CSV that HCB's
// "Bulk send card grants" uploader takes. The dashboard never talks to HCB:
// an owner downloads the file, checks it, uploads it in HCB, and records each
// grant's link here (or on its order) with "Mark sent".
export default async function GrantExportPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const access = await requirePage("owner");

  const { scope: rawScope } = await searchParams;
  const scope = parseGrantScope(rawScope);
  const { data, funding } = await loadGrantExportPage(scope);
  const { rows, problems, totalCents } = data;

  const covered = rows.filter((row) => funding.get(row.orderId)?.status === "covered").length;
  const uncovered = rows.filter((row) => {
    const result = funding.get(row.orderId);
    return result !== undefined && result.status !== "covered";
  });
  const fundingLoaded = rows.length === 0 || funding.size > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Grant CSV"
        description="Every grant order that still needs an HCB card grant, in the format HCB's bulk uploader accepts."
        actions={
          <ButtonLink href="/fulfillment" variant="outline" size="sm" icon="view-back">
            Back to fulfillment
          </ButtonLink>
        }
      />

      <Callout tone="info" icon="payment">
        <strong>This page only makes a file.</strong> Nothing is sent from the dashboard. Download the CSV, check
        the rows and their funding status, then upload it in HCB under <strong>Cards → Bulk send card grants</strong>.
        Record each grant&apos;s link with <strong>Mark sent</strong> once it exists. An order stays on this list
        until the grant is sent, so check HCB before uploading the same file twice.
      </Callout>

      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink
          href="/fulfillment/grants"
          variant={scope === "pending" ? "primary" : "outline"}
          size="sm"
          icon="list"
        >
          Unclaimed
        </ButtonLink>
        <ButtonLink
          href="/fulfillment/grants?scope=open"
          variant={scope === "open" ? "primary" : "outline"}
          size="sm"
          icon="list"
        >
          Unclaimed + claimed
        </ButtonLink>
        <Muted className="text-xs">
          {scope === "pending"
            ? "Nobody has claimed these, so no grant can have been sent yet."
            : "Includes claimed orders that aren't credited yet. A grant may already have gone out by hand."}
        </Muted>
      </div>

      <StatGrid>
        <Stat
          icon="payment"
          label="Grants in the file"
          value={rows.length.toLocaleString("en-US")}
          hint={GRANT_SCOPE_LABEL[scope]}
        />
        <Stat
          icon="checkmark"
          label="Funding covered"
          value={fundingLoaded ? `${covered.toLocaleString("en-US")} / ${rows.length.toLocaleString("en-US")}` : "Not loaded"}
          tone={!fundingLoaded ? "warning" : uncovered.length > 0 ? "warning" : "success"}
          hint="Per order; unclaimed grants aren't reserved"
        />
        <Stat icon="bank" label="Total value" value={usd(totalCents)} hint="Face value × quantity" />
        <Stat
          icon="important"
          label="Rows needing attention"
          value={problems.length.toLocaleString("en-US")}
          tone={problems.length > 0 ? "warning" : "neutral"}
          hint="Left out of the CSV until fixed"
        />
      </StatGrid>

      {!fundingLoaded && rows.length > 0 && (
        <Callout tone="warning" icon="important">
          <strong>Funding status is unavailable.</strong> The rows are still exportable, but the dashboard could not
          load eligibility evidence, so check each order on the fulfillment page before uploading.
        </Callout>
      )}

      {uncovered.length > 0 && (
        <Callout tone="warning" icon="important">
          <strong>{uncovered.length.toLocaleString("en-US")} row{uncovered.length === 1 ? " isn't" : "s aren't"} covered by verified funding.</strong>{" "}
          They are still in the CSV so nothing is hidden, but resolve or skip them before uploading:
          <ul className="mt-1.5 list-inside list-disc">
            {uncovered.map((row) => {
              const result = funding.get(row.orderId)!;
              return (
                <li key={row.orderId}>
                  <TextLink href={`/fulfillment?status=${encodeURIComponent(row.status)}&order=${row.orderId}`} className="font-bold">
                    Order #{row.orderId}
                  </TextLink>{" "}
                  · {ELIGIBILITY_LABEL[result.status]}
                </li>
              );
            })}
          </ul>
        </Callout>
      )}

      {problems.length > 0 && (
        <Callout tone="warning" icon="important">
          <strong>Not included yet.</strong> These orders are missing something the CSV needs, so they are skipped
          instead of guessed:
          <ul className="mt-1.5 list-inside list-disc">
            {problems.map((p) => (
              <li key={p.orderId}>
                <TextLink href={`/fulfillment?status=${encodeURIComponent(p.status)}&order=${p.orderId}`} className="font-bold">
                  Order #{p.orderId}
                </TextLink>{" "}
                · {p.itemName} — {p.reason}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={scope === "pending" ? "No unclaimed grant orders" : "No grant orders need a grant"}
          icon="package"
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <a
              className={buttonClass("primary")}
              href={`/api/fulfillment/grants/export?scope=${scope}`}
              download
            >
              Download CSV ({rows.length})
            </a>
            <Muted className="text-xs">
              Upload in HCB → Cards → Bulk send card grants. Amounts come from each item&apos;s known face value,
              description or the funding order note, so give the rows a quick read.
            </Muted>
          </div>

          <Card padding="flush">
            <CardHeader title="Grants in this file" icon="payment" count={rows.length} />
            <form
              id="grant-download-form"
              method="get"
              action="/api/fulfillment/grants/export"
              className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3"
            >
              <input type="hidden" name="scope" value={scope} />
              <GrantSelectionToolbar />
            </form>
            <div id="grant-rows">
              <Table headers={["", "Order", "Player", "Email", "Grant", "Qty", "Amount", "Funding", "Status & send"]}>
                {rows.map((row) => {
                  const result = funding.get(row.orderId);
                  const claimedBySomeoneElse =
                    row.status === "claimed" && row.claimedBySlack !== access.session.slackId;
                  return (
                    <tr key={row.orderId}>
                      <td>
                        <label className="hc-check">
                          <input
                            type="checkbox"
                            name="ids"
                            value={row.orderId}
                            form="grant-download-form"
                            data-grant-select
                            aria-label={`Select order #${row.orderId}`}
                          />
                        </label>
                      </td>
                      <td>
                        <TextLink href={`/fulfillment?status=${encodeURIComponent(row.status)}&order=${row.orderId}`} className="font-bold">
                          #{row.orderId}
                        </TextLink>
                      </td>
                      <td>{row.playerName}</td>
                    <td>
                      <Mono>{row.email}</Mono>
                    </td>
                    <td>
                      {row.itemName} {row.quantity > 1 && <Badge>{row.quantity}x</Badge>}
                    </td>
                    <td className="tabular-nums">{row.quantity}</td>
                    <td className="tabular-nums font-bold">{usd(row.amountCents)}</td>
                    <td>
                      {result ? (
                        <span title={`${ELIGIBILITY_HINT[result.status]}. ${result.verificationSummary}`}>
                          <Badge tone={ELIGIBILITY_TONE[result.status]} outline>
                            {ELIGIBILITY_SHORT[result.status]}
                          </Badge>
                        </span>
                      ) : (
                        <Muted className="text-xs">Not loaded</Muted>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col items-start gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={row.status === "pending" ? "neutral" : "info"} outline>
                            {GRANT_STAGE_LABEL[row.status as keyof typeof GRANT_STAGE_LABEL] ?? row.status}
                          </Badge>
                          {row.status === "claimed" && (
                            <form action={unclaimOrder}>
                              <input type="hidden" name="id" value={row.orderId} />
                              <ActionButton
                                variant="outline"
                                size="sm"
                                pendingLabel="Unclaiming..."
                                icon="member-remove"
                                confirm={`Release order #${row.orderId} back to the unclaimed queue?`}
                              >
                                Unclaim
                              </ActionButton>
                            </form>
                          )}
                        </div>
                        {claimedBySomeoneElse ? (
                          <Muted className="text-xs">
                            Claimed by {row.claimedBy || "another fulfiller"}
                          </Muted>
                        ) : (
                          <Details summary="Mark sent">
                            <form action={markGrantSent} className="fw-order-action-form">
                              <input type="hidden" name="id" value={row.orderId} />
                              <div className="fw-order-action-fields">
                                <Field label="HCB grant link" hint="The grant HCB created for this row">
                                  <Input
                                    name="grantLink"
                                    type="url"
                                    maxLength={300}
                                    required
                                    placeholder="https://hcb.hackclub.com/grants/..."
                                  />
                                </Field>
                                <Field label="Amount ($)">
                                  <Input
                                    name="actualCostUsd"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    required
                                    defaultValue={(row.amountCents / 100).toFixed(2)}
                                  />
                                </Field>
                              </div>
                              <div className="fw-order-action-buttons">
                                <ActionButton
                                  pendingLabel="Saving..."
                                  icon="checkmark"
                                  confirm={`Mark order #${row.orderId} as sent? This closes the order, pays the fulfillment pixels and DMs the buyer.`}
                                >
                                  Mark grant sent
                                </ActionButton>
                              </div>
                            </form>
                          </Details>
                        )}
                      </div>
                    </td>
                  </tr>
                );
                })}
              </Table>
            </div>
          </Card>
        </>
      )}

      <p className="hc-caption text-xs">
        Owner-only: this is the only place the dashboard discloses buyer emails in bulk. Emails come from the buyer&apos;s
        account; orders without a valid email, a readable amount, or with an implausible amount stay out of the file.
        Funding status is advisory and uses the same live evidence check as the fulfillment order detail.
      </p>
    </div>
  );
}
