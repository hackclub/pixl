import type { Metadata } from "next";
import { config } from "@/app/_generated/config";
import { Card, CardTitle, EmptyNote, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { serverGet } from "@/lib/server-api";
import { CopyButton } from "../explore/_components/copy-button";
import { ApplyForm } from "./apply-form";
import { applyCardState, referralLink, TIERS, type ReferralMe } from "./lib";

export const metadata: Metadata = { title: "Referrals" };

const note = "mt-[10px] text-[13px] leading-[1.6] text-faint";
const codeRow = "flex flex-wrap items-center gap-[12px]";
const box = "border-2 border-stroke bg-panel-deep";

function Stat({ n, label }: { n: string | number; label: string }) {
  return (
    <div className={cn(box, "min-w-[120px] flex-1 p-[14px]")}>
      <div className="text-[22px] font-bold text-ink">{n}</div>
      <div className="mt-[2px] text-[12px] text-faint">{label}</div>
    </div>
  );
}

export default async function RefersPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const sp = await searchParams;
  const prefill = Array.isArray(sp.code) ? (sp.code[0] ?? "") : (sp.code ?? "");
  // GET /api/referral/me (session). Assigns the code on first visit.
  const res = await serverGet<ReferralMe>("/api/referral/me");

  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader
        title="REFERRALS"
        sub="Share your code. When someone you refer ships their first qualifying project, you both get paid."
      />
      {!res.ok ? (
        <EmptyNote>COULDN&apos;T LOAD YOUR REFERRAL INFO.<br />TRY AGAIN IN A BIT.</EmptyNote>
      ) : (
        <Body me={res.data} prefill={prefill} />
      )}
    </div>
  );
}

function Body({ me, prefill }: { me: ReferralMe; prefill: string }) {
  const link = referralLink(config.urls.site, me.code);
  const state = applyCardState(me);
  const r = me.referrals ?? { total: 0, rewarded: 0, pixelsEarned: 0 };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardTitle className="mb-3 text-gold">YOUR CODE</CardTitle>
        <div className={codeRow}>
          <span className={cn(box, "px-[18px] py-[12px] font-pixel text-[26px] tracking-[4px] text-gold")}>{me.code}</span>
          <CopyButton text={me.code} label="COPY CODE" />
        </div>
        <div className={cn(codeRow, "mt-3")}>
          <span className={cn(box, "min-w-0 flex-1 overflow-x-auto px-[14px] py-[10px] text-[13px] whitespace-nowrap text-dim")}>{link}</span>
          <CopyButton text={link} label="COPY LINK" />
        </div>
        <p className={note}>
          The first time a project shipped by the person you referred hits one of these hour marks, you get paid,
          based on that project&apos;s hours, whichever ship it happens to be:
        </p>
        <div className="mt-[16px] flex flex-wrap gap-[10px]">
          {TIERS.map((t) => (
            <div className={cn(box, "min-w-[110px] flex-1 px-[8px] py-[12px] text-center")} key={t.hrs}>
              <div className="text-[12px] tracking-[.5px] text-dim">{t.hrs} SHIPPED BY THEM</div>
              <div className="mt-[4px] text-[18px] font-bold text-gold">{t.amt}</div>
              <div className="mt-[2px] text-[12px] text-faint">{t.usd}</div>
            </div>
          ))}
        </div>
        <p className={note}>
          This pays out once per referral. Refer 10 people who all ship and you get a <b>+83px</b> (~$8.30) milestone
          bonus, again every 10 after that.
        </p>
        <p className={note}>
          Worth mentioning when you share your code: the person you refer gets something too, <b>+4px/hr</b>{" "}
          (~$0.40/hr) extra on their own first shipped project.
        </p>
      </Card>

      {state === "boost-active" || state === "boost-used" ? (
        <Card>
          <CardTitle className="mb-3 text-gold">YOUR REFERRAL BOOST</CardTitle>
          <div className="flex flex-wrap items-center gap-[8px] text-[13.5px] text-faint">
            {state === "boost-active" ? (
              <>
                <span className="border-2 border-stroke px-[9px] py-[3px] text-teal">+4px/hr ACTIVE</span> applies to your next shipped project
              </>
            ) : (
              "You've used your referral boost, back to your normal rate now."
            )}
          </div>
          <div className={cn(box, "mt-[10px] h-[10px] overflow-hidden")}>
            <div className="h-full bg-teal" style={{ width: state === "boost-active" ? "0%" : "100%" }} />
          </div>
        </Card>
      ) : (
        <Card>
          <CardTitle className="mb-3 text-gold">GOT A CODE?</CardTitle>
          {state === "apply" ? (
            <>
              <p className={cn(note, "mt-0 mb-3")}>
                Enter the code whoever referred you shared. You&apos;ll get +4px/hr on your first shipped project.
              </p>
              <ApplyForm prefill={prefill} />
            </>
          ) : (
            <p className={cn(note, "mt-0")}>
              Referral codes can only be applied within your first {me.referralWindowHours} hours on Pixl, that
              window&apos;s closed for your account.
            </p>
          )}
        </Card>
      )}

      <Card>
        <CardTitle className="mb-3 text-gold">YOUR REFERRALS</CardTitle>
        {r.total === 0 ? (
          <EmptyNote>
            NOBODY&apos;S USED YOUR CODE YET.
            <br />
            SHARE IT AROUND.
          </EmptyNote>
        ) : (
          <div className="flex flex-wrap gap-[10px]">
            <Stat n={r.total} label="REFERRED" />
            <Stat n={r.rewarded} label="REWARDED" />
            <Stat n={`${r.pixelsEarned}px`} label="EARNED" />
          </div>
        )}
      </Card>
    </div>
  );
}
