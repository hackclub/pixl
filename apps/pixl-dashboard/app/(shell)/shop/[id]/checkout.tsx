"use client";

// Checkout confirm steps: Beacon-unlock warning -> shipping address confirm
// (or verify via Hack Club Auth) -> first-order phone -> buy.
import Image from "next/image";
import { useState } from "react";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Button, Input, Notice } from "@/components/ui/primitives";
import { goTo, useAction } from "@/components/use-action";
import { startAuthFlow } from "@/lib/actions/flows";

export interface CheckoutEligibility {
  hasAddress: boolean;
  hasPhone: boolean;
  summary: string;
}

export type CheckoutStep = null | "beacon" | "address" | "phone";

export function firstStep(beacon: boolean): CheckoutStep {
  return beacon ? "beacon" : "address";
}

export function Checkout({
  step,
  setStep,
  itemId,
  itemName,
  beaconAvailable,
  eligibility,
  pending,
  onBuy,
}: {
  step: CheckoutStep;
  setStep: (s: CheckoutStep) => void;
  itemId: number;
  itemName: string;
  beaconAvailable: number;
  eligibility: CheckoutEligibility;
  pending: boolean;
  onBuy: (phone?: string) => void;
}) {
  const flow = useAction(startAuthFlow);
  const [phone, setPhone] = useState("");
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const close = (open: boolean) => !open && setStep(null);

  async function verifyAddress() {
    const r = await flow.run({ name: "verify-address", returnTo: `/shop/${itemId}?addr_verified_return=1` });
    if (r.ok && !goTo(r.data.url)) flow.setError("Couldn't start address verification.");
  }

  function afterAddress() {
    if (!eligibility.hasPhone) setStep("phone");
    else {
      setStep(null);
      onBuy();
    }
  }

  function submitPhone() {
    const v = phone.trim();
    if (v.length < 7 || v.length > 20) {
      setPhoneErr("Enter a valid phone number.");
      return;
    }
    setStep(null);
    onBuy(v);
  }

  return (
    <>
      <Dialog open={step === "beacon"} onOpenChange={close} title="Spend a Beacon unlock?">
        <div className="flex items-start gap-3 border-2 border-stroke bg-[color-mix(in_srgb,var(--gold)_16%,var(--panel))] px-[13px] py-[11px]">
          <Image
            src="/img/pixl-ui/icon_beacon.png"
            alt=""
            aria-hidden
            width={30}
            height={30}
            className="mt-[1px] size-[30px] shrink-0 [image-rendering:pixelated]"
          />
          <div className="min-w-0">
            <p className="font-pixel text-[12px] tracking-[.8px] text-ink">BEACON REWARD</p>
            <p className="mt-[5px] text-sm leading-[1.5] text-dim">
              <strong className="text-ink">{itemName}</strong> costs one of your Beacon unlocks.
            </p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <div className="border-2 border-stroke bg-panel-2 px-3 py-2">
            <dt className="font-pixel text-[9px] uppercase tracking-[.6px] text-faint">Unspent now</dt>
            <dd className="mt-1 font-pixel text-xl leading-none text-ink tabular-nums">{beaconAvailable}</dd>
          </div>
          <div className="border-2 border-stroke bg-panel px-3 py-2">
            <dt className="font-pixel text-[9px] uppercase tracking-[.6px] text-faint">After this order</dt>
            <dd className="mt-1 font-pixel text-xl leading-none text-gold tabular-nums">
              {Math.max(0, beaconAvailable - 1)}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[13px] leading-[1.5] text-dim">
          Once fulfillment starts, the unlock is spent for good. If you cancel while the order is still pending, your
          pixels and the unlock come back.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setStep(null)}>
            Keep my unlock
          </Button>
          <Button disabled={beaconAvailable < 1} onClick={() => setStep("address")}>
            Use 1 Beacon unlock
          </Button>
        </div>
      </Dialog>

      {eligibility.hasAddress ? (
        <Dialog open={step === "address"} onOpenChange={close} title="Confirm shipping address">
          <p className="text-dim">We&apos;ll ship to: {eligibility.summary}</p>
          {flow.error ? <Notice tone="bad" className="mt-3">{flow.error}</Notice> : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep(null)}>
              Cancel
            </Button>
            <Button variant="dark" disabled={flow.pending} onClick={verifyAddress}>
              Verify address
            </Button>
            <Button disabled={pending} onClick={afterAddress}>
              Yes, ship here
            </Button>
          </div>
        </Dialog>
      ) : (
        <ConfirmDialog
          open={step === "address"}
          onOpenChange={close}
          title="No shipping address on file"
          description="We need an address before you can order this. Verify it with your Hack Club identity."
          confirmLabel="Verify address"
          pending={flow.pending}
          onConfirm={verifyAddress}
        >
          {flow.error ? <Notice tone="bad">{flow.error}</Notice> : null}
        </ConfirmDialog>
      )}

      <Dialog
        open={step === "phone"}
        onOpenChange={close}
        title="Phone number needed"
        description="We need a phone number for shipping this prize. It's only asked once."
      >
        <Input
          type="tel"
          placeholder="e.g. +1 555 123 4567"
          value={phone}
          maxLength={20}
          autoComplete="tel"
          onChange={(e) => {
            setPhone(e.target.value);
            setPhoneErr(null);
          }}
        />
        {phoneErr ? <Notice tone="bad" className="mt-2">{phoneErr}</Notice> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setStep(null)}>
            Cancel
          </Button>
          <Button onClick={submitPhone}>Continue</Button>
        </div>
      </Dialog>
    </>
  );
}
