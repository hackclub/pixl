import { config } from "@/app/_generated/config";
import { FormClient } from "./FormClient";

// No OAuth identity step - see apps/server/src/routes/forms.ts's header
// comment for why (HCA redirect URI wasn't available to register). The
// submitter just types their own Slack id on the form now.
//
// Title/description/questions/close date all come from apps/server's public
// GET /api/forms/:formKey/config, which the internal dashboard's Forms tab
// edits (apps/dashboard/app/forms/FormEditor.tsx) - nothing here is hardcoded
// anymore so an admin can change the form without a deploy.
interface FormConfig {
  ok: boolean;
  title?: string;
  description?: string;
  questions?: { key: string; label: string }[];
  closed?: boolean;
}

async function fetchFormConfig(formKey: string): Promise<FormConfig | null> {
  try {
    const res = await fetch(`${config.urls.server}/api/forms/${encodeURIComponent(formKey)}/config`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as FormConfig;
  } catch {
    return null;
  }
}

export default async function FormPage({
  params,
}: {
  params: Promise<{ formKey: string }>;
}) {
  const { formKey } = await params;
  const cfg = await fetchFormConfig(formKey);

  if (!cfg || !cfg.ok) {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "48px 20px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Form not found</h1>
        <p style={{ color: "#666" }}>This form doesn&apos;t exist or isn&apos;t set up yet.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "48px 20px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{cfg.title}</h1>
      {cfg.description && (
        <p style={{ color: "#666", marginBottom: 24 }}>{cfg.description}</p>
      )}
      {cfg.closed ? (
        <div style={{ background: "#fee", border: "1px solid #c99", borderRadius: 8, padding: 16 }}>
          This form is closed and no longer accepting submissions.
        </div>
      ) : (
        <FormClient formKey={formKey} questions={cfg.questions ?? []} />
      )}
    </div>
  );
}
