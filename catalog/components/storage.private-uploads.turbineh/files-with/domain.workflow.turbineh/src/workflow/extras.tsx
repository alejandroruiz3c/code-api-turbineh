import { Card } from "@/components/ui/card";
import { Attachments } from "@/components/uploads/attachments";
import type { Workflow } from "./config";
import type { Actor, Item } from "./service";

/**
 * Extra sections of a workflow record's page, from storage.private-uploads.turbineh: the record's private files.
 * They inherit the record's scope (src/uploads/subjects.ts), so only people who see the record can download them.
 */
export async function ItemExtras({ ctx, wf, item }: { ctx: Actor; wf: Workflow; item: Item }) {
  return (
    <Card title="Files">
      <Attachments
        ctx={ctx}
        subjectType={`workflow:${wf.key}`}
        subjectId={item.id}
        back={`/dashboard/workflow/${wf.key}/${item.id}`}
      />
    </Card>
  );
}
