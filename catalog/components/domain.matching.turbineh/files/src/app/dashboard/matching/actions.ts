"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { createRecord, saveProfile, setFeedback, updateRecord } from "@/matching/service";
import { toUserMessage } from "@/security/errors";
import { requireMember } from "@/server/authz";

export type MatchingFormState = { error: string | null; saved: boolean };

const fields = (form: FormData, names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, String(form.get(n) ?? "")]));

const message = (err: unknown): string =>
  err instanceof ZodError
    ? err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")
    : toUserMessage(err);

/** Saves the active organization's matching profile (sectors, activities, regions, interest keywords). */
export async function saveProfileAction(
  _prev: MatchingFormState,
  form: FormData,
): Promise<MatchingFormState> {
  const ctx = await requireMember();
  try {
    await saveProfile(ctx, fields(form, ["sectors", "activities", "regions", "keywords"]));
  } catch (err) {
    return { error: message(err), saved: false };
  }
  revalidatePath("/dashboard/matching");
  return { error: null, saved: true };
}

const RECORD_FIELDS = [
  "title",
  "description",
  "sector",
  "activity",
  "region",
  "deadline",
  "sourceUrl",
  "status",
] as const;

/** Adds a record (opportunity, tender…) to the active organization, then opens it. */
export async function createRecordAction(
  _prev: MatchingFormState,
  form: FormData,
): Promise<MatchingFormState> {
  const ctx = await requireMember();
  let id: string;
  try {
    id = (await createRecord(ctx, fields(form, RECORD_FIELDS))).id;
  } catch (err) {
    return { error: message(err), saved: false };
  }
  redirect(`/dashboard/matching/records/${id}`);
}

/** Edits a record of the active organization. */
export async function updateRecordAction(
  _prev: MatchingFormState,
  form: FormData,
): Promise<MatchingFormState> {
  const ctx = await requireMember();
  const id = String(form.get("id") ?? "");
  try {
    await updateRecord(ctx, id, fields(form, RECORD_FIELDS));
  } catch (err) {
    return { error: message(err), saved: false };
  }
  revalidatePath(`/dashboard/matching/records/${id}`);
  return { error: null, saved: true };
}

/** The organization's feedback on a record: relevant, not relevant (hidden from matches) or interested. */
export async function feedbackAction(form: FormData): Promise<void> {
  const ctx = await requireMember();
  const recordId = String(form.get("recordId") ?? "");
  await setFeedback(ctx, { recordId, verdict: String(form.get("verdict") ?? "") });
  revalidatePath(`/dashboard/matching/records/${recordId}`);
  revalidatePath("/dashboard/matching");
}
