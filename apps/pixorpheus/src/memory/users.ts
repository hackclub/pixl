import type { WebClient } from "@slack/web-api";
import { db } from "../db/client.js";
import { aiPost } from "../ai/client.js";
import { botIdentity } from "../slack/identity.js";

export const userMemory = new Map<string, string[]>();
export const personalityMemory = new Map<string, string[]>();

export function parseFacts(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

export async function loadMemory(): Promise<void> {
  try {
    const { data } = await db().from("user_memory").select("slack_user_id, facts");
    for (const row of data || []) userMemory.set(row.slack_user_id, parseFacts(row.facts));
  } catch (e) {
    // best-effort on boot
  }
}

export async function loadPersonalityMemory(): Promise<void> {
  try {
    const { data } = await db().from("user_personality").select("slack_user_id, traits");
    for (const row of data || []) personalityMemory.set(row.slack_user_id, row.traits);
  } catch (e) {
    // best-effort on boot
  }
}

export async function savePersonality(userId: string, traits: string[]): Promise<void> {
  personalityMemory.set(userId, traits);
  try {
    await db()
      .from("user_personality")
      .upsert({ slack_user_id: userId, traits }, { onConflict: "slack_user_id" });
  } catch (e: any) {
    console.error("savePersonality error:", e.message);
  }
}

export async function saveUserMemory(userId: string, facts: string[]): Promise<void> {
  userMemory.set(userId, facts);
  try {
    await db()
      .from("user_memory")
      .upsert({ slack_user_id: userId, facts }, { onConflict: "slack_user_id" });
  } catch (e: any) {
    console.error("saveUserMemory error:", e.message);
  }
}

export async function ensureUserName(userId: string, client: WebClient): Promise<void> {
  const existing = parseFacts(userMemory.get(userId));
  if (existing.some((f) => f.startsWith("name is"))) return;
  try {
    const info = await client.users.info({ user: userId });
    const name = info.user?.profile?.display_name || info.user?.real_name;
    if (!name) return;
    const updated = [`name is ${name}`, ...existing];
    await saveUserMemory(userId, updated.slice(-100));
  } catch (e) {
    // best-effort
  }
}

export function getDisplayName(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const facts = parseFacts(userMemory.get(userId));
  const nameFact = facts.find((f) => f.startsWith("name is "));
  return nameFact ? nameFact.replace("name is ", "") : null;
}

export function resolveUserMentions(text: string): string {
  return text.replace(/<@([A-Z0-9]+)>/g, (match, uid) => {
    if (uid === botIdentity.userId) return "@pixorpheus";
    const name = getDisplayName(uid);
    return name ? `@${name}` : match;
  });
}

export const GARBAGE_PATTERNS = [
  /nothing worth/i,
  /output.*nothing/i,
  /potential consideration/i,
  /is there something/i,
  /could you provide/i,
  /to create a/i,
  /information about/i,
  /multiple messages/i,
  /recurring themes/i,
  /i.d typically need/i,
  /\*\*/,
  /broader context/i,
  /conversation/i,
  /memorable facts/i,
  /this (person|exchange|message)/i,
  /provide more/i,
];

export async function extractMemory(userId: string, messages: string[]): Promise<void> {
  const combined = messages.join("\n");
  if (combined.length < 10) return;
  try {
    const res = await aiPost({
      messages: [
        {
          role: "system",
          content: `Extract up to 10 memorable facts about THE AUTHOR of these messages. Be specific and precise. Capture:
- Identity: name, age, location, nationality, pronouns
- Life: job, studies, school, projects they work on, things they shipped
- Opinions: things they love or hate, strong takes, pet peeves
- Interests: hobbies, games, music, tech stack, favorite things
- Context: inside references, ongoing situations they mention, goals
RULES:
- Short phrases only, max 10 words each, one per line
- Only concrete facts directly stated or strongly implied BY THE AUTHOR about THEMSELVES, never save facts about other people they mention
- If someone says "alex loves pizza", that's about alex, not the author, SKIP it
- If there is nothing worth saving about the author, output exactly: SKIP
- No bullets, no numbers, no explanations, no meta-commentary, no questions`,
        },
        { role: "user", content: combined },
      ],
      max_tokens: 250,
    });
    const raw = res.data.choices?.[0]?.message?.content?.trim();
    if (!raw || raw.toUpperCase() === "SKIP") return;
    const newFacts = raw
      .split("\n")
      .map((f) => f.replace(/^[-•*\d.]+\s*/, "").trim())
      .filter((f) => f.length > 3 && f.length < 80)
      .filter((f) => !f.endsWith("?"))
      .filter((f) => !GARBAGE_PATTERNS.some((p) => p.test(f)));
    if (!newFacts.length) return;
    const existing = parseFacts(userMemory.get(userId));
    const deduped = newFacts.filter((nf) => {
      const nfWords = nf.toLowerCase().split(" ").slice(0, 3).join(" ");
      return !existing.some((ef) => ef.toLowerCase().split(" ").slice(0, 3).join(" ") === nfWords);
    });
    if (!deduped.length) return;
    const merged = [...existing, ...deduped];
    await saveUserMemory(userId, merged.slice(-100));
  } catch (e) {
    // best-effort, a failed AI call just means we learned nothing this time
  }
}

export async function extractPersonality(userId: string, messages: string[]): Promise<void> {
  const combined = messages.join("\n");
  if (combined.length < 20) return;
  try {
    const res = await aiPost({
      messages: [
        {
          role: "system",
          content: `Analyze HOW this person communicates, not just what they say. Extract up to 5 stable personality traits. Focus on:
- Communication style (blunt, verbose, passive-aggressive, enthusiastic...)
- Humor type (sarcastic, dry, chaotic, self-deprecating...)
- Energy level (high energy, chill, erratic, intense...)
- Recurring behaviors (always uses "...", very short replies, overthinks, hypes people up...)
- How they react (defensive, chill, gets excited easily, always skeptical...)
Short phrases only, max 8 words each, one per line. Only note things that feel consistent and distinct. Output nothing if nothing stands out. No bullets, no numbers.`,
        },
        { role: "user", content: combined },
      ],
      max_tokens: 150,
    });
    const raw = res.data.choices?.[0]?.message?.content?.trim();
    if (!raw) return;
    const newTraits = raw
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.length > 3 && t.length < 80);
    if (!newTraits.length) return;
    const parsed = parseFacts(personalityMemory.get(userId));
    const deduped = newTraits.filter((nt) => {
      const ntWords = nt.toLowerCase().split(" ").slice(0, 3).join(" ");
      return !parsed.some((et) => et.toLowerCase().split(" ").slice(0, 3).join(" ") === ntWords);
    });
    if (!deduped.length) return;
    await savePersonality(userId, [...parsed, ...deduped].slice(-30));
  } catch (e) {
    // best-effort
  }
}
