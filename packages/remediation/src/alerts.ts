import type { VerifyResult } from "@turbineh/verifier";

/** A user-facing security alert that did not block delivery (explained in plain language). */
export interface SecurityAlert {
  id: string;
  level: "warning" | "info";
  title: string;
  explain: string;
  where: string;
}

/**
 * Alerts left after verification (non-blocking by policy). Blocking findings never reach delivery: a build with
 * blocking findings fails after remediation instead of being delivered.
 */
export function alertsOf(v: VerifyResult): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];
  for (const f of v.findings.static.filter((x) => x.severity === "WARNING")) {
    alerts.push({
      id: f.rule,
      level: "warning",
      title: f.message,
      explain: f.explain,
      where: `${f.path}:${f.line}`,
    });
  }
  for (const a of v.findings.advisories) {
    const prod = a.scope === "production";
    alerts.push({
      id: a.id,
      level: prod ? "warning" : "info",
      title: `${a.severity.toLowerCase()} advisory in ${a.pkg}`,
      explain: prod
        ? "A known vulnerability affects a library your app ships. It is not rated high or critical, but updating it is recommended."
        : "A known vulnerability affects a development-only tool (used to build or test the app). It is not shipped to your users and is not reachable at runtime.",
      where: a.pkg,
    });
  }
  return alerts;
}
