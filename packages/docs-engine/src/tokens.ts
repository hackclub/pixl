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
    tierKickerUsdPerStep: number;
    tierKickerHours: number;
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
    kickerUsd: `$${E.tierKickerUsdPerStep.toFixed(2)}`,
    kickerHours: String(E.tierKickerHours),
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

  const exampleHours = 10;
  const exampleTier = E.tierRePerHour.length;
  const exampleUsd = E.tierKickerUsdPerStep * (exampleTier - 1) * exampleHours;
  tokens.kickerExampleUsd = `$${exampleUsd.toFixed(2)}`;
  tokens.kickerExamplePx = `${Math.round(exampleUsd / E.pixelValueUsd)} px`;

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

  const exampleProjectRe = E.tierRePerHour[exampleTier - 1]! * exampleHours;
  const exampleRampUsd = rateAt(exampleProjectRe) * exampleHours;
  const exampleTotalUsd = exampleRampUsd + exampleUsd;
  tokens.exampleRampUsd = `$${exampleRampUsd.toFixed(2)}`;
  tokens.exampleTotalUsd = `$${exampleTotalUsd.toFixed(2)}`;
  tokens.exampleTotalPx = `${Math.round(exampleTotalUsd / E.pixelValueUsd)} px`;

  const capTier = E.tierRePerHour.length;
  const capHours = Math.round(E.reForMaxPayout / E.tierRePerHour[capTier - 1]!);
  const capKickerUsd = E.tierKickerUsdPerStep * (capTier - 1) * Math.min(capHours, E.tierKickerHours);
  // Same cap projectPayoutUsd applies server-side: a project can never be paid
  // more than its hours times the max rate, even with the kicker added on.
  const capUsd = Math.min(rateAt(E.reForMaxPayout) * capHours + capKickerUsd, capHours * E.maxPayoutUsd);
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
    E.tierRePerHour.forEach((rePerHour, t) => {
      tokens[`step${n}T${t + 1}h`] = String(Math.round(step.re / rePerHour));
    });
  });

  let from = 1;
  let cumulative = 0;
  E.levelBands.forEach((band, i) => {
    cumulative += (band.throughLevel - from + 1) * band.rePerLevel;
    tokens[`band${i + 1}From`] = String(from);
    tokens[`band${i + 1}To`] = String(band.throughLevel);
    tokens[`band${i + 1}Per`] = String(band.rePerLevel);
    tokens[`band${i + 1}Total`] = cumulative.toLocaleString("en-US");
    from = band.throughLevel + 1;
  });

  return tokens;
}
