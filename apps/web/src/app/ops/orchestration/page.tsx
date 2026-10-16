import { redirect } from "next/navigation";

/** Short link: the Intelligence Orchestration tab of the owner report (ADR-0061). */
export default function OrchestrationReportRedirect() {
  redirect("/ops/report?view=orchestration");
}
