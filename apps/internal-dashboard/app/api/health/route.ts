// Minimal Kubernetes health endpoint: no database, Slack, or OAuth dependency.
// Real user requests are checked separately by end-to-end monitoring.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
