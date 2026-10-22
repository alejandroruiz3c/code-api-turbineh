import Link from "next/link";
import { Card } from "@/components/ui/card";
import { capitalize, matchingConfig } from "@/matching/config";
import { reasonText } from "@/matching/score";
import { getProfile, matchesFor } from "@/matching/service";
import { requireMember } from "@/server/authz";

export const dynamic = "force-dynamic";

/** Matches: the active organization's open records that fit its profile, best first, with why each one matches. */
export default async function MatchesPage() {
  const ctx = await requireMember();
  const [profile, matches] = await Promise.all([getProfile(ctx), matchesFor(ctx)]);
  const { singular, plural } = matchingConfig.entity;
  const empty =
    profile.sectors.length +
      profile.activities.length +
      profile.regions.length +
      profile.keywords.length ===
    0;
  return (
    <Card title={`Matching ${plural}`}>
      <p className="mb-4 text-sm text-muted">
        Open {plural} that match your organization&apos;s profile (sectors, activities, regions and
        interest keywords), best first. Scores are computed by fixed rules: each profile term found
        adds its weight.{" "}
        <Link href="/dashboard/matching/profile" className="text-accent underline">
          Edit the profile
        </Link>{" "}
        ·{" "}
        <Link href="/dashboard/matching/records" className="text-accent underline">
          All {plural}
        </Link>
      </p>
      {empty ? (
        <p className="text-sm text-muted" data-testid="no-profile">
          Your organization has no matching profile yet: add sectors, activities, regions or
          keywords to see matching {plural}.
        </p>
      ) : null}
      <p className="mb-2 text-sm" data-testid="match-total">
        {matches.length} matching {matches.length === 1 ? singular : plural}
      </p>
      <ol className="flex flex-col gap-3">
        {matches.map((m) => (
          <li
            key={m.record.id}
            data-testid="match-row"
            className="rounded-md border border-line bg-surface p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                href={`/dashboard/matching/records/${m.record.id}`}
                className="font-medium text-accent"
              >
                {m.record.title}
              </Link>
              <span className="text-sm" data-testid="match-score">
                Score {m.score}
              </span>
            </div>
            <p className="text-xs text-muted">
              {[
                m.record.sector,
                m.record.region,
                m.record.deadline ? `deadline ${m.record.deadline}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-1 text-sm" data-testid="match-why">
              Why: {m.reasons.map(reasonText).join(", ")}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted">
        {capitalize(plural)} marked “not relevant” are not shown.
      </p>
    </Card>
  );
}
