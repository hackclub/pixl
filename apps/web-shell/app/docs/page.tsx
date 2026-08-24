import { redirect } from "next/navigation";
import { getFirstSlug } from "@/lib/docs";

export default async function DocsIndexPage() {
  const first = await getFirstSlug();
  redirect(`/docs/${first}/`);
}
