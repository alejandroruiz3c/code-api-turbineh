import { Card } from "@/components/ui/card";
import { entityNav } from "@/entities";
import { requireMember } from "@/server/authz";

export default async function Dashboard() {
  const { role } = await requireMember();
  return (
    <Card title="Dashboard">
      <p className="text-sm text-muted">
        Signed in as <span data-testid="role">{role}</span>. {entityNav.length} sections available.
      </p>
    </Card>
  );
}
