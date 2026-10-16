import { redirect } from "next/navigation";

/** Short link: the per-person view of the owner report (ADR-0061). */
export default function UsersReportRedirect() {
  redirect("/ops/report?view=people");
}
