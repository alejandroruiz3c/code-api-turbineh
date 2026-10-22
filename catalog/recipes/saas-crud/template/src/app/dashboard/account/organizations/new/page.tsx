import { Card } from "@/components/ui/card";
import { requireSession } from "@/server/authz";
import { NewOrganizationForm } from "./form";

/** Create another organization (workspace): the signed-in person becomes its owner and switches to it. */
export default async function NewOrganization() {
  await requireSession();
  return (
    <Card title="New organization">
      <p className="mb-4 text-sm text-muted">
        Each organization keeps its own data, members and roles. You can switch between your
        organizations at any time from the menu.
      </p>
      <NewOrganizationForm />
    </Card>
  );
}
