import { redirect } from "next/navigation";

// Only one form exists right now - redirect straight to it. Turn this into a
// real index once there's more than one form_key to choose from.
export default function FormIndexPage() {
  redirect("/form/review");
}
