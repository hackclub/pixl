---
title: Pixel art guide
group: Guides
description: How to make sprites and icons that stay readable at 16 pixels across.
---

# Pixel art guide

^ Pixel art is mostly about constraint. Good sprites come from clear shapes and a tight palette, not from being able to draw.

## Recommended software

- **Aseprite:** what most people use. Paid, but cheap, and the animation tools are worth it.
- **Piskel:** free, open source, runs in the browser.
- **LibreSprite:** free, open source fork of Aseprite.

## Canvas sizing

Start small:

- **16×16:** inventory icons, runes, tiny sprites.
- **32×32:** character portraits, weapons, detailed tiles.

A small canvas forces you to work on the silhouette, which is the thing people actually read. Fine detail disappears in game anyway.

## Palettes and lighting

1. **Keep the palette small.** Eight to sixteen colours per sprite set. Reusing the same palette across items is what makes a set look like a set.
2. **Pick a light source and keep it.** Usually top-left. If it moves between sprites, the whole sheet looks wrong and it's hard to say why.
3. **Outline in something dark.** It keeps the sprite readable against whatever tile it's standing on.

## Exporting for projects

Export PNGs at 1x, their real size. Scale them up in CSS with `image-rendering: pixelated;` or in your engine's import settings, so they stay sharp instead of going blurry.
