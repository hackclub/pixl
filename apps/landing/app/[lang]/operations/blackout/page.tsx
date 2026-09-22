import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlackoutBriefing } from "../../../_components/BlackoutBriefing";
import { getDictionary, hasLocale } from "../../dictionaries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: `${dict.operationBriefing.title} | Pixl`, robots: { index: false } };
}

export default async function BlackoutBriefingPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <BlackoutBriefing />;
}
