import { Attachments } from "@/components/uploads/attachments";
import { Card } from "@/components/ui/card";
import { requireMember } from "@/server/authz";
import { sizeLabel, typesLabel, uploadConfig as cfg } from "@/uploads/config";

export const dynamic = "force-dynamic";

/** Private files of the workspace (storage.private-uploads.turbineh): upload, list and download what you may see. */
export default async function FilesPage() {
  const ctx = await requireMember();
  return (
    <div className="flex flex-col gap-6">
      <Card title="Files">
        <p className="mb-4 text-sm text-muted">
          {typesLabel()} up to {sizeLabel(cfg.maxBytes)}, stored privately. Downloads are checked
          against who may see each file.
        </p>
        <Attachments ctx={ctx} subjectType="workspace" back="/dashboard/files" />
      </Card>
    </div>
  );
}
