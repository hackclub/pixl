"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/ui/primitives";
import { formatCountdown, timeLeft } from "../countdown";

// Players who are not on Slack never see the announcement, so the deadline
// lives on the page they actually use. `deadline` is an ISO string so it can
// cross the server/client boundary.
export function SubmissionCountdown({ deadline, label, className }: { deadline: string; label: string; className?: string }) {
  const end = new Date(deadline);
  // null until mounted: the server and first client render agree, then it ticks.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = now ? timeLeft(end, now) : null;
  if (now && !left) {
    return (
      <Notice tone="bad" className={className}>
        <strong>Submissions closed.</strong> The deadline was {label}. If a reviewer requested changes in the 24 hours
        before the deadline, you can resubmit once, up to 48 hours after the deadline. If they request changes after the
        deadline, you have 24 hours from that request. If it still doesn&apos;t meet the standards after your
        resubmit, it is permanently rejected.
      </Notice>
    );
  }
  return (
    <Notice className={className}>
      <strong>You can&apos;t submit projects after {label}.</strong>{" "}
      {left ? <>Time left: <span className="tabular-nums">{formatCountdown(left)}</span>. </> : null}
      Projects submitted in time are still reviewed. If changes are requested in the 24 hours before the deadline, you
      can resubmit once, up to 48 hours after it. If they are requested after the deadline, you have 24 hours from the
      request. If it still doesn&apos;t meet the standards after your resubmit, it is permanently rejected.
    </Notice>
  );
}
