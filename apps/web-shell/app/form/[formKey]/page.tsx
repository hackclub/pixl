import { FormClient } from "./FormClient";

// No OAuth identity step - see apps/server/src/routes/forms.ts's header
// comment for why (HCA redirect URI wasn't available to register). The
// submitter just types their own Slack id on the form now.
export default async function FormPage({
  params,
}: {
  params: Promise<{ formKey: string }>;
}) {
  const { formKey } = await params;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "48px 20px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Pixl reviewer application</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>
        We&apos;re looking for more reviewers to help keep the queue moving. Fill this out and
        we&apos;ll get back to you.
      </p>
      <FormClient formKey={formKey} />
    </div>
  );
}
