"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { bbstrip } from "@/components/markdown";
import { SafeImage } from "@/components/safe-image";
import { Button, buttonVariants, Notice, panel, textareaField } from "@/components/ui/primitives";
import { useAction } from "@/components/use-action";
import { cn } from "@/lib/cn";
import { buyItem, saveItem, unsaveItem } from "../actions";
import { shopError } from "../shop-errors";
import { isTrophy, metaBits, type ConfigPicks, type ShopItem } from "../shop-lib";
import { AffordBar, DetailPrice, LimitedChips } from "./detail-bits";
import { Checkout, firstStep, type CheckoutEligibility, type CheckoutStep } from "./checkout";
import { configImage, configTotal, optionSummary, resolvePicks, stockChoice, stockOk } from "./item-lib";
import { Configurator, PlainOptions } from "./option-pickers";
import type { EarnRates } from "../../calc/estimates";
import { hoursHint } from "../hours-hint";
import { priceState } from "./price-state";
import { TrophyDetail } from "./trophy-detail";
import {
  beaconTag,
  btnRow,
  detailDesc,
  detailImg,
  detailInfo,
  detailName,
  detailRow,
  imgPlaceholder,
  itemMeta,
  slotImg,
  smallCaps,
} from "../shop-styles";

const stepBtn = "w-[34px] border-2 border-stroke bg-panel-2 font-bold disabled:opacity-40";

export type { CheckoutEligibility };

const clampQty = (n: number) => (Number.isFinite(n) ? Math.max(1, Math.min(999, Math.round(n))) : 1);

export function ItemDetail({
  item,
  xp,
  claimed,
  pixels,
  eligibility,
  verifyReturn,
  rates,
}: {
  item: ShopItem;
  xp: number;
  claimed: boolean;
  pixels: number | null;
  eligibility: CheckoutEligibility;
  verifyReturn: "ok" | "failed" | null;
  /** Per-hour earn rates computed server side (calc/estimates.ts). */
  rates: EarnRates | null;
}) {
  const router = useRouter();
  const [rawPicks, setPicks] = useState<Record<number, string>>({});
  const [config, setConfig] = useState<ConfigPicks>({ ...(item.saved_config ?? {}) });
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(!!item.saved);
  const [bought, setBought] = useState(false);
  const [step, setStep] = useState<CheckoutStep>(null);
  const [notice, setNotice] = useState<string | null>(
    verifyReturn === "ok" ? "Address verified." : verifyReturn === "failed" ? "Couldn't get an address from Hack Club Auth." : null,
  );
  const buy = useAction(buyItem, shopError);
  const save = useAction(saveItem);
  const unsave = useAction(unsaveItem);

  const isConfig = !!item.config_options;
  const picks = resolvePicks(item, rawPicks);
  const inStock = stockOk(item, picks, quantity);
  const total = isConfig ? configTotal(item, config) : Number(item.price) * quantity;
  const ps = priceState({ item, pixels, total, quantity, inStock });
  const browsable = !item.locked || (item.beacon_locked && !item.manual_locked && Number(item.price) > 0);
  const hasStock = !isConfig && !!item.stock?.length;

  // Back from "Verify address" mid-checkout: drop the query and resume.
  useEffect(() => {
    if (!verifyReturn) return;
    router.replace(`/shop/${item.id}`, { scroll: false });
    if (verifyReturn === "ok") setStep(firstStep(false));
  }, [verifyReturn, item.id, router]);

  // Live stock: re-render from the server so "12 LEFT" stays current.
  useEffect(() => {
    if (!hasStock) return;
    const t = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(t);
  }, [hasStock, router]);

  if (isTrophy(item)) return <TrophyDetail item={item} xp={xp} claimed={claimed} />;

  const summary = optionSummary(item, picks, config);

  async function persistSave(nextConfig: ConfigPicks) {
    await save.run({ id: item.id, option: optionSummary(item, picks, nextConfig), config: isConfig ? nextConfig : null });
  }

  async function toggleSave() {
    const next = !saved;
    setSaved(next);
    const r = next
      ? await save.run({ id: item.id, option: summary, config: isConfig ? config : null })
      : await unsave.run({ id: item.id });
    if (!r.ok) setSaved(!next);
    else setNotice(next ? "Saved! It's now at the top of the shop for you!" : "Removed from saved items.");
  }

  async function doBuy(phone?: string) {
    const choice = stockChoice(item, picks);
    const r = await buy.run({
      id: item.id,
      option: summary,
      note: note.trim().slice(0, 300),
      ...(phone ? { phone } : {}),
      ...(isConfig ? { config } : { quantity, ...(choice ? { stockChoice: choice } : {}) }),
    });
    if (r.ok) {
      setBought(true);
      setNotice(
        item.beacon_locked
          ? "ORDER PLACED! One Beacon unlock is now spent."
          : "ORDER PLACED! The team will reach out.",
      );
      router.refresh();
    } else if (r.error === "phone_required") {
      buy.setError(null);
      setStep("phone");
    } else if (r.error === "address_required") {
      buy.setError(null);
      setStep("address");
    } else if (r.error === "sold_out") {
      router.refresh();
    }
  }

  return (
    <section className={cn(panel, "p-5")}>
      <div className={detailRow}>
        <div className={detailImg}>
          <SafeImage
            src={isConfig ? configImage(item, config) : item.image_url}
            className={slotImg}
            fallback={<span className={imgPlaceholder} />}
          />
        </div>
        <div className={detailInfo}>
          <h1 className={detailName}>{item.name}</h1>
          <LimitedChips item={item} isConfig={!!(isConfig && browsable)} />
          <DetailPrice ps={ps} hint={item.locked ? "" : hoursHint(total, rates)} />
          <div className={detailDesc}>{bbstrip(item.description || "")}</div>
          {metaBits(item).length ? <div className={itemMeta}>{metaBits(item).join(" · ")}</div> : null}

          {item.beacon_locked ? (
            <div
              className={cn(
                "flex items-start gap-[12px] border-2 border-stroke px-[13px] py-[11px]",
                (item.beaconAvailable ?? 0) > 0
                  ? "bg-[color-mix(in_srgb,var(--gold)_16%,var(--panel))]"
                  : "bg-panel-2",
              )}
            >
              <Image
                src="/img/pixl-ui/icon_beacon.png"
                alt=""
                aria-hidden
                width={30}
                height={30}
                className="mt-[1px] size-[30px] shrink-0 [image-rendering:pixelated]"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-[8px]">
                  <span className={beaconTag}>BEACON REWARD</span>
                  <span className="font-pixel text-[10px] tracking-[.5px] text-dim">
                    {item.beaconAvailable ?? 0} UNSPENT
                  </span>
                </div>
                <p className="mt-[6px] text-[13.5px] leading-[1.5] text-dim">
                  {(item.beaconAvailable ?? 0) > 0
                    ? `Buying this spends 1 of your ${item.beaconAvailable} Beacon unlock${
                        item.beaconAvailable === 1 ? "" : "s"
                      }. An item you already own stays unlocked, so buying it again won't spend another.`
                    : "You have no unspent Beacon unlocks. Get a project nominated as a Beacon to earn one."}
                </p>
              </div>
            </div>
          ) : null}

          {browsable && isConfig ? (
            <Configurator
              item={item}
              picks={config}
              onChange={(next) => {
                setConfig(next);
                if (saved) void persistSave(next);
              }}
            />
          ) : null}
          {browsable && !isConfig ? (
            <PlainOptions item={item} picks={picks} onPick={(g, c) => setPicks({ ...picks, [g]: c })} />
          ) : null}

          {browsable ? (
            <div>
              <label className={smallCaps} htmlFor="note-input">
                NOTE TO FULFILLER (OPTIONAL)
              </label>
              <textarea
                id="note-input"
                className={cn(textareaField, "mt-1")}
                maxLength={300}
                rows={2}
                placeholder="anything the person shipping this should know..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          ) : null}

          <AffordBar pct={ps.pct} label={ps.affordLabel} />

          {browsable && !isConfig ? (
            <div className="flex items-center gap-[10px]">
              <span className={smallCaps}>QTY</span>
              <div className="flex">
                <button type="button" className={stepBtn} disabled={quantity <= 1} onClick={() => setQuantity(clampQty(quantity - 1))}>
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  max={999}
                  inputMode="numeric"
                  aria-label="Quantity"
                  className="w-[64px] border-y-2 border-stroke bg-panel text-center text-ink"
                  value={quantity}
                  onChange={(e) => setQuantity(clampQty(Number(e.target.value)))}
                />
                <button type="button" className={stepBtn} disabled={quantity >= 999} onClick={() => setQuantity(clampQty(quantity + 1))}>
                  +
                </button>
              </div>
            </div>
          ) : null}

          {notice ? <Notice tone={notice.startsWith("Couldn't") ? "bad" : "good"}>{notice}</Notice> : null}
          {buy.error || save.error || unsave.error ? (
            <Notice tone="bad">{buy.error || save.error || unsave.error}</Notice>
          ) : null}

          <div className={btnRow}>
            {bought ? (
              <Link className={buttonVariants({ variant: "teal" })} href="/orders">
                VIEW MY ORDERS
              </Link>
            ) : (
              <Button
                disabled={ps.buyDisabled || buy.pending}
                onClick={() => setStep(firstStep(!!item.beacon_locked))}
              >
                {buy.pending ? "BUYING..." : item.beacon_locked ? "BUY WITH BEACON" : ps.buyLabel}
              </Button>
            )}
            <Button variant={saved ? "teal" : "dark"} onClick={toggleSave}>
              {saved ? "★ SAVED" : "☆ SAVE"}
            </Button>
            <Link className={buttonVariants({ variant: "dark" })} href="/shop">
              KEEP BROWSING
            </Link>
          </div>
        </div>
      </div>
      <Checkout
        step={step}
        setStep={setStep}
        itemId={item.id}
        itemName={item.name}
        beaconAvailable={item.beaconAvailable ?? 0}
        eligibility={eligibility}
        pending={buy.pending}
        onBuy={doBuy}
      />
    </section>
  );
}
