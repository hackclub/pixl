export interface PixorpheusSettings {
  readonly apiKey: string;
  readonly url: string;
}

export type PixlChannelEnrollment =
  | { readonly kind: "enrolled" }
  | { readonly kind: "not_configured" }
  | { readonly kind: "failed" };

export type PixorpheusFetcher = (input: string, init: RequestInit) => Promise<Response>;

function enrollmentEndpoint(url: string): string | null {
  try {
    return new URL("/api/external/pixl-channel/join", url).toString();
  } catch (error) {
    console.error("[pixl-slack] invalid PIXORPHEUS_URL", error);
    return null;
  }
}

export async function requestPixlChannelEnrollment(
  slackId: string,
  settings: PixorpheusSettings,
  request: PixorpheusFetcher,
): Promise<PixlChannelEnrollment> {
  if (!settings.apiKey || !settings.url) return { kind: "not_configured" };
  const endpoint = enrollmentEndpoint(settings.url);
  if (!endpoint) return { kind: "failed" };

  try {
    const response = await request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": settings.apiKey },
      body: JSON.stringify({ slackId }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) return { kind: "enrolled" };
    console.error("[pixl-slack] Pixorpheus enrollment failed", response.status);
    return { kind: "failed" };
  } catch (error) {
    console.error("[pixl-slack] Pixorpheus enrollment request failed", error);
    return { kind: "failed" };
  }
}

export async function enrollSlackPlayerInPixl(slackId: string): Promise<PixlChannelEnrollment> {
  return requestPixlChannelEnrollment(
    slackId,
    {
      apiKey: process.env.EXTERNAL_API_KEY ?? "",
      url: process.env.PIXORPHEUS_URL ?? "",
    },
    fetch,
  );
}
