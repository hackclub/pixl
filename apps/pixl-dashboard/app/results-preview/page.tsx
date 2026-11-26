import type { Metadata } from "next";
import { LandingPage } from "../_landing/LandingPage";
import { MockResults } from "./MockResults";

// TEMPORARY preview of the landing page in its post-deadline state. Delete
// this folder (and LandingPage's previewEnded prop) before shipping.
// ?lang=fr|es|pt|hi previews another locale.
export const metadata: Metadata = { title: "Results preview", robots: { index: false, follow: false } };

export default async function ResultsPreview({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const locale = (["fr", "es", "pt", "hi"] as const).find((l) => l === lang) ?? "en";
  return (
    <MockResults>
      <LandingPage locale={locale} previewEnded />
    </MockResults>
  );
}
