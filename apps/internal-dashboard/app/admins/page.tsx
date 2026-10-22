import type { ReactNode } from "react";
import {
  requirePage,
  ownerSlackIds,
  secondPassSlackIds,
  reviewQueueScopeFor,
  REVIEW,
  NO_REVIEW,
  SECOND_PASS,
  EDIT_SUBMISSION,
  FRAUD_REVIEW,
} from "@/lib/guard";
import { listAdmins, listHelpers, listFulfillers, getReviewPayoutSettings } from "@/lib/db";
import {
  addReviewer,
  addFraudReviewer,
  removeFraudReviewer,
  addHelperAction,
  removeHelperAction,
  addFulfillerAction,
  removeFulfillerAction,
  updateReviewPayoutSettings,
} from "@/app/actions";
import { TeamLog } from "@/app/_components/TeamLog";
import SlackName from "@/app/_ui/SlackName";
import {
  ActionButton,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  Code,
  EmptyRow,
  Field,
  Input,
  Mono,
  Muted,
  PageHeader,
  Table,
  TextLink,
  type GlyphName,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

// The team page. Five roles exist (see lib/roles.ts):
// - Owners come from ADMIN_SLACK_IDS only, so they're shown read-only here.
//   Nothing on this page (or anywhere in the dashboard) can make an owner.
// - Reviewers, fraud reviewers, ticket helpers and fulfillers are managed below.

function SlackIdForm({
  action,
  label,
  withName = false,
}: {
  action: (formData: FormData) => Promise<void>;
  label: string;
  withName?: boolean;
}) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 p-4">
      {withName && <Input name="name" placeholder="Name (optional)" className="max-w-48" />}
      <Input name="slackId" required placeholder="Slack member ID (U0...)" className="hc-mono max-w-56" />
      <ActionButton icon="member-add" pendingLabel="Adding...">
        {label}
      </ActionButton>
    </form>
  );
}

function PeopleCard({
  title,
  icon,
  ids,
  add,
  addLabel,
  remove,
  note,
}: {
  title: string;
  icon: GlyphName;
  ids: string[];
  add: (formData: FormData) => Promise<void>;
  addLabel: string;
  remove: (formData: FormData) => Promise<void>;
  note?: ReactNode;
}) {
  return (
    <Card padding="flush">
      <CardHeader title={title} icon={icon} count={ids.length} />
      <SlackIdForm action={add} label={addLabel} />
      {note && <p className="hc-caption px-4 pb-4 text-sm">{note}</p>}
      <Table headers={["Person", "Slack ID", ""]}>
        {ids.map((id) => (
          <tr key={id}>
            <td className="font-bold">
              <SlackName id={id} />
            </td>
            <td>
              <Mono>{id}</Mono>
            </td>
            <td className="text-right">
              <form action={remove}>
                <input type="hidden" name="slackId" value={id} />
                <ActionButton variant="ghost" size="sm" pendingLabel="Removing..." confirm={`Remove ${id}?`}>
                  Remove
                </ActionButton>
              </form>
            </td>
          </tr>
        ))}
        {ids.length === 0 && <EmptyRow colSpan={3} title="Nobody yet" icon={icon} />}
      </Table>
    </Card>
  );
}

export default async function AdminsPage() {
  await requirePage("owner");
  const owners = ownerSlackIds();
  const secondPassIds = secondPassSlackIds();
  const [admins, helpers, fulfillers, payoutSettings] = await Promise.all([
    listAdmins(),
    listHelpers(),
    listFulfillers(),
    getReviewPayoutSettings(),
  ]);
  const reviewers = admins.filter(
    (a) => a.permissions.includes(REVIEW) && !a.permissions.includes(NO_REVIEW),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Owners can do everything. Reviewers only work the review queue, ticket helpers only work tickets, fulfillers only work the order queue. Every change here is written to the audit log."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card padding="flush">
          <CardHeader title="Owners" icon="admin-badge" count={owners.length} />
          <Table headers={["Owner", "Slack ID"]}>
            {owners.map((id) => (
              <tr key={id}>
                <td className="font-bold">
                  <SlackName id={id} />
                </td>
                <td>
                  <Mono>{id}</Mono>
                </td>
              </tr>
            ))}
            {owners.length === 0 && (
              <EmptyRow colSpan={2} title="Nobody is an owner" icon="admin-badge">
                ADMIN_SLACK_IDS is empty.
              </EmptyRow>
            )}
          </Table>
          <p className="hc-caption p-4 text-sm">
            Owners come from the <Code>ADMIN_SLACK_IDS</Code> env var only. Change it in the deployment
            env and redeploy; it can&apos;t be changed from the dashboard or the database.
          </p>
        </Card>

        <Card padding="flush">
          <CardHeader
            title="Reviewers"
            icon="checkmark"
            count={reviewers.length}
            action={
              <ButtonLink href="/reviewers" variant="ghost" size="sm">
                Stats and settings
              </ButtonLink>
            }
          />
          <SlackIdForm action={addReviewer} label="Add reviewer" withName />
          <p className="hc-caption px-4 pb-4 text-sm">
            Final-reviewer (second pass), queue scope (software or hardware), edit-submission access
            and removal are on each reviewer&apos;s page.
          </p>
          <Table headers={["Reviewer", "Slack ID", "Access", ""]}>
            {reviewers.map((r) => {
              const scope = reviewQueueScopeFor(r.permissions);
              const finalReviewer = r.permissions.includes(SECOND_PASS) || secondPassIds.includes(r.slack_id);
              const href = `/reviewers/${encodeURIComponent(r.slack_id)}`;
              return (
                <tr key={r.slack_id}>
                  <td>
                    <TextLink href={href} className="font-bold">
                      {r.name || <SlackName id={r.slack_id} />}
                    </TextLink>
                  </td>
                  <td>
                    <Mono>{r.slack_id}</Mono>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {finalReviewer && <Badge tone="success">Second pass</Badge>}
                      {scope !== "both" && (
                        <Badge outline>
                          <span className="capitalize">{scope}</span> only
                        </Badge>
                      )}
                      {r.permissions.includes(EDIT_SUBMISSION) && <Badge outline>Edit submission</Badge>}
                      {!finalReviewer && scope === "both" && !r.permissions.includes(EDIT_SUBMISSION) && (
                        <Muted>-</Muted>
                      )}
                    </div>
                  </td>
                  <td className="text-right">
                    <ButtonLink href={href} variant="ghost" size="sm">
                      Manage
                    </ButtonLink>
                  </td>
                </tr>
              );
            })}
            {reviewers.length === 0 && <EmptyRow colSpan={4} title="No reviewers yet" icon="checkmark" />}
          </Table>
        </Card>

        <PeopleCard
          title="Fraud reviewers"
          icon="view"
          ids={admins.filter((a) => a.permissions.includes(FRAUD_REVIEW)).map((a) => a.slack_id)}
          add={addFraudReviewer}
          addLabel="Add fraud reviewer"
          remove={removeFraudReviewer}
          note="Sees the Fraud reviews tab (Robert's scores) and nothing else. Final reviewers already see it."
        />

        <PeopleCard
          title="Ticket helpers"
          icon="support-fill"
          ids={helpers.map((h) => h.slack_user_id)}
          add={addHelperAction}
          addLabel="Add helper"
          remove={removeHelperAction}
          note={
            <>
              Same list the Pixorpheus bot manages with <Code>/pixl-addhelper</Code>.
            </>
          }
        />

        <PeopleCard
          title="Fulfillers"
          icon="package-seam"
          ids={fulfillers.map((f) => f.slack_user_id)}
          add={addFulfillerAction}
          addLabel="Add fulfiller"
          remove={removeFulfillerAction}
        />
      </div>

      <Card>
        <CardHeader title="Reviewer payouts" icon="purse-fill" />
        <p className="hc-caption mb-4 max-w-2xl text-sm">
          Pixels a reviewer earns for an approval, and the pixels held for the first request for
          changes on a project: they are paid when that reviewer approves the project, and
          forfeited if they don&apos;t review the re-ship within 3 days. Later requests for changes
          on the same project pay nothing. Set either to 0 to turn it off. Both stack with an
          active Review Blitz multiplier.
        </p>
        <form action={updateReviewPayoutSettings} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pixels per approval">
              <Input
                name="approvedPixels"
                type="number"
                min={0}
                step={0.5}
                defaultValue={payoutSettings.approvedPixels}
              />
            </Field>
            <Field label="Pixels held for the first request-changes">
              <Input
                name="needsChangesPixels"
                type="number"
                min={0}
                step={0.5}
                defaultValue={payoutSettings.needsChangesPixels}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Muted className="text-xs">
              {payoutSettings.updatedBy ? `Last changed by ${payoutSettings.updatedBy}` : ""}
            </Muted>
            <ActionButton icon="checkmark" pendingLabel="Saving...">
              Save payout rates
            </ActionButton>
          </div>
        </form>
      </Card>

      <TeamLog />
    </div>
  );
}
