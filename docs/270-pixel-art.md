---
title: Pixel art guide
group: Guides
description: Techniques for crafting crisp, consistent pixel art sprites and game icons.
---

# Pixel art guide

^ Pixel art is about deliberate constraint. Creating clean sprites requires clarity and cohesive palette choices rather than complex drawing skills.

## Recommended software

- **Aseprite:** The gold standard for indie game devs and pixel artists (paid, but affordable and packed with animation tools).
- **Piskel:** Free, open-source, in-browser pixel editor.
- **LibreSprite:** Free open-source fork of Aseprite.

## Canvas sizing

Start small:
- **16×16 px:** Perfect for inventory icons, runes, and micro-sprites.
- **32×32 px:** Great for character portraits, weapons, and detailed tiles.

Working with smaller resolutions forces you to focus on silhouette and readability instead of noisy details that disappear in-game.

## Palettes and lighting

1. **Limit your palette:** Restrict each sprite set to 8 to 16 cohesive colors. Keeping the same palette across multiple items makes the collection look unified.
2. **Consistent light source:** Pick a lighting angle (usually top-left) and stick to it on every sprite so highlights and shadows match.
3. **Clean outlines:** Use dark outlines to separate foreground objects from varying game background tiles.

## Exporting for projects

Always export sprites at their **1x native resolution** as PNGs. Scale them up in CSS (`image-rendering: pixelated;`) or your game engine settings so the pixels stay sharp without blurry interpolation.
