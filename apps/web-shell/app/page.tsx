import { redirect } from "next/navigation";
import { getFirstSlug } from "@/lib/docs";

export default async function DocsIndexPage() {
  const first = await getFirstSlug();
  // basePath ("/docs") is prepended automatically by redirect() - this
  // becomes external /docs/<slug>/, not /<slug>/.
  redirect(`/${first}/`);
}
