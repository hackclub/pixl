import { cookies } from "next/headers";
import { FormClient } from "./FormClient";

// apps/server, same-cluster internal DNS - see apps/landing/next.config.ts's
// SERVER_ORIGIN for the matching browser-facing rewrite. This Server
// Component call is server-to-server (checking identity before first
// paint), the browser-facing submit itself goes through the apex path so
// the SameSite=Lax identity cookie apps/server/src/routes/forms.ts set
// actually attaches.
const SERVER_ORIGIN = "http://pixl-server.ysws-pixl.svc.cluster.local:3000";

interface MeResponse {
  identified: boolean;
  name?: string;
  slackId?: string;
}

async function getIdentity(formKey: string): Promise<MeResponse> {
  const jar = await cookies();
  const identityCookie = jar.get("pixl_form_identity");
  if (!identityCookie) return { identified: false };
  try {
    const res = await fetch(`${SERVER_ORIGIN}/api/forms/${encodeURIComponent(formKey)}/me`, {
      headers: { Cookie: `pixl_form_identity=${identityCookie.value}` },
      cache: "no-store",
    });
    if (!res.ok) return { identified: false };
    return (await res.json()) as MeResponse;
  } catch {
    return { identified: false };
  }
}

// Everything here is a placeholder field ("message") until the real field
// list is decided - see FormClient's FIELDS array, which is the one thing
// to change to add real questions.
export default async function FormPage({
  params,
  searchParams,
}: {
  params: Promise<{ formKey: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { formKey } = await params;
  const { error } = await searchParams;
  const me = await getIdentity(formKey);

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "48px 20px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Pixl reviewer application</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>
        We&apos;re looking for more reviewers to help keep the queue moving. Fill this out and
        we&apos;ll get back to you.
      </p>

      {error && (
        <div style={{ background: "#fee", border: "1px solid #f99", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          Something went wrong signing you in ({error}). Try again.
        </div>
      )}

      {!me.identified ? (
        <a
          href={`/api/forms/${encodeURIComponent(formKey)}/auth/start`}
          style={{
            display: "inline-block",
            background: "#4A154B",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Sign in with Slack to continue
        </a>
      ) : (
        <FormClient formKey={formKey} name={me.name ?? ""} />
      )}
    </div>
  );
}
