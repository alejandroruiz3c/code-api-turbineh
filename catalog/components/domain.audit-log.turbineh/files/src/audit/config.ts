import { z } from "zod";
import params from "./params.json";

/**
 * Audit log parameters (component domain.audit-log.turbineh), written by TurbineH from the request: page size, fields
 * whose values are never stored (passwords, tokens…), fields that are not worth recording and the CSV export bound.
 * Validated at start-up.
 */
export const AuditParams = z.object({
  pageSize: z.number().int().min(10).max(200),
  redactFields: z.array(z.string().min(1).max(60)).max(40),
  ignoreFields: z.array(z.string().min(1).max(60)).max(40),
  exportLimit: z.number().int().min(100).max(50_000),
});
export type AuditConfig = z.infer<typeof AuditParams>;

export const auditConfig: AuditConfig = AuditParams.parse(params);
