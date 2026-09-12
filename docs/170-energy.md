---
title: Restoration Energy and levels
group: Build & ship
description: Every hour you ship becomes Restoration Energy, or RE.
---

# Restoration Energy and levels

^ Every hour you ship turns into **Restoration Energy (RE)**. RE sets what you're paid per hour, and your level is a readout of how much of it you've built up.

RE is permanent. You never spend it, it doesn't decay, nobody takes it away. **Pixels** are what you spend in the shop. **RE** decides how many pixels an hour of your work is worth.

## Tiers determine RE per hour

When a reviewer approves a project they give it a **tier**, 1 to 4, based on how ambitious it is, how deep it goes technically, and how well it's put together.

| T1 Spark | A first build. A personal site, a small script, a helper tool. | {{t1}} RE / hour |
| T2 Signal | A finished app, CLI tool or game that works properly and is nice to use. | {{t2}} RE / hour |
| T3 Grid | Several moving parts. A backend, stored state, real-time sync, custom hardware. | {{t3}} RE / hour |
| T4 Nexus | Serious systems work. Involved architecture, kernel drivers, real depth. | {{t4}} RE / hour |

Tiers are about the build, not the builder. A first-timer who makes something genuinely impressive gets the higher tier. Padding a simple project with hours won't move it, because reviewers read the code.

## Your rate ramps permanently

Your **lifetime RE**, the total across every approved ship, sets your hourly rate. It's linear: each {{payoutSlopeRe}} RE adds $1.00/hr, starting at {{baseUsd}}/hr and stopping at {{maxUsd}}/hr once you reach {{reCap}} RE.

Rates only go up. Every ship after a milestone pays at the new rate, including the one that pushed you past it.

| {{step1Re}} RE | Lifetime milestone ({{step1HRange}}) | {{step1Usd}} / hour |
| {{step2Re}} RE | Lifetime milestone ({{step2HRange}}) | {{step2Usd}} / hour |
| {{step3Re}} RE | Lifetime milestone ({{step3HRange}}) | {{step3Usd}} / hour |
| {{step4Re}} RE | Lifetime milestone ({{step4HRange}}) | {{step4Usd}} / hour |
| {{step5Re}} RE | Lifetime milestone ({{step5HRange}}) | {{step5Usd}} / hour |
| {{step6Re}} RE | Lifetime milestone ({{step6HRange}}) | {{step6Usd}} / hour |
| {{step7Re}} RE | Maximum cap reached ({{step7HRange}}) | **{{step7Usd}} / hour** |

*The hours in brackets run from all-T4 builds (fastest) to all-T1 builds (slowest).*

### Rate progression by tier

### Shipping only T4 Nexus builds
| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T4h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T4h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T4h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T4h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T4h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T4h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T4h}}h** |

### Shipping only T3 Grid builds
| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T3h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T3h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T3h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T3h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T3h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T3h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T3h}}h** |

### Shipping only T2 Signal builds
| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T2h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T2h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T2h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T2h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T2h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T2h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T2h}}h** |

### Shipping only T1 Spark builds
| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T1h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T1h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T1h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T1h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T1h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T1h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T1h}}h** |

Two examples. A single {{capExampleHours}}-hour T4 project takes you all the way to the {{step7Usd}}/hr cap on its own and pays {{capExampleUsd}} ({{capExamplePx}}). Start with a {{nextExampleHours}}-hour T1 project instead and it pays around {{nextExampleRate}}/hr ({{nextExamplePx}}), but the RE stays on your profile and raises the rate for whatever you build next.

::: note The TL;DR
Every hour you build banks RE for good, and that raises the rate on everything you build afterwards.
:::

## Levels

Your level, 1 to {{maxLevel}}, is just a readout of your lifetime RE. It doesn't feed into your pay. It's a marker for how much you've shipped.

| Levels {{band1From}}-{{band1To}} | {{band1Per}} RE per level | {{band1Total}} RE total ({{band1HRange}}) |
| Levels {{band2From}}-{{band2To}} | {{band2Per}} RE per level | {{band2Total}} RE total ({{band2HRange}}) |
| Levels {{band3From}}-{{band3To}} | {{band3Per}} RE per level | {{band3Total}} RE total ({{band3HRange}}) |

The first few levels go quickly. A couple of hours on your first build moves you more than one.

## Where to check your stats

The top bar of your Builder Terminal shows your level, lifetime RE and current rate. It updates the moment an approval goes through.
