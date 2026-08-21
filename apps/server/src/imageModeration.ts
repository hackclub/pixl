const MODEL = "google/gemini-2.5-flash-lite";
// Exported so uploads.ts can cap the accepted body size at exactly this —
// anything bigger than what we actually moderate must never be accepted at all.
export const MAX_MODERATE_BYTES = 15_000_000;

// Vision moderation for user-uploaded images (journals, chat, thumbnails).
// Fails OPEN on missing key / network / parse errors so uploads never hard-break
// when the model is down — it only rejects on an explicit "unsafe" verdict.
export async function checkImageSafe(
  buf: Buffer,
  mime: string,
): Promise<{ safe: boolean; reason: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || !Buffer.isBuffer(buf) || buf.length === 0 || buf.length > MAX_MODERATE_BYTES) {
    return { safe: true, reason: "" };
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
      return { safe: true, reason: "" };
    }
    const json = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    let content = (json.choices?.[0]?.message?.content ?? "").trim();
    const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) content = fence[1].trim();
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start !== -1 && end > start) content = content.slice(start, end + 1);
    const parsed = JSON.parse(content) as { safe?: boolean; reason?: string };
    // Only reject on an explicit false; anything ambiguous passes.
    if (parsed.safe === false) {
      return { safe: false, reason: String(parsed.reason ?? "flagged as inappropriate").slice(0, 200) };
    }
    return { safe: true, reason: "" };
  } catch (e) {
    console.error("checkImageSafe failed", e);
    return { safe: true, reason: "" };
  }
}
