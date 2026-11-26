// Guards for text a project's maker controls (README, commit messages, journals,
// description, AI-usage note) before it goes into a prompt for the AI review
// draft. Two layers, because neither is enough alone:
//
// 1. fence(): wraps the text in <untrusted-...> tags the prompt tells the model
//    to treat as data, and removes any tag the text itself uses to break out.
// 2. injectionSignals(): plain code, not the model, looks for text aimed at an
//    AI. A model that was talked into hiding a concern cannot hide this one.
//
// Neither makes injection impossible. The draft has no tools and is never
// submitted for a reviewer, which is what keeps the damage small; see
// apps/internal-dashboard/app/api/cron/ai-drafts/route.ts for the batch path.

const TAG_PREFIX = "untrusted-";

// Anything that looks like one of our own tags, opening or closing, in any case
// and with stray spaces, so a README cannot close the fence and write outside it.
const OWN_TAG = /<\s*\/?\s*untrusted[^>]*>?/gi;

export function fence(label: string, text: string): string {
  const safeLabel = label.replace(/[^a-z0-9-]/gi, "");
  const safe = String(text ?? "").replace(OWN_TAG, "[tag removed]");
  return `<${TAG_PREFIX}${safeLabel}>\n${safe}\n</${TAG_PREFIX}${safeLabel}>`;
}

// Phrases that only make sense when addressed to an AI model. A README for a
// project about prompts can match legitimately, so a hit is a reason to look,
// never a verdict.
const SIGNALS: { re: RegExp; why: string }[] = [
  { re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,30}\b(previous|prior|above|earlier|all|any|your|these|the)\b[^.\n]{0,30}\b(instructions?|prompts?|guidelines)\b/i, why: "tells the AI to ignore its instructions" },
  { re: /\b(ignore|disregard)\s+(everything|all|the\s+text|the\s+rest)\s+(above|before)\b/i, why: "tells the AI to ignore what came before" },
  { re: /\bsystem\s+(prompt|instructions?)\b|\bdeveloper\s+(message|instructions?)\b/i, why: "mentions the system prompt" },
  { re: /\bnew\s+instructions?\b/i, why: "gives the AI new instructions" },
  { re: /\byou\s+are\s+(now|no\s+longer)\s+(a|an|the|my)\b/i, why: "tries to change the AI's role" },
  { re: /\b(note|message|instructions?|attention)\s+(to|for)\s+(the\s+)?(ai|llm|language\s+model|ai\s+model|ai\s+reviewer|assistant)\b/i, why: "is addressed to the AI" },
  { re: /\b(do\s+not|don'?t|never)\s+(mention|flag|report|raise|list)\b[^.\n]{0,40}\b(red\s*flags?|concerns?)\b/i, why: "tells the AI to hide concerns" },
  { re: /\b(no|zero|empty)\s+red\s*flags?\b/i, why: "dictates that there are no red flags" },
  { re: /\b(say|write|state|report|respond|answer)\b[^.\n]{0,20}\bthat\s+(this|the)\s+(project|hours|commits)\b[^.\n]{0,40}\b(legit(imate)?|excellent|perfect|genuine|verified)\b/i, why: "dictates what the AI should conclude" },
  { re: /\b(redFlags|technicalFeatures|deflationReason)\b/, why: "names the AI's output fields" },
  { re: /<\|?\s*(im_start|im_end|system|assistant|endoftext)\s*\|?>|\[\/?INST\]|<\/?(system|assistant)>/i, why: "contains chat-template markers" },
];

export interface InjectionSources {
  readme?: string;
  name?: string;
  description?: string;
  aiNotes?: string;
  commits?: string[];
  journals?: string[];
  other?: string[];
}

const LABELS: Record<keyof InjectionSources, string> = {
  readme: "README",
  name: "Project name",
  description: "Description",
  aiNotes: "AI-usage note",
  commits: "A commit message",
  journals: "A journal entry",
  other: "Linked text",
};

// One short flag per source that matches, ready to show a reviewer. Empty when
// nothing looks like it is aimed at an AI.
export function injectionSignals(src: InjectionSources): string[] {
  const out: string[] = [];
  for (const key of Object.keys(LABELS) as (keyof InjectionSources)[]) {
    const raw = src[key];
    const texts = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const text of texts) {
      const hit = SIGNALS.find((s) => s.re.test(text));
      if (hit) {
        out.push(`${LABELS[key]} ${hit.why} (possible prompt injection, read it yourself)`);
        break;
      }
    }
  }
  return out;
}
