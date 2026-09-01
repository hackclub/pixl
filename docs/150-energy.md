---
title: Restoration Energy and levels
group: Build & ship
description: Every hour you ship becomes Restoration Energy, or RE.
---

# Restoration Energy and levels

^ Every hour you ship turns into **Restoration Energy (RE)**. RE is the core engine behind the game's economy: it sets your hourly pixel payout rate, and your level reflects how much RE you've accumulated.

RE is permanent. You never spend it, it never decays, and nobody can take it away. You spend **pixels** in the shop; **RE** simply dictates how many pixels each hour of your work is worth.

## Tiers determine RE per hour

When a reviewer approves your project, they assign it a **Tier (1 to 4)** based on ambition, technical depth, and execution:

| T1 Spark | A beginner build: a personal site, simple script, or small helper tool. | {{t1}} RE / hour |
| T2 Signal | A polished app, CLI tool, or game with clean UX and solid functionality. | {{t2}} RE / hour |
| T3 Grid | Multi-component system: backend, persistent state, real-time sync, or custom hardware. | {{t3}} RE / hour |
| T4 Nexus | Advanced systems engineering: complex architecture, kernel drivers, or deep scope. | {{t4}} RE / hour |

Tiers evaluate the build itself, not who built it. If a first-time coder builds something legitimately impressive, they get the higher tier. Padding a simple project with artificial hours won't bump the tier; reviewers inspect the actual codebase.

## Your rate ramps permanently

Your **lifetime RE** (the sum of all RE earned across all approved ships) sets your hourly rate. It scales linearly: every {{payoutSlopeRe}} RE you earn adds $1.00/hr to your rate, starting at {{baseUsd}}/hr and topping out at {{maxUsd}}/hr once you hit {{reCap}} RE.

Once your rate climbs, every future ship pays at that higher rate or above (including the ship that pushed you over the milestone).

| {{step1Re}} RE | Lifetime milestone ({{step1HRange}}) | {{step1Usd}} / hour |
| {{step2Re}} RE | Lifetime milestone ({{step2HRange}}) | {{step2Usd}} / hour |
| {{step3Re}} RE | Lifetime milestone ({{step3HRange}}) | {{step3Usd}} / hour |
| {{step4Re}} RE | Lifetime milestone ({{step4HRange}}) | {{step4Usd}} / hour |
| {{step5Re}} RE | Lifetime milestone ({{step5HRange}}) | {{step5Usd}} / hour |
| {{step6Re}} RE | Lifetime milestone ({{step6HRange}}) | {{step6Usd}} / hour |
| {{step7Re}} RE | Maximum cap reached ({{step7HRange}}) | **{{step7Usd}} / hour** |

*The hours in parentheses show ranges from pure T4 builds (fastest) to pure T1 builds (slowest).*

### Rate progression by tier

#### If you only ship T4 Nexus builds:
| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T4h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T4h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T4h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T4h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T4h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T4h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T4h}}h** |

#### If you only ship T3 Grid builds:
| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T3h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T3h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T3h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T3h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T3h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T3h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T3h}}h** |

#### If you only ship T2 Signal builds:
| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T2h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T2h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T2h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T2h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T2h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T2h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T2h}}h** |

#### If you only ship T1 Spark builds:
| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T1h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T1h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T1h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T1h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T1h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T1h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T1h}}h** |

For example: shipping a fresh {{capExampleHours}}-hour T4 project gets you straight to the {{step7Usd}}/hr cap on its own, paying {{capExampleUsd}} ({{capExamplePx}}) total. If you start with a {{nextExampleHours}}-hour T1 project instead, it earns a modest chunk of RE, paying around {{nextExampleRate}}/hr ({{nextExamplePx}} total), and that RE stays locked in your profile, boosting the hourly rate of whatever you build next.

::: note The TL;DR
Every hour you build banks permanent RE, permanently raising your rate for future builds.
:::

## Levels

Your Level (1 to {{maxLevel}}) is a direct readout of your lifetime RE. Levels don't calculate your pay directly: they're just milestones to show how much you've shipped.

| Levels {{band1From}}-{{band1To}} | {{band1Per}} RE per level | {{band1Total}} RE total ({{band1HRange}}) |
| Levels {{band2From}}-{{band2To}} | {{band2Per}} RE per level | {{band2Total}} RE total ({{band2HRange}}) |
| Levels {{band3From}}-{{band3To}} | {{band3Per}} RE per level | {{band3Total}} RE total ({{band3HRange}}) |

Early levels are fast: a few hours on your first build will already jump you a couple of levels.

## Where to check your stats

The top bar of your Builder Terminal displays your level, lifetime RE, and current pixel payout rate. It updates the second a project approval goes through.
