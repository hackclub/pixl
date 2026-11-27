"use client";

import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/primitives";

/**
 * Return to wherever the visitor came from. A direct visit (or an external
 * referrer) falls back to the dashboard rather than the marketing homepage.
 */
export function QueueBackLink() {
  const router = useRouter();

  function goBack() {
    const referrer = document.referrer;
    try {
      if (referrer && new URL(referrer).origin === location.origin) {
        router.back();
        return;
      }
    } catch {
      // Malformed referrer: use the safe fallback.
    }
    router.push("/dashboard");
  }

  return (
    <button type="button" className={buttonVariants({ variant: "ghost" })} onClick={goBack}>
      ← BACK
    </button>
  );
}
