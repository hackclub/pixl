---
title: Rewards
group: Build & ship
description: Pixels are the core currency of Pixl.
---

# Rewards

^ Everything you ship pays out in **pixels**, which buy real physical and digital rewards.

## How you earn

Every approved hour pays at your current rate, which starts at {{basePx}}/hr and rises to {{maxPx}}/hr as your Restoration Energy builds up.

Finish a trial and you choose between its prize (plus pixels for hours past the minimum) or the whole thing as raw pixels. Either way an approved trial ship adds {{trialBonusRe}} bonus RE to your profile, which pushes your level along faster.

## Why the totals don't divide out evenly

Pixels only come in whole numbers, nobody gets paid 57.14 of one. So every payout is rounded to the nearest whole pixel from the exact dollar amount you earned.

At the very start ({{baseUsd}}/hr), one hour is worth {{baseExactPx}} px exactly, but you're paid **{{basePx}}** since it rounds down. At the {{maxUsd}}/hr cap, one hour is worth {{maxExactPx}} px exactly, and you're paid **{{maxPx}}** since it rounds up. Same rule both times, round to the nearest whole pixel, it just lands on opposite sides depending on where the decimal falls.

That's also why dividing a rounded total back into "pixels per dollar" gives a slightly different number depending on which project you check: the underlying rate is always **{{pixelValueUsd}}** per pixel ({{pxPerDollar}} px per dollar), it never moves. What changes is only the rounded whole number you actually see, never the rate itself.

Rounding this way means you can lose or gain a fraction of a pixel on any single project, at most half a pixel's worth, but it's never more than a cent or two, and it goes both ways. It is not a hidden cut and it does not favor higher rates over lower ones.

## What you can spend them on

The in-game shop has stickers, soldering irons, microcontrollers, mechanical keyboards, Apple gear and more.
