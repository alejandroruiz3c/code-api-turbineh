import Link from "next/link";
import { notFound } from "next/navigation";
import { feedbackAction } from "@/app/dashboard/matching/actions";
import { RecordForm } from "@/components/matching/forms";
import { Card } from "@/components/ui/card";
import { capitalize, FEEDBACK, FEEDBACK_LABEL, matchingConfig } from "@/matching/config";
import { mayEditRecords } from "@/matching/policy";
import { reasonText, scoreRecord } from "@/matching/score";
import { feedbackOf, getProfile, getRecord } from "@/matching/service";
import { requireMember } from "@/server/authz";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** One record of the active organization: description, source, why it matches the profile, feedback and edit form. */
export default async function RecordPage({ params }: Props) {
  const ctx = await requireMember();
  const { id } = await params;
  const record = await getRecord(ctx, id);
  if (!record) notFound();
  const [profile, feedback] = await Promise.all([getProfile(ctx), feedbackOf(ctx, [record.id])]);
  const { score, reasons } = scoreRecord(profile, record, matchingConfig.weights);
  const verdict = feedback.get(record.id) ?? null;
  const { singular, plural } = matchingConfig.entity;
  return (
    <div className="flex flex-col gap-6">
      <Card title={record.title}>
        <p className="mb-2 text-sm">
          <Link href="/dashboard/matching/records" className="text-accent underline">
            All {plural}
          </Link>
        </p>
        <dl className="mb-4 grid grid-cols-[8rem_1fr] gap-2 text-sm">
          <dt className="text-muted">Sector</dt>
          <dd>{record.sector ?? "—"}</dd>
          <dt className="text-muted">Activity</dt>
          <dd>{record.activity ?? "—"}</dd>
          <dt className="text-muted">Region</dt>
          <dd>{record.region ?? "—"}</dd>
          <dt className="text-muted">Deadline</dt>
          <dd>{record.deadline ?? "—"}</dd>
          <dt className="text-muted">Status</dt>
          <dd data-testid="record-status">{record.status}</dd>
          <dt className="text-muted">Source</dt>
          <dd>
            {record.sourceUrl ? (
              <a
                href={record.sourceUrl}
                rel="noopener noreferrer nofollow"
                target="_blank"
                className="text-accent underline"
                data-testid="record-source"
              >
                {record.sourceUrl}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </dl>
        <p className="whitespace-pre-wrap text-sm" data-testid="record-description">
          {record.description}
        </p>
        <p className="mt-4 text-sm" data-testid="record-why">
          {reasons.length > 0
            ? `Score ${score} — why: ${reasons.map(reasonText).join(", ")}`
            : `No term of your organization's profile appears in this ${singular}.`}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Feedback">
          <span className="text-sm text-muted">Your organization&apos;s feedback:</span>
          {FEEDBACK.map((v) => (
            <form key={v} action={feedbackAction}>
              <input type="hidden" name="recordId" value={record.id} />
              <input type="hidden" name="verdict" value={v} />
              <button
                type="submit"
                aria-pressed={verdict === v}
                className={`rounded-md border px-3 py-1 text-sm ${verdict === v ? "border-brand bg-brand text-brand-contrast" : "border-line"}`}
              >
                {FEEDBACK_LABEL[v]}
              </button>
            </form>
          ))}
        </div>
      </Card>
      {mayEditRecords(ctx.role) ? (
        <Card title={`Edit ${singular}`}>
          <RecordForm singular={singular} record={record} />
        </Card>
      ) : null}
      <p className="text-xs text-muted">
        {capitalize(singular)} id: {record.id}
      </p>
    </div>
  );
}
