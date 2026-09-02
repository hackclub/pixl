import { db } from "../db/client.js";
import { aiPost } from "../ai/client.js";

export let styleNotes = "";

export async function loadStyleMemory(): Promise<void> {
  try {
    const { data } = await db()
      .from("style_memory")
      .select("notes")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    styleNotes = data?.notes || "";
  } catch (e) {
    styleNotes = "";
  }
}

export async function saveStyleMemory(notes: string): Promise<void> {
  styleNotes = notes;
  try {
    await db().from("style_memory").delete().gte("id", 1);
    await db().from("style_memory").insert({ notes });
  } catch (e: any) {
    console.error("saveStyleMemory error:", e.message);
  }
}

export async function extractStyle(messages: string[]): Promise<string | null> {
  const combined = messages.join("\n");
  try {
    const res = await aiPost({
      messages: [
        {
          role: "system",
          content:
            "You are analyzing the writing style of French/English-speaking gen Z users. Extract specific speech patterns, vocabulary, expressions, humor style, and quirks from their messages. Output a concise style guide (10-15 points max) that another AI could use to naturally imitate their writing. Focus on: vocabulary, abbreviations, humor type, punctuation habits, emoji use, sentence structure, tone, recurring expressions. Write in English, be specific and concrete, no vague generalities.",
        },
        { role: "user", content: `Analyze these messages and extract the speaking style:\n\n${combined}` },
      ],
      max_tokens: 600,
    });
    return res.data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    return null;
  }
}
