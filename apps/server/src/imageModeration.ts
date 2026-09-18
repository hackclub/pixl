const MODEL = "google/gemini-2.5-flash-lite";
// cap matches uploads.ts body limit
export const MAX_MODERATE_BYTES = 15_000_000;

// fail closed by default, dev opt-in only
export async function checkImageSafe(
  buf: Buffer,
  mime: string,
): Promise<{ safe: boolean; reason: string }> {
  if (!Buffer.isBuffer(buf) || buf.length === 0 || buf.length > MAX_MODERATE_BYTES) {
    return { safe: false, reason: "invalid_image" };
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    if (process.env.ALLOW_UNMODERATED_UPLOADS === "true") return { safe: true, reason: "" };
    return { safe: false, reason: "moderation_unavailable" };
  }
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  const prompt =
    "You are moderating images uploaded to a kids' game. Is this image safe? " +
    "It is UNSAFE if it contains nudity, sexual content, gore, graphic violence, " +
    "hate symbols, slurs/text harassment, drugs, or otherwise shocking content. " +
    'Respond ONLY with strict JSON: {"safe": true|false, "reason": "<short reason>"}.';
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 150,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      console.error("image moderation http", r.status, await r.text().catch(() => ""));
      return { safe: false, reason: "moderation_unavailable" };
    }
    const json = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    let content = (json.choices?.[0]?.message?.content ?? "").trim();
    const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) content = fence[1].trim();
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start !== -1 && end > start) content = content.slice(start, end + 1);
    const parsed = JSON.parse(content) as { safe?: unknown; reason?: unknown };
    if (parsed.safe === true) return { safe: true, reason: "" };
    if (parsed.safe === false) {
      return {
        safe: false,
        reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "flagged as inappropriate",
      };
    }
    // not a literal boolean, treat as unanswered
    return { safe: false, reason: "moderation_unavailable" };
  } catch (e) {
    console.error("checkImageSafe failed", e);
    return { safe: false, reason: "moderation_unavailable" };
  }
}
