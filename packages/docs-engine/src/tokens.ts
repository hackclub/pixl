// {{token}} substitutions available inside docs/*.md bodies, resolved from
// packages/config/pixl.json so copy can't drift the way the old hand-written
// HTML did. markdown.ts's render() throws if the body references a token not
// present here, so callers (the docs content loader, the OG-card build
// script) both need a full, valid token set even if they only use part of it.
export interface PixlConfig {
  hackatimeCutoff: string;
  economy: {
    pixelValueUsd: number;
    basePayoutUsd: number;
    maxPayoutUsd: number;
    reForMaxPayout: number;
    payoutSteps: { re: number; usd: number }[];
    tierRePerHour: number[];
    trialBonusRe: number;
    levelBands: { throughLevel: number; rePerLevel: number }[];
  };
}

export function buildTokens(config: PixlConfig): Record<string, string> {
  const E = config.economy;
  const px = (usd: number) => `${Math.round(usd / E.pixelValueUsd)} px`;
  // tierRePerHour can carry more than 2 decimals - round to 2dp and drop
  // trailing zeros for display, the exact value still drives the real math
  // everywhere else.
  const reRate = (n: number) => String(Math.round(n * 100) / 100);
  const tokens: Record<string, string> = {
    basePx: px(E.basePayoutUsd),
    maxPx: px(E.maxPayoutUsd),
    baseUsd: `$${E.basePayoutUsd.toFixed(2)}`,
    maxUsd: `$${E.maxPayoutUsd.toFixed(2)}`,
    reCap: E.reForMaxPayout.toLocaleString("en-US"),
    maxLevel: String(E.levelBands[E.levelBands.length - 1]!.throughLevel),
    trialBonusRe: String(E.trialBonusRe),
    t1: reRate(E.tierRePerHour[0]!),
    t2: reRate(E.tierRePerHour[1]!),
    t3: reRate(E.tierRePerHour[2]!),
    t4: reRate(E.tierRePerHour[3]!),
    cutoff: new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(config.hackatimeCutoff)),
  };

  // Flat step lookup, matching payoutUsdPerHour in packages/config/sync.ts
  // exactly - the rate is whichever step's RE threshold is the highest one
  // still <= re, not an interpolated curve.
  const rateAt = (re: number): number => {
    const r = Math.max(re, 0);
    let usd = E.payoutSteps[0]!.usd;
    for (const step of E.payoutSteps) {
      if (r < step.re) break;
      usd = step.usd;
    }
    return usd;
  };

  const capTier = E.tierRePerHour.length;
  const capHours = Math.round(E.reForMaxPayout / E.tierRePerHour[capTier - 1]!);
  // Same cap projectPayoutUsd applies server-side: a project can never be paid
  // more than its hours times the max rate.
  const capUsd = Math.min(rateAt(E.reForMaxPayout) * capHours, capHours * E.maxPayoutUsd);
  tokens.capExampleHours = String(capHours);
  tokens.capExampleUsd = `$${capUsd.toFixed(2)}`;
  tokens.capExamplePx = `${Math.round(capUsd / E.pixelValueUsd)} px`;

  const nextHours = 5;
  const nextRe = E.tierRePerHour[0]! * nextHours;
  const nextRate = rateAt(nextRe);
  tokens.nextExampleHours = String(nextHours);
  tokens.nextExampleRate = `$${nextRate.toFixed(2)}`;
  tokens.nextExamplePx = `${Math.round((nextRate * nextHours) / E.pixelValueUsd)} px`;

  // The payout table itself, one column set per step: the RE threshold, the
  // dollar rate it unlocks, and how many hours of lifetime work at each tier
  // it takes to reach that much RE (re / that tier's RE-per-hour). Docs render
  // this as a table so players can see hours-to-rate without doing the math.
  E.payoutSteps.forEach((step, i) => {
    const n = i + 1;
    tokens[`step${n}Re`] = step.re.toLocaleString("en-US");
    tokens[`step${n}Usd`] = `$${step.usd.toFixed(2)}`;
    const hoursByTier = E.tierRePerHour.map((rePerHour) => Math.round(step.re / rePerHour));
    hoursByTier.forEach((h, t) => {
      tokens[`step${n}T${t + 1}h`] = String(h);
    });
    // RE is pooled across whatever mix of tiers earned it, so there's no single
    // hours figure for a threshold - only a range from "all T4" (fastest) to
    // "all T1" (slowest). Shown alongside the RE/$ columns so readers don't
    // have to scroll down to the per-tier tables just to get a ballpark.
    const fastest = Math.min(...hoursByTier);
    const slowest = Math.max(...hoursByTier);
    tokens[`step${n}HRange`] = fastest === slowest ? `${fastest}h` : `${fastest}-${slowest}h`;
  });

  let from = 1;
  let cumulative = 0;
  E.levelBands.forEach((band, i) => {
    cumulative += (band.throughLevel - from + 1) * band.rePerLevel;
    tokens[`band${i + 1}From`] = String(from);
    tokens[`band${i + 1}To`] = String(band.throughLevel);
    tokens[`band${i + 1}Per`] = String(band.rePerLevel);
    tokens[`band${i + 1}Total`] = cumulative.toLocaleString("en-US");
    const hoursByTier = E.tierRePerHour.map((rePerHour) => Math.round(cumulative / rePerHour));
    const fastest = Math.min(...hoursByTier);
    const slowest = Math.max(...hoursByTier);
    tokens[`band${i + 1}HRange`] = fastest === slowest ? `${fastest}h` : `${fastest}-${slowest}h`;
    from = band.throughLevel + 1;
  });

  return tokens;
}
