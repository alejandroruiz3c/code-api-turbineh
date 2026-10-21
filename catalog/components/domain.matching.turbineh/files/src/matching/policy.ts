import { allows } from "@/server/permissions";

/**
 * Who may do what in the matching component, from the app's role matrix (src/server/permissions.ts, the same one every
 * page and action uses): the profile is an organization setting ("configure"); records are added with "create" and
 * edited with "update"; anyone who may read gives feedback.
 */
export const mayEditProfile = (role: string): boolean => allows(role, "configure");
export const mayCreateRecords = (role: string): boolean => allows(role, "create");
export const mayEditRecords = (role: string): boolean => allows(role, "update");
export const mayGiveFeedback = (role: string): boolean => allows(role, "read");
