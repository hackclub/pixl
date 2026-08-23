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
    t1: String(E.tierRePerHour[0]),
    t2: String(E.tierRePerHour[1]),
    t3: String(E.tierRePerHour[2]),
    t4: String(E.tierRePerHour[3]),
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

  const rampAvgUsd = (re: number) => {
    const r = Math.min(re, E.reForMaxPayout);
    return E.basePayoutUsd + (r / (2 * E.reForMaxPayout)) * (E.maxPayoutUsd - E.basePayoutUsd);
  };

  const exampleProjectRe = E.tierRePerHour[exampleTier - 1]! * exampleHours;
  const exampleRampUsd = rampAvgUsd(exampleProjectRe) * exampleHours;
  const exampleTotalUsd = exampleRampUsd + exampleUsd;
  tokens.exampleRampUsd = `$${exampleRampUsd.toFixed(2)}`;
  tokens.exampleTotalUsd = `$${exampleTotalUsd.toFixed(2)}`;
  tokens.exampleTotalPx = `${Math.round(exampleTotalUsd / E.pixelValueUsd)} px`;

  const capTier = E.tierRePerHour.length;
  const capHours = Math.round(E.reForMaxPayout / E.tierRePerHour[capTier - 1]!);
  const capKickerUsd = E.tierKickerUsdPerStep * (capTier - 1) * Math.min(capHours, E.tierKickerHours);
  const capUsd = rampAvgUsd(E.reForMaxPayout) * capHours + capKickerUsd;
  tokens.capExampleHours = String(capHours);
  tokens.capExampleUsd = `$${capUsd.toFixed(2)}`;
  tokens.capExamplePx = `${Math.round(capUsd / E.pixelValueUsd)} px`;

  const nextHours = 5;
  const nextRe = E.tierRePerHour[0]! * nextHours;
  const nextRate = rampAvgUsd(nextRe);
  tokens.nextExampleHours = String(nextHours);
  tokens.nextExampleRate = `$${nextRate.toFixed(2)}`;
  tokens.nextExamplePx = `${Math.round((nextRate * nextHours) / E.pixelValueUsd)} px`;

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
