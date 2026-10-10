import { redirect } from "next/navigation";

/** Internal tools have no public landing: go straight to the dashboard (which requires sign-in). */
export default function Home() {
  redirect("/dashboard");
}
