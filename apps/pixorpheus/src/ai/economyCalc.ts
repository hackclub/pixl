import {
  config,
  projectPayoutUsd,
  projectPayoutPx,
  reForHours,
} from "../config.generated.js";

// Pixo is an LLM: ask it "tier 2, 50h, how much do I make" and it will confidently
// invent a number, because the real answer is the RE-driven rate at this project's
// own ending RE, not something to eyeball from the persona. So we
// detect pay/rate questions, pull the tier and hours out of the text, and hand Pixo
// the EXACT figures from the same payout functions the server credits with. Pixo then
// just relays them in its own voice. If we can't pull concrete numbers, we still give
// it the correct mechanics so it stops guessing.

const E = config.economy;
const toPx = (usd: number) => usd / E.pixelValueUsd;

// The question has to actually be about money/rate/pixels, or we stay out of it.
// Broad match: paired with a tier/hours number it's clearly a pay question.
const PAY_RE =
  /\b(rate|pay|paid|payout|earn|earnings?|make|made|pixels?|px|salary|wage|money|dollars?|usd|combien|gagne|gagner|paie|pay[eé]|touche|r[eé]mun)\b|\$/i;
// Stronger signal, required for the no-numbers generic answer so a stray "make"
// ("how do i make friends") doesn't drag the pay mechanics into an unrelated reply.
const STRONG_PAY_RE =
  /\b(rate|pay|paid|payout|earn|earnings?|pixels?|px|salary|wage|combien|gagne|gagner|paie|pay[eé]|touche|r[eé]mun)\b|\$/i;

function money(usd: number, px: number): string {
  return `$${usd.toFixed(2)} (${Math.round(px)}px)`;
}

// tierRePerHour values aren't all clean decimals - round to 2dp for display.
const reRate = (n: number) => String(Math.round(n * 100) / 100);

// projectPayoutUsd(hours, tier, 0) is monotonically increasing in hours, so a target
// dollar amount ("how many hours for $500 at T4") can be inverted by bisection instead
// of leaving Pixo to guess, this is exactly the gap that let it hallucinate "55 hours"
// for a T4/$500 question by pattern-matching onto an unrelated persona example.
function hoursForTarget(usdTarget: number, tier: number): number {
  let lo = 0;
  let hi = 100_000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (projectPayoutUsd(mid, tier, 0) < usdTarget) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Returns a trusted fact block with exact pay figures for the question, or null when
 * the message isn't a pay question. Meant to be passed to getAIReply as trusted
 * context (NOT through the untrusted web-search channel).
 */
export function economyBrief(texts: string[]): string | null {
  const text = texts.join(" ");
  if (!PAY_RE.test(text)) return null;

  const lc = text.toLowerCase();
  const tierM = lc.match(/\b(?:tier|t|level|lvl|niveau)\s*([1-4])\b/);
  const tier = tierM ? parseInt(tierM[1], 10) : undefined;
  const hoursM = lc.match(/(\d+(?:[.,]\d+)?)\s*(?:h\b|hr|hrs|hour|hours|heure|heures|hs)\b/);
  const hours = hoursM ? parseFloat(hoursM[1].replace(",", ".")) : undefined;
  // A bare "$500" or "500 dollars", never has an hour unit, so this can't collide
  // with the hours match above.
  const targetM = lc.match(/\$\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:usd|dollars?|bucks)\b/);
  const dollarTarget = targetM
    ? parseFloat((targetM[1] ?? targetM[2]).replace(",", "."))
    : undefined;

  const head =
    `PIXL PAY CALCULATOR (exact, authoritative, computed from the real payout formula, not a guess). ` +
    `This is a real question: give the ACTUAL numbers, a short sentence is fine, do NOT dodge with a vague reply. ` +
    `Round in your own voice if you want. Pay comes off LIFETIME RE, it banks forever across every project you've ever shipped, ` +
    `and your hourly rate ramps linearly from base to max as your lifetime RE grows. The numbers below assume starting from 0 lifetime RE ` +
    `(a brand new player's floor); anyone who's already shipped before starts higher on the ramp, so their real rate is at least this good.`;

  const lines: string[] = [head];

  if (tier !== undefined && hours !== undefined) {
    const usd = projectPayoutUsd(hours, tier, 0);
    const px = projectPayoutPx(hours, tier, 0);
    lines.push(
      `A Tier ${tier} project shipped at ${hours}h pays ${money(usd, px)} TOTAL, ` +
        `which averages ${money(usd / hours, px / hours)} per hour (it earns ${reForHours(hours, tier)} RE).`,
    );
  } else if (dollarTarget !== undefined) {
    // They asked "how many hours for $X", no hours given, so solve the inverse
    // instead of falling through to a generic table that never touches their number.
    if (tier !== undefined) {
      const h = hoursForTarget(dollarTarget, tier);
      lines.push(
        `Starting from 0 lifetime RE, hitting ${money(dollarTarget, toPx(dollarTarget))} on a single Tier ${tier} project takes about ` +
          `${h.toFixed(1)}h shipped (computed by solving the real payout formula, not a flat rate). Already have RE banked? Fewer hours needed.`,
      );
    } else {
      lines.push(`Hours needed to hit ${money(dollarTarget, toPx(dollarTarget))} on one project, by tier:`);
      for (let t = 1; t <= 4; t++) {
        const h = hoursForTarget(dollarTarget, t);
        lines.push(`  T${t}: ~${h.toFixed(1)}h`);
      }
    }
  } else if (hours !== undefined) {
    lines.push(`A ${hours}h project pays, by tier (they didn't say the tier, so give the range):`);
    for (let t = 1; t <= 4; t++) {
      const usd = projectPayoutUsd(hours, t, 0);
      lines.push(`  T${t}: ${money(usd, toPx(usd))} total - ${money(usd / hours, toPx(usd) / hours)}/hr avg`);
    }
  } else if (tier !== undefined) {
    lines.push(`A Tier ${tier} project pays this much total at a few sizes:`);
    for (const h of [10, 40, 100]) {
      const usd = projectPayoutUsd(h, tier, 0);
      lines.push(`  ${h}h: ${money(usd, toPx(usd))} - ${money(usd / h, toPx(usd) / h)}/hr avg`);
    }
  } else {
    // No tier and no hours: only worth answering if it's unambiguously a pay
    // question, otherwise a stray "make"/"money" would inject pay talk everywhere.
    if (!STRONG_PAY_RE.test(text)) return null;
    lines.push(
      `No tier/hours given, so the mechanics: base rate is ${money(E.basePayoutUsd, toPx(E.basePayoutUsd))}/hr, ` +
        `ramping linearly to a max of ${money(E.maxPayoutUsd, toPx(E.maxPayoutUsd))}/hr as your LIFETIME RE (banked forever ` +
        `across every project) grows to ${E.reForMaxPayout.toLocaleString()} RE (+$1/hr for every ${E.payoutSlopeRe.toLocaleString()} RE). ` +
        `Each hour earns ${E.tierRePerHour.map(reRate).join("/")} RE at T1/T2/T3/T4. ` +
        `Tell them to give a tier + hours for an exact number.`,
    );
  }

  return lines.join("\n");
}
