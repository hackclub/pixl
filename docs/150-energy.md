---
title: Restoration Energy and levels
group: Build & ship
description: Every hour you ship becomes Restoration Energy, or RE.
---

# Restoration Energy and levels

^ Every hour you ship becomes **Restoration Energy**, or RE. It's the number the whole economy runs on: RE decides what an hour of your work pays, and your level is a readout of how much of it you've built up.

You never spend RE. It only goes up, nothing decays, and nothing anyone else ships takes any of it away from you. Pixels are the thing you spend; RE is the thing that decides how many pixels an hour is worth.

## Tiers decide what an hour is worth

When a reviewer approves your project they also give it a **tier**, 1 to 4, based on how ambitious the build actually is. The tier sets how much RE each shipped hour on that project earns.

| T1 Spark | A first spark of Restoration: a simple site, script or tiny tool. | {{t1}} RE / hour |
| T2 Signal | A focused app, CLI or game with real polish, one system back online. | {{t2}} RE / hour |
| T3 Grid | Several systems working together: backend, state, infrastructure. | {{t3}} RE / hour |
| T4 Nexus | Deep systems work: complex architecture and serious scope. | {{t4}} RE / hour |

Tier is about the project, not about you. A first timer who ships something genuinely hard gets the high tier for it. Padding a simple site out with hours doesn't move it up either, since reviewers look at the actual repo.

## RE decides your rate, and it's yours forever

Your **lifetime RE** — every hour of every project you've ever shipped, added up — is what sets your hourly rate. It never resets and nothing you ship later erases what you already earned. The rate itself is a fixed table: once your lifetime RE crosses a threshold, every ship from then on pays at that rate or higher, this one included.

| {{step1Re}} RE | lifetime, reached | {{step1Usd}} / hour |
| {{step2Re}} RE | lifetime, reached | {{step2Usd}} / hour |
| {{step3Re}} RE | lifetime, reached | {{step3Usd}} / hour |
| {{step4Re}} RE | lifetime, reached | {{step4Usd}} / hour |
| {{step5Re}} RE | lifetime, reached | {{step5Usd}} / hour |
| {{step6Re}} RE | lifetime, reached | {{step6Usd}} / hour |
| {{step7Re}} RE | lifetime, the cap | **{{step7Usd}} / hour** |

Since RE is one pooled number no matter which tiers earned it, your real hours-to-cap depends on whatever mix of tiers you ship. But if you stuck to one tier the whole way, here's how many hours each payout level takes:

### If you only ship T4 Nexus

| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T4h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T4h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T4h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T4h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T4h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T4h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T4h}}h** |

### If you only ship T3 Grid

| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T3h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T3h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T3h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T3h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T3h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T3h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T3h}}h** |

### If you only ship T2 Signal

| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T2h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T2h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T2h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T2h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T2h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T2h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T2h}}h** |

### If you only ship T1 Spark

| {{step1Usd}} / hr | {{step1Re}} RE | {{step1T1h}}h |
| {{step2Usd}} / hr | {{step2Re}} RE | {{step2T1h}}h |
| {{step3Usd}} / hr | {{step3Re}} RE | {{step3T1h}}h |
| {{step4Usd}} / hr | {{step4Re}} RE | {{step4T1h}}h |
| {{step5Usd}} / hr | {{step5Re}} RE | {{step5T1h}}h |
| {{step6Usd}} / hr | {{step6Re}} RE | {{step6T1h}}h |
| **{{step7Usd}} / hr (cap)** | {{step7Re}} RE | **{{step7T1h}}h** |

For example, ship a {{capExampleHours}} hour T4 project from scratch and its own RE alone gets you to the {{step7Usd}} cap, paid {{capExampleUsd}} ({{capExamplePx}}) total. Ship a {{nextExampleHours}} hour T1 project first instead and it only earns a little RE, so it's paid close to base: around {{nextExampleRate}} an hour ({{nextExamplePx}} total) — but that RE doesn't vanish. It's sitting in your lifetime total, pushing your very next ship's rate up before it even starts.

::: note The short version
Every hour you ship, at any tier, banks RE forever and pushes your rate up for every ship after it, including the one that earned it.
:::

## Levels

Your level is a display of lifetime RE and nothing more. Levels run 1 to {{maxLevel}}, each one costs more RE than the last, and they have **no effect on what you get paid**: the rate comes straight off RE. Level is just there so the shipping shows up somewhere.

| Levels {{band1From}}-{{band1To}} | {{band1Per}} RE per level | {{band1Total}} RE total |
| Levels {{band2From}}-{{band2To}} | {{band2Per}} RE per level | {{band2Total}} RE total |
| Levels {{band3From}}-{{band3To}} | {{band3Per}} RE per level | {{band3Total}} RE total |

Early levels are cheap on purpose: a couple of hours on your first project already moves you a level or two. The last level and the top pay rate land on the same amount of RE, so you hit both at once. RE keeps stacking past that, it just runs out of levels to show for it.

## Where to see all this

The bar at the top of your Builder Terminal shows your level, your lifetime RE and your current rate in pixels per hour. It updates as soon as a project is approved.
