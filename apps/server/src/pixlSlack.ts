export interface PixorpheusSettings {
  readonly apiKey: string;
  readonly url: string;
}

export type PixlChannelEnrollment =
  | { readonly kind: "enrolled" }
  | { readonly kind: "not_configured" }
  | { readonly kind: "failed" };

export type PixorpheusFetcher = (input: string, init: RequestInit) => Promise<Response>;

function enrollmentEndpoint(url: string, path: string): string | null {
  try {
    return new URL(path, url).toString();
  } catch (error) {
    console.error("[pixl-slack] invalid PIXORPHEUS_URL", error);
    return null;
  }
}

export async function requestPixlChannelEnrollment(
  slackId: string,
  settings: PixorpheusSettings,
  request: PixorpheusFetcher,
  path: string = "/api/external/pixl-channel/join",
): Promise<PixlChannelEnrollment> {
  if (!settings.apiKey || !settings.url) return { kind: "not_configured" };
  const endpoint = enrollmentEndpoint(settings.url, path);
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

// Public review verdicts are posted in their own channel, so a player is added
// to it the first time they ship a project.
export async function enrollSlackPlayerInReviewChannel(slackId: string): Promise<PixlChannelEnrollment> {
  return requestPixlChannelEnrollment(
    slackId,
    {
      apiKey: process.env.EXTERNAL_API_KEY ?? "",
      url: process.env.PIXORPHEUS_URL ?? "",
    },
    fetch,
    "/api/external/review-channel/join",
  );
}
