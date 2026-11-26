import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardTitle, Notice, PageHeader } from "@/components/ui/primitives";
import { serverApi } from "@/lib/server-api";
import { NpsForm } from "./nps-form";

export const metadata: Metadata = { title: "Feedback" };

interface NpsStatus {
  available?: boolean;
  wave?: string;
  answered?: boolean;
}

// The survey is not public yet. The server decides who may see it (NPS_MODE and
// NPS_PREVIEW_SLACK_IDS); anyone else gets the same 404 as a page that does not exist.
export default async function NpsPage() {
  const status = await serverApi<NpsStatus>("/api/nps/status");
  if (!status?.available) notFound();

  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader title="TELL US HOW WE'RE DOING" sub="Takes about a minute. Only the first question is required." />

      {status.answered ? (
        <Notice tone="good">Thanks, you already answered this round. We read every answer.</Notice>
      ) : (
        <Card>
          <CardTitle className="mb-3 text-gold">QUICK FEEDBACK</CardTitle>
          <NpsForm />
        </Card>
      )}
    </div>
  );
}
