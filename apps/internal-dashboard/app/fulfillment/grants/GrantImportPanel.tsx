"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Details,
  Field,
  Input,
  Mono,
  Muted,
  Table,
  TextLink,
} from "@/app/_ui/ui";
import { markImportedGrants, previewGrantImport } from "@/app/actions";
import { HCB_GRANTS_BOOKMARKLET } from "@/lib/hcbGrantBookmarklet";
import { grantLinkFromId, type GrantImportPreview } from "@/lib/grantImport";

type GrantScope = "pending" | "open";

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// After the CSV upload, HCB has no "download the created links" button. The
// official read-only CLI prints the same grant JSON the API returns, so an
// owner runs one command and drops the file here. The dashboard pairs each
// grant with its waiting order; links and amounts come from that pairing, not
// from copying rows in HCB. Nothing is marked sent until the owner confirms.
export function GrantImportPanel({ scope }: { scope: GrantScope }) {
  const [json, setJson] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<GrantImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ marked: number; skipped: { orderId: number; reason: string }[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function copyBookmarklet() {
    try {
      await navigator.clipboard.writeText(HCB_GRANTS_BOOKMARKLET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy automatically. Open “Show the bookmarklet code”, select it, and copy it manually.");
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setSelected(new Set());
    setResult(null);
    setError("");
    try {
      setJson(await file.text());
    } catch {
      setError("Couldn't read that file. Try selecting it again.");
    }
  }

  function match() {
    if (!json.trim()) {
      setError("Choose the grants.json file first.");
      return;
    }
    const form = new FormData();
    form.set("scope", scope);
    form.set("json", json);
    startTransition(async () => {
      try {
        const out = await previewGrantImport(form);
        if (!out.ok) {
          setError(out.error);
          setPreview(null);
          return;
        }
        setPreview(out.preview);
        // Duplicate/ambiguous rows start unchecked; the warning above lists
        // every grant so the owner has to choose which one is real.
        setSelected(new Set(out.preview.matches.filter((row) => !row.note).map((row) => row.orderId)));
        setResult(null);
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't match that file.");
      }
    });
  }

  function toggle(orderId: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleAll() {
    if (!preview) return;
    setSelected((current) =>
      current.size === preview.matches.length
        ? new Set()
        : new Set(preview.matches.map((row) => row.orderId)),
    );
  }

  function mark() {
    if (!preview) return;
    const pairs = preview.matches
      .filter((row) => selected.has(row.orderId))
      .map((row) => ({ orderId: row.orderId, grantId: row.grantId, amountCents: row.amountCents }));
    if (pairs.length === 0) return;
    if (!window.confirm(
      `Mark ${pairs.length} grant${pairs.length === 1 ? "" : "s"} as sent?\n\n` +
      "This closes each order, records the grant link and amount, pays 2 fulfillment pixels, and DMs the buyer.",
    )) return;

    const form = new FormData();
    form.set("scope", scope);
    form.set("pairs", JSON.stringify(pairs));
    startTransition(async () => {
      try {
        const out = await markImportedGrants(form);
        if (!out.ok) {
          setError(out.error);
          return;
        }
        setResult({ marked: out.marked, skipped: out.skipped });
        setPreview(null);
        setSelected(new Set());
        setError("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Some grants may have been marked; reload before retrying.");
      }
    });
  }

  const allSelected = !!preview && preview.matches.length > 0 && selected.size === preview.matches.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <Card padding="flush">
      <CardHeader title="Import HCB grants" icon="payment" />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm">
          The bulk upload page only sends the grants; it never returns their links. The bookmarklet
          below exports HCB&apos;s <strong>Card grants</strong> table — link, recipient name, amount and
          item, plus the email when HCB shows it. This page matches by email first, then by HCB name +
          amount + item. No CLI or OAuth app is required. Review the matches, then mark them sent.
        </p>

        <Details summary="Option A — no CLI: download the grants CSV with a bookmarklet">
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Open the{" "}
              <TextLink href="https://hcb.hackclub.com/ysws-pixl/card_grants" external>
                HCB Card grants page
              </TextLink>{" "}
              <strong>after the upload</strong> (not the bulk upload page) while signed in as a Pixl
              organizer. That list is where each grant&apos;s link lives. Copy the bookmarklet below
              and either add it as a browser bookmark, or run it in the page&apos;s browser console.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={copyBookmarklet} icon="copy">
                {copied ? "Copied!" : "Copy bookmarklet"}
              </Button>
              <Muted className="text-xs">
                Downloads <Mono>hcb-grants.csv</Mono> with each grant&apos;s link, name, amount, item
                and email when visible. It asks how many grants back from the top (default 30; 0 =
                all) and an optional day limit. Read-only: it stays in your browser. Tip: filter HCB
                to <strong>Invited</strong> first to keep the export short.
              </Muted>
            </div>
            <Details summary="Show the bookmarklet code (for the console)">
              <pre className="hc-code max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">
                {HCB_GRANTS_BOOKMARKLET}
              </pre>
              <p className="mt-2">
                In the console, remove the leading <Mono>javascript:</Mono> before pressing Enter.
                If Chrome blocks pasting, type <Mono>allow pasting</Mono> first.
              </p>
            </Details>
            <p>
              It walks the table from the top and exports up to the number you choose, optionally
              limited to the last N days (inclusive of today). It tries to include each grant
              page&apos;s email. If HCB hides the email, the row still imports and the dash matches by
              HCB name + exact amount + item; anything ambiguous is flagged. If it says no usable
              grants, make sure you&apos;re on the live Card grants list, not a saved HTML file.
            </p>
          </div>
        </Details>

        <Details summary="Optional: if you already have the CLI's grants.json">
          <div className="flex flex-col gap-2 text-sm">
            <p>
              A CLI export includes the recipient emails, so it matches even more safely. Drop it below
              like the CSV. The CLI is read-only and needs no OAuth app.
            </p>
            <pre className="hc-code whitespace-pre-wrap">
{`hcb grants --org ysws-pixl > grants.json`}
            </pre>
          </div>
        </Details>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="grants.json or hcb-grants.csv" hint="Either file works">
            <Input type="file" accept=".json,.csv,application/json,text/csv" onChange={onFile} />
          </Field>
          <Button type="button" onClick={match} disabled={pending || !json.trim()} icon="search">
            {pending ? "Matching..." : "Match grants"}
          </Button>
          {fileName && <Muted className="text-xs">{fileName}</Muted>}
        </div>
        <Muted className="text-xs">
          Matching uses the current view: switch to <strong>Unclaimed + claimed</strong> above to include
          grants someone already claimed.
        </Muted>

        {error && (
          <Callout tone="danger" icon="important">
            {error}
          </Callout>
        )}

        {result && (
          <Callout tone={result.skipped.length > 0 ? "warning" : "success"} icon="checkmark">
            <strong>
              Marked {result.marked} grant{result.marked === 1 ? "" : "s"} sent.
            </strong>
            {result.skipped.length > 0 && (
              <>
                {" "}Skipped {result.skipped.length}:
                <ul className="mt-1.5 list-inside list-disc">
                  {result.skipped.map((row) => (
                    <li key={row.orderId}>
                      Order #{row.orderId} — {row.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Callout>
        )}

        {preview && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={preview.matches.length > 0 ? "success" : "neutral"} outline>
                {preview.matches.length} matched
              </Badge>
              {preview.warnings.length > 0 && (
                <Badge tone="warning" outline>
                  {preview.warnings.length} need a check
                </Badge>
              )}
              {preview.unmatchedOrders.length > 0 && (
                <Badge tone="danger" outline>
                  {preview.unmatchedOrders.length} order{preview.unmatchedOrders.length === 1 ? "" : "s"} unmatched
                </Badge>
              )}
              {preview.unusedGrants.length > 0 && (
                <Muted className="text-xs">
                  {preview.unusedGrants.length} other grant{preview.unusedGrants.length === 1 ? "" : "s"} in the file didn&apos;t match
                </Muted>
              )}
              {preview.ignored > 0 && (
                <Muted className="text-xs">{preview.ignored} unusable row{preview.ignored === 1 ? "" : "s"} skipped</Muted>
              )}
            </div>

            {preview.warnings.map((warning) => (
              <Callout key={warning.orderIds.join(",")} tone="warning" icon="important">
                <strong>Orders {warning.orderIds.map((id) => `#${id}`).join(", ")}:</strong> {warning.reason}
                {warning.grantIds && warning.grantIds.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {warning.grantIds.map((id) => {
                      const link = grantLinkFromId(id);
                      return link ? (
                        <TextLink key={id} href={link} external>
                          <Mono>{id}</Mono>
                        </TextLink>
                      ) : null;
                    })}
                  </div>
                )}
              </Callout>
            ))}

            {preview.unmatchedOrders.length > 0 && (
              <Callout tone="danger" icon="important">
                <strong>No grant found for:</strong>
                <ul className="mt-1.5 list-inside list-disc">
                  {preview.unmatchedOrders.map((row) => (
                    <li key={row.orderId}>
                      Order #{row.orderId} · {row.playerName} · {row.itemName} · {usd(row.amountCents)} —{" "}
                      {row.reason}
                    </li>
                  ))}
                </ul>
              </Callout>
            )}

            {preview.unusedGrants.length > 0 && (
              <Details summary={`Unmatched HCB grants (${preview.unusedGrants.length})`}>
                <p className="text-xs">
                  These grants had no confident order match. If one is obviously right, copy its link
                  into that order&apos;s <strong>Mark sent</strong> form below, or check the HCB name and
                  amount against the order page.
                </p>
                <Table headers={["Date", "Amount", "Item", "HCB name", "Grant"]}>
                  {preview.unusedGrants.map((grant) => (
                    <tr key={grant.grantId}>
                      <td>
                        {grant.createdAt
                          ? new Date(grant.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : "—"}
                      </td>
                      <td className="tabular-nums font-bold">{usd(grant.amountCents)}</td>
                      <td>{grant.purpose || "—"}</td>
                      <td>{grant.hcbName || "—"}</td>
                      <td>
                        <TextLink href={grant.grantLink} external>
                          <Mono>{grant.grantId}</Mono>
                        </TextLink>
                      </td>
                    </tr>
                  ))}
                </Table>
              </Details>
            )}

            {preview.matches.length > 0 ? (
              <>
                <Table
                  headers={[
                    <label key="all" className="hc-check">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someSelected;
                        }}
                        onChange={toggleAll}
                        aria-label="Select every matched grant"
                      />
                    </label>,
                    "Order",
                    "Player",
                    "Grant",
                    "Amount",
                    "HCB grant link",
                    "Note",
                  ]}
                >
                  {preview.matches.map((row) => (
                    <tr key={row.orderId}>
                      <td>
                        <label className="hc-check">
                          <input
                            type="checkbox"
                            checked={selected.has(row.orderId)}
                            onChange={() => toggle(row.orderId)}
                            aria-label={`Select order #${row.orderId}`}
                          />
                        </label>
                      </td>
                      <td>
                        <TextLink
                          href={`/fulfillment?status=${encodeURIComponent(row.status)}&order=${row.orderId}`}
                          className="font-bold"
                        >
                          #{row.orderId}
                        </TextLink>
                      </td>
                      <td>
                        {row.playerName}
                        {row.hcbName && (
                          <Muted className="block text-xs">HCB: {row.hcbName}</Muted>
                        )}
                      </td>
                      <td>
                        {row.itemName} {row.quantity > 1 && <Badge>{row.quantity}x</Badge>}
                      </td>
                      <td className="tabular-nums font-bold">{usd(row.amountCents)}</td>
                      <td>
                        <TextLink href={row.grantLink} external>
                          <Mono>{row.grantId}</Mono>
                        </TextLink>
                      </td>
                      <td className="text-xs">
                        {row.note ? <Muted>{row.note}</Muted> : <span className="hc-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </Table>

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={mark} disabled={pending || selected.size === 0} icon="checkmark">
                    {pending ? "Marking..." : `Mark ${selected.size} sent`}
                  </Button>
                  <Muted className="text-xs">
                    Closes the order, records the grant link and actual cost, pays 2 pixels, and DMs the buyer.
                  </Muted>
                </div>
              </>
            ) : (
              <Callout tone="warning" icon="info">
                No confident matches. Check the unmatched HCB grants above against the order names and
                amounts — the bookmarklet exports names, not emails, so unusual usernames need a manual
                look.
              </Callout>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
