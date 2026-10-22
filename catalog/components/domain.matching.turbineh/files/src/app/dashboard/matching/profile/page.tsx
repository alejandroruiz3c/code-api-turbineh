import { ProfileForm } from "@/components/matching/forms";
import { Card } from "@/components/ui/card";
import { matchingConfig } from "@/matching/config";
import { mayEditProfile } from "@/matching/policy";
import { getProfile } from "@/matching/service";
import { requireMember } from "@/server/authz";

export const dynamic = "force-dynamic";

/** The active organization's matching profile: sectors, business activities, geographic coverage and interests. */
export default async function MatchingProfilePage() {
  const ctx = await requireMember();
  const profile = await getProfile(ctx);
  return (
    <Card title="Matching profile">
      <p className="mb-4 text-sm text-muted">
        What your organization does and where: {matchingConfig.entity.plural} are matched against
        these terms. Each organization has its own profile.
      </p>
      <ProfileForm
        profile={{
          sectors: profile.sectors,
          activities: profile.activities,
          regions: profile.regions,
          keywords: profile.keywords,
        }}
        canEdit={mayEditProfile(ctx.role)}
      />
    </Card>
  );
}
