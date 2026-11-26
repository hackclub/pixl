import { requirePage } from "@/lib/guard";
import { getStaffSettings } from "@/lib/db";
import { PageHeader } from "@/app/_ui/ui";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const access = await requirePage("staff");
  const settings = await getStaffSettings(access.session.slackId);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" description="Saved to your account, so they follow you to any browser." />
      <SettingsClient initial={settings} account={{ name: access.session.name, slackId: access.session.slackId }} canEditReviewMacros={access.isReviewer || access.isOwner} />
    </div>
  );
}
