// What the price line, afford bar and BUY button show for an item, given the
// current picks. Mirrors the old page's updatePlainPriceUI /
// updateConfigPriceUI / locked branches in one pure function.
import { lockReason, type ShopItem } from "../shop-lib";

export interface PriceState {
  /** null = show a text label instead of a number */
  amount: number | null;
  text?: string;
  lockedIcon?: boolean;
  cant: boolean;
  was?: number;
  discountPct?: number;
  breakdown?: string;
  buyLabel: string;
  buyDisabled: boolean;
  pct: number;
  affordLabel: string;
}

export function priceState(opts: {
  item: ShopItem;
  pixels: number | null;
  total: number;
  quantity: number;
  inStock: boolean;
}): PriceState {
  const { item, pixels, total, quantity, inStock } = opts;
  const lockedPrice = item.config_options ? Number(item.config_options.base_price) : Number(item.price);
  const locked = (label: string): PriceState => ({
    amount: lockedPrice > 0 ? lockedPrice : null,
    text: lockedPrice > 0 ? undefined : "LOCKED",
    lockedIcon: true,
    cant: true,
    buyLabel: "LOCKED",
    buyDisabled: true,
    pct: 0,
    affordLabel: label,
  });

  if (item.locked && item.unlockPending) {
    return {
      amount: lockedPrice > 0 ? lockedPrice : null,
      text: lockedPrice > 0 ? undefined : "NOT AVAILABLE",
      cant: true,
      buyLabel: "NOT AVAILABLE",
      buyDisabled: true,
      pct: 0,
      affordLabel: "Available soon.",
    };
  }
  if (item.locked) return locked(lockReason(item));
  if (Number(item.price) <= 0) {
    return {
      amount: null,
      text: "NOT AVAILABLE",
      cant: true,
      buyLabel: "NOT AVAILABLE YET",
      buyDisabled: true,
      pct: 0,
      affordLabel: item.name === "Food Grant" ? "Available soon." : "Coming soon to this region.",
    };
  }

  const isConfig = !!item.config_options;
  const discounted = isConfig ? Number(item.discount_percent) > 0 : item.original_price != null;
  const beaconNote = item.beacon_locked
    ? ` · USES 1 BEACON UNLOCK (${item.beaconAvailable ?? 0} LEFT)`
    : "";
  const have = pixels ?? 0;
  const afford = pixels !== null && pixels >= total;
  const pct = Math.max(0, Math.min(100, (have / Math.max(1, total)) * 100));
  const soldOut = !isConfig && !inStock;

  return {
    amount: total,
    cant: !afford,
    discountPct: discounted ? Math.round(Number(item.discount_percent)) : undefined,
    // Per-choice original prices aren't kept server side, so a configurator
    // on sale gets the badge without a "was" amount.
    was: discounted && !isConfig ? Number(item.original_price) * quantity : undefined,
    breakdown: !isConfig && quantity > 1 ? `(${Number(item.price).toLocaleString()} × ${quantity})` : undefined,
    buyLabel: soldOut ? "SOLD OUT" : "BUY",
    buyDisabled: soldOut || !afford,
    pct,
    affordLabel: `YOU HAVE ${Math.round(have).toLocaleString()} / ${total.toLocaleString()} PX${pct >= 100 ? ", EASY." : ""}${beaconNote}`,
  };
}
