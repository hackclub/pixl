# Shop regional pricing - stocking the remaining regions

_Applied to the orchard/CNPG database on 2026-08-15. Companion migrations:
`0114_europe_prices_ender_se_drop_samsung.sql`, `0115_stock_remaining_regions.sql`._

## Goal

The shop has 7 regions. Only `US`, `EUROPE`, `INDIA` were stocked; `NORTH_AMERICA`,
`SOUTH_AMERICA`, `ASIA`, `AFRICA` each held a single item (`GTA VI`). All four
are now stocked.

## What was done

**Flat items** (grants, licences, digital goods, HQ-shipped merch, same price
everywhere) were copied into the four empty regions at the US price.
**`NORTH_AMERICA` = the full US catalogue at US prices** (North-American MSRPs
are quoted in USD).

**Region-priced hardware** (28 items; `Framework 13/16 DIY` excluded, US-only
`config_options`) was priced per region. For `ASIA` / `SOUTH_AMERICA` /
`AFRICA` each item's price is the **real local retail** of a representative
country, checked online item-by-item, converted through the 0097/0104 pixel
pipeline. Where a product has no clean local listing it falls back to a
calibrated regional factor (`est`), and where it isn't sold at all it's `0`
(`TBD`).

| Region | Market | Currency | FX (USD→) |
|---|---|---|---:|
| NORTH_AMERICA | United States | USD | 1.00 (= US prices) |
| ASIA | Singapore | SGD | 1.28 |
| SOUTH_AMERICA | Brazil | BRL | 5.20 |
| AFRICA | South Africa | ZAR | 16.5 |

Pipeline: `local retail (incl. local tax) → USD → hours = round(USD/3.5 to 0.5h)
→ ×50 → round(×1.1 to 25) px`.

> **Why ASIA is so much cheaper than SOUTH_AMERICA:** Singapore is a low-tax
> electronics hub (9% GST, no import duty, strong SGD) so prices sit near the
> US; Brazil layers heavy import taxes on electronics, so the same product runs
> ~2× the US pixel price (an Apple laptop there is ≈2.2×). This is faithful to
> local retail. If you'd rather ASIA reflect a higher-tax Asian market, pick a
> different representative country and these numbers move up.

## Applied prices (pixels) - `✓` = real local price, `~` = estimated, `TBD` = not sold there

| Item | ASIA | SOUTH_AMERICA | AFRICA |
|---|---|---|---|
| MacBook Air M5 | 19625 ✓ | 42300 ✓ | 25250 ✓ |
| Mac Mini (24GB/512GB) | 17800 ✓ | 37150 ✓ | 17600 ~ |
| iPad Air (M4, 128GB) | 11025 ✓ | 22650 ✓ | 15700 ✓ |
| MacBook Neo | 10425 ✓ | 22050 ✓ | 14950 ~ |
| AirPods Max 2 | 9175 ✓ | 17925 ✓ | 10950 ✓ |
| iPad (11th gen) | 7350 ✓ | 9850 ~ | 7675 ~ |
| AirPods Pro 3 | 4475 ~ | 7025 ~ | 5450 ~ |
| Apple Pencil Pro | 2450 ✓ | 3650 ~ | 2825 ~ |
| Nintendo Switch 2 | 8825 ✓ | 13925 ✓ | 10950 ✓ |
| Nothing Phone (4a) Pro | 6875 ~ | **TBD** | 8375 ~ |
| Samsung Galaxy S24 | 7975 ✓ | 7575 ✓ | 10475 ✓ |
| Bambu Lab A1 Combo | 6875 ✓ | 14800 ✓ | 9200 ~ |
| Bambu Lab A1 | 5400 ✓ | 10600 ✓ | 8750 ✓ |
| Creality Sparkx i7 | 4150 ~ | 6475 ~ | 5050 ~ |
| Bambu Lab A1 Mini | 3600 ✓ | 6200 ~ | 4825 ~ |
| Creality Ender 3 V3 SE | 3600 ~ | 5625 ~ | 4375 ~ |
| Centauri Carbon | 6625 ✓ | 12075 ✓ | 7900 ~ |
| Sony WH-1000XM5 | 7225 ✓ | 5450 ✓ | 6650 ✓ |
| Sony WH-CH720N | 1875 ~ | 2925 ~ | 2275 ~ |
| Samsung T7 SSD (1TB) | 4150 ~ | 6475 ~ | 5050 ~ |
| Epomaker x Aula S75 Pro | 1075 ~ | 1675 ~ | 1300 ~ |
| Wacom Intuos (Small) | 725 ~ | 1125 ~ | 875 ~ |
| FURYCUBE 68% | 625 ~ | 1000 ~ | 775 ~ |
| Electric Screwdriver Set | 350 ~ | 550 ~ | 425 ~ |
| ESP32 Starter Kit | 325 ~ | 500 ~ | 375 ~ |
| Soldering Iron | 125 ~ | 175 ~ | 150 ~ |
| Raspberry Pi 5 | 1600 ✓ | 2300 ~ | 1775 ~ |
| Retro Handheld (Miyoo/RG35XX) | 1275 ~ | 1975 ~ | 1550 ~ |

`NORTH_AMERICA` = the US column (not repeated). `GTA VI` was already region-priced.

## Verified local retail (the `✓` sources)

| Item | Singapore | Brazil | South Africa |
|---|---|---|---|
| MacBook Air M5 | S$1,599 | R$14,000 | R26,499 |
| Mac Mini 24/512 | S$1,449 | R$12,299 | - |
| iPad Air M4 128 | S$899 | R$7,499 | R16,499* |
| MacBook Neo | S$849 | R$7,299 | - |
| AirPods Max 2 | S$749 | R$5,931 | R11,499 |
| iPad 11 (A16) 128 | S$599 | - | - |
| Apple Pencil Pro | S$199 | - | - |
| Nintendo Switch 2 | S$719 | R$4,599 | R11,500 |
| Samsung Galaxy S24 | ~S$650 | ~R$2,500 | ~R11,000 |
| Bambu A1 / Combo | S$439 / ~S$559 | ~R$3,500 / ~R$4,900 | R9,195 |
| Bambu A1 Mini | S$293 | - | - |
| Centauri Carbon | S$539 | ~R$4,000 | - |
| Sony WH-1000XM5 | S$589 | ~R$1,800 | R6,999 |
| Raspberry Pi 5 (8GB) | ~S$130 | - | - |

`*` iPad Air ZA is the 11" Wi-Fi estimate off the R18,399 cellular listing.
Sources: apple.com (sg/br/za), istore.co.za, hardwarezone.com.sg, techtudo/
macmagazine (BR), mybroadband.co.za, drybox/geewiz (ZA), Bambu/Elegoo stores,
Sony store listings - August 2026.

## Caveats

- **`~` items** had no clean local listing quickly, so they use a blended
  regional factor (ASIA ×1.15, SOUTH_AMERICA ×1.80, AFRICA ×1.40 on the US px).
  They're low-value maker/accessory SKUs; I can verify any of them on request.
- **Config matching is approximate**, the local "starts at" price doesn't
  always match the US item's exact RAM/SSD; street vs official price also
  varies (Sony/Samsung are heavily discounted in some markets).
- **`Nothing Phone (4a) Pro` isn't sold in Brazil yet** → `TBD` (px 0). It also
  has no clean SG/ZA listing → those are estimates.
- **`Samsung Galaxy S24`** was pulled from EU (EOL) but kept elsewhere; consider
  removing it globally if discontinued.
- **AFRICA has the most `~`**, I anchored its categories (Apple/console/
  printer/audio/phone) with real ZA retail but didn't individually list every
  mid/low item. Say the word and I'll finish the ZA/BR gaps item-by-item.
