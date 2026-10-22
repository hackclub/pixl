import type { EligibilityResult, EligibilityStatus } from "@/lib/eligibility/engine";
import {
  AIRTABLE_LABEL,
  ELIGIBILITY_HINT,
  ELIGIBILITY_LABEL,
  ELIGIBILITY_SHORT,
  ELIGIBILITY_TONE,
  usd,
} from "@/lib/eligibility/format";
import { airtableRecordUrl } from "@/lib/airtable";
import { VERIFICATION_LABEL, VERIFICATION_TONE, syncAgeText } from "@/lib/eligibility/format";
import type { ShipsView } from "@/lib/eligibility/ships";
import { refreshShipsSnapshot } from "@/app/actions";
import { ActionButton, Badge, Callout, DescriptionList, Muted, TextLink } from "@/app/_ui/ui";

export function VerificationBadge({ label }: { label: keyof typeof VERIFICATION_LABEL }) {
  return (
    <Badge tone={VERIFICATION_TONE[label]} outline={label !== "verified"}>
      {VERIFICATION_LABEL[label]}
    </Badge>
  );
}

export function ShipsSyncBar({ view }: { view: ShipsView }) {
  const snap = view.snapshot;
  const ok = !!snap && !view.error;
  return (
    <div className="fw-sync" data-state={ok ? "ok" : snap ? "stale" : "down"} role="status">
      <span>
        {snap ? (
          <>
            Ships synced <strong>{syncAgeText(view.ageMs)}</strong> · {snap.pixlCount} PIXL entries
            {snap.invalidCount + snap.duplicateCount > 0 && ` (${snap.invalidCount + snap.duplicateCount} unusable)`}
          </>
        ) : (
          <>Ships has not been reached. Hours cannot be verified, so nothing shows as covered.</>
        )}
        {view.error && <Muted> · last refresh failed: {view.error}</Muted>}
      </span>
      <form action={refreshShipsSnapshot}>
        <ActionButton variant="outline" pendingLabel="Refreshing...">
          Refresh Ships
        </ActionButton>
      </form>
    </div>
  );
}

export function FundingBadge({ status, short = false }: { status: EligibilityStatus | null; short?: boolean }) {
  if (!status) return <Badge tone="neutral" outline>Unverified</Badge>;
  return (
    <span title={ELIGIBILITY_HINT[status]}>
      <Badge tone={ELIGIBILITY_TONE[status]} outline={status === "unverified"}>
        {short ? ELIGIBILITY_SHORT[status] : ELIGIBILITY_LABEL[status]}
      </Badge>
    </span>
  );
}

const BASIS_LABEL = { face: "Grant face value", actual: "Recorded supplier cost", budget: "Shop budget" } as const;

function ageText(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export function FundingBreakdown({ result, orderId }: { result: EligibilityResult | null; orderId: number }) {
  if (!result) {
    return (
      <Callout tone="warning" icon="important">
        <strong>Unverified.</strong> Eligibility evidence could not be loaded. Check funding by hand before claiming.
      </Callout>
    );
  }
  const r = result;
  return (
    <div className="fw-funding">
      <p className="fw-funding-verdict">
        <VerificationBadge label={r.verification} /> <span>{r.verificationSummary}</span>
      </p>
      <p className="fw-funding-verdict">
        <FundingBadge status={r.status} /> <Muted>{ELIGIBILITY_HINT[r.status]}</Muted>
      </p>
      {r.reasons.length > 0 && (
        <ul className="fw-funding-reasons">
          {r.reasons.map((x) => (
            <li key={x.code}>{x.message}</li>
          ))}
        </ul>
      )}

      <div className="fw-funding-scroll">
      <table className="fw-funding-table">
        <caption className="sr-only">Projects counted toward funding</caption>
        <thead>
          <tr>
            <th>Project</th>
            <th>Hours</th>
            <th>Verification</th>
            <th>Funding</th>
            <th>Counted</th>
          </tr>
        </thead>
        <tbody>
          {r.projects.length === 0 && (
            <tr>
              <td colSpan={5}>
                <Muted>No projects mapped to this player.</Muted>
              </td>
            </tr>
          )}
          {r.projects.map((p) => {
            const airtableUrl = p.airtableRecordId ? airtableRecordUrl(p.airtableRecordId) : null;
            return (
              <tr key={`${p.projectId}-${p.role}`} data-counted={p.counted}>
                <td>
                  <TextLink href={`/projects/${p.projectId}`}>{p.name || `Project ${p.projectId}`}</TextLink>
                  {p.role === "collaborator" && <Muted> (collaborator)</Muted>}
                </td>
                <td className="tabular-nums">
                  {p.hours.toFixed(1)}h
                  {p.originalHours != null && p.originalHours !== p.hours && (
                    <Muted> (was {p.originalHours.toFixed(1)}h)</Muted>
                  )}
                  {p.ships?.hours != null && (
                    <>
                      <br />
                      <Muted>
                        Ships {p.ships.hours}h
                        {p.discrepancy !== "none" && ` · counted ${p.countedHours.toFixed(1)}h`}
                      </Muted>
                    </>
                  )}
                </td>
                <td>
                  <VerificationBadge label={p.verification} />
                  <br />
                  <Muted>{p.verificationNote}</Muted>
                  <br />
                  <Muted>{AIRTABLE_LABEL[p.airtable]}</Muted>
                  {airtableUrl && (
                    <>
                      {" "}
                      <TextLink href={airtableUrl} external>
                        staging
                      </TextLink>
                    </>
                  )}
                </td>
                <td className="tabular-nums">
                  {p.fundingSource === "payout" && p.payoutCents != null && (
                    <>
                      {usd(p.payoutCents)}
                      <br />
                      <Muted>
                        ${p.effectiveRateUsd?.toFixed(2)}/h from payout history{p.payoutCapped ? ", capped at the maximum rate" : ""}
                      </Muted>
                    </>
                  )}
                  {p.fundingSource === "none" && <Muted>No payout history, funding not established</Muted>}
                  {p.fundingSource === "flat" && <Muted>${p.effectiveRateUsd?.toFixed(2)}/h flat rate</Muted>}
                </td>
                <td>
                  {p.counted === "verified" && "Verified"}
                  {p.counted === "provisional" && "Unverified"}
                  {p.counted === "excluded" && <Muted>Excluded: {p.excludedReason}</Muted>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <DescriptionList
        items={[
          ["Eligible hours", `${r.verifiedHours.toFixed(1)}h verified${r.provisionalHours > 0 ? `, ${r.provisionalHours.toFixed(1)}h unverified` : ""}`],
          ["Total earned funding", <span key="e">{usd(r.verifiedFundingCents)} <Muted>({r.fundingBasis === "payout_history" ? `average $${r.rateUsd.toFixed(2)} per verified hour, from payout history` : `$${r.rateUsd.toFixed(2)} per verified hour`})</Muted></span>],
          ["Earned if every unverified hour holds", usd(r.upperBoundFundingCents)],
          [
            "Already committed",
            r.commitments.length === 0 && r.priorGrants.length === 0 ? (
              usd(0)
            ) : (
              <span key="c">
                {usd(r.committedCents)}
                <ul className="fw-funding-list">
                  {r.commitments.map((c) => (
                    <li key={c.orderId}>
                      <TextLink href={`/fulfillment?status=all&order=${c.orderId}`}>Order #{c.orderId}</TextLink>{" "}
                      {c.itemName} ({c.status}) {usd(c.cents)}
                      {c.source === "derived" && <Muted> · not in ledger</Muted>}
                    </li>
                  ))}
                  {r.priorGrants.map((g) => (
                    <li key={`g${g.projectId}`}>
                      <TextLink href={`/projects/${g.projectId}`}>{g.name}</TextLink> project grant {usd(Math.round(g.usd * 100))}
                    </li>
                  ))}
                </ul>
              </span>
            ),
          ],
          ["Funding remaining", usd(r.remainingCents)],
          [
            "Requested order cost",
            <span key="o">
              {usd(r.amount.cents)} <Muted>({BASIS_LABEL[r.amount.basis]}; {r.amount.pixels.toLocaleString()} px paid, budget {usd(r.amount.budgetCents)})</Muted>
            </span>,
          ],
          ["Funding remaining after this order", usd(r.afterCents)],
          ["Remaining after, if unverified holds", usd(r.provisionalRemainingCents - r.amount.cents)],
        ]}
      />
      <p className="hc-caption text-xs">
        Policy {r.policyVersion}. Evidence loaded {ageText(r.evidenceAgeMs)}
        {r.stale ? " (stale)" : ""}. Airtable {r.integrations.airtable ? "readable" : "unreachable"}, Verification source{" "}
        {r.integrations.unified ? "readable" : "unavailable"}. Ships{" "}
        {r.ships.fetchedAt == null ? "never synced" : `synced ${ageText(r.ships.ageMs ?? 0)}${r.ships.stale ? " (stale)" : ""}`}. Order #{orderId}.
      </p>
    </div>
  );
}
