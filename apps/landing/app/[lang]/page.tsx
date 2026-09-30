import { notFound } from "next/navigation";
import { hasLocale } from "./dictionaries";
import { Menu } from "../_components/Menu";
import { LanguageSwitcher } from "../_components/LanguageSwitcher";
import { Hero } from "../_components/Hero";
import { WTFISTHIS } from "../_components/Description";
import { Story } from "../_components/Story";
import { MapPreview } from "../_components/MapPreview";
import { MainContent } from "../_components/MainContent";
import { FAQ } from "../_components/FAQ";
import { Footer } from "../_components/Footer";
import { ExampleSubmission } from "../_components/ExampleSubmission";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;

  if (!hasLocale(lang)) notFound();

  return (
    <div className="bg-[#F5EED2] min-h-screen text-black font-pixel overflow-x-clip">
      <Menu />
      <LanguageSwitcher />
      <Hero />
      <WTFISTHIS />
      <Story />
      <MapPreview />
      <MainContent />
      <FAQ />
      <Footer />
    </div>
  );
}
