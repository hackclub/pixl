"use client";

import { useState } from "react";
import { Button, Label, Notice, Textarea } from "@/components/ui/primitives";
import { useAction } from "@/components/use-action";
import { cn } from "@/lib/cn";
import { submitNps } from "./actions";

type Area = "onboarding" | "reviews" | "shop" | "communication";

const AREAS: { key: Area; label: string }[] = [
  { key: "onboarding", label: "Getting started and the rules" },
  { key: "reviews", label: "Review speed and fairness" },
  { key: "shop", label: "The shop and the prizes" },
  { key: "communication", label: "Communication (Slack, DMs, support)" },
];

const scale = "block min-w-[38px] cursor-pointer border-2 border-stroke bg-panel-deep px-[10px] py-[9px] text-center font-bold tabular-nums text-ink";
const scaleOn =
  "peer-checked:border-gold peer-checked:bg-gold peer-checked:text-panel-deep peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold hover:border-dim";

function Choice({ name, value, checked, onChange }: { name: string; value: number; checked: boolean; onChange: () => void }) {
  return (
    <label>
      <input type="radio" className="peer sr-only" name={name} value={value} checked={checked} onChange={onChange} />
      <span className={cn(scale, scaleOn)}>{value}</span>
    </label>
  );
}

export function NpsForm() {
  const [score, setScore] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [ratings, setRatings] = useState<Partial<Record<Area, number>>>({});
  const [fixText, setFixText] = useState("");
  const [done, setDone] = useState(false);
  const submit = useAction(submitNps);

  async function onSubmit() {
    if (score === null) return;
    const res = await submit.run({
      score,
      reason: reason.trim() || undefined,
      ratings: Object.keys(ratings).length ? ratings : undefined,
      fixText: fixText.trim() || undefined,
    });
    if (res.ok) setDone(true);
  }

  if (done) return <Notice tone="good">Thanks for the feedback, it really helps us improve Pixl.</Notice>;

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-[8px] font-pixel text-[12px] uppercase tracking-[1.5px] text-dim">
          How likely are you to recommend Pixl to a friend who likes making things?
        </legend>
        <div className="flex flex-wrap gap-[6px]">
          {Array.from({ length: 11 }, (_, n) => (
            <Choice key={n} name="nps-score" value={n} checked={score === n} onChange={() => setScore(n)} />
          ))}
        </div>
        <div className="mt-[6px] flex justify-between text-[12px] text-faint">
          <span>0 = not at all likely</span>
          <span>10 = extremely likely</span>
        </div>
      </fieldset>

      <div>
        <Label htmlFor="nps-reason">What is the main reason for your score? (optional)</Label>
        <Textarea id="nps-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-[8px] font-pixel text-[12px] uppercase tracking-[1.5px] text-dim">
          How would you rate each part? 1 = bad, 5 = great (optional)
        </legend>
        <div className="flex flex-col gap-3">
          {AREAS.map((a) => (
            <div key={a.key} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="min-w-[250px] flex-1 text-sm">{a.label}</span>
              <div className="flex gap-[6px]" role="radiogroup" aria-label={a.label}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Choice
                    key={n}
                    name={`nps-${a.key}`}
                    value={n}
                    checked={ratings[a.key] === n}
                    onChange={() => setRatings((r) => ({ ...r, [a.key]: n }))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="nps-fix">If we could change one thing for our next program, what should it be? (optional)</Label>
        <Textarea id="nps-fix" rows={2} maxLength={500} value={fixText} onChange={(e) => setFixText(e.target.value)} />
      </div>

      {submit.error ? <Notice tone="bad">{submit.error}</Notice> : null}

      <div>
        <Button onClick={onSubmit} disabled={score === null || submit.pending}>
          {submit.pending ? "SENDING..." : "SEND FEEDBACK"}
        </Button>
      </div>
    </div>
  );
}
