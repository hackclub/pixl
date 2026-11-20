import { requirePage } from "@/lib/guard";
import { GRANT_SCOPE_LABEL, loadGrantExport, parseGrantScope } from "@/lib/grantExportData";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  EmptyState,
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
// an owner downloads the file, checks it, uploads it in HCB, and records the
// grant link on each order when it is sent.
export default async function GrantExportPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  await requirePage("owner");

  const { scope: rawScope } = await searchParams;
  const scope = parseGrantScope(rawScope);
  const { rows, problems, totalCents } = await loadGrantExport(scope);

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
        the rows, then upload it in HCB under <strong>Cards → Bulk send card grants</strong>. Record each grant&apos;s
        link on its order once it exists. An order stays on this list until the grant is sent, so check HCB before
        uploading the same file twice.
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
        <Stat icon="bank" label="Total value" value={usd(totalCents)} hint="Face value × quantity" />
        <Stat
          icon="important"
          label="Rows needing attention"
          value={problems.length.toLocaleString("en-US")}
          tone={problems.length > 0 ? "warning" : "neutral"}
          hint="Left out of the CSV until fixed"
        />
      </StatGrid>

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
              Upload in HCB → Cards → Bulk send card grants. Amounts come from each item&apos;s description or the
              funding order note, so give the rows a quick read.
            </Muted>
          </div>

          <Card padding="flush">
            <CardHeader title="Grants in this file" icon="payment" count={rows.length} />
            <Table headers={["Order", "Player", "Email", "Grant", "Qty", "Amount"]}>
              {rows.map((row) => (
                <tr key={row.orderId}>
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
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      <p className="hc-caption text-xs">
        Owner-only: this is the only place the dashboard discloses buyer emails in bulk. Emails come from the buyer&apos;s
        account; orders without a valid email, a readable amount, or with an implausible amount stay out of the file.
      </p>
    </div>
  );
}
