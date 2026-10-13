import { Button } from "@/components/ui/button";
import { can } from "@/server/authz";
import { scopeOptions, SCOPE_LABEL } from "@/server/record-access";
import { FILE_TYPES, sizeLabel, typesLabel, uploadConfig as cfg } from "@/uploads/config";
import { listUploads, type Actor } from "@/uploads/service";
import { removeFile } from "@/app/dashboard/files/actions";
import { UploadForm } from "./upload-form";

/**
 * Files of one record, or the workspace's loose files (component storage.private-uploads.turbineh): the list this
 * person may see, download links through the authorised route and an upload form. Embed it in any record page:
 * `<Attachments ctx={ctx} subjectType="workflow:request" subjectId={item.id} back={path} />`.
 */
export async function Attachments({
  ctx,
  subjectType,
  subjectId = null,
  back,
}: {
  ctx: Actor;
  subjectType: string;
  subjectId?: string | null;
  back: string;
}) {
  const [files, scopes] = await Promise.all([
    listUploads(ctx, { subjectType, subjectId }),
    subjectType === "workspace" ? scopeOptions(ctx) : Promise.resolve([]),
  ]);
  const accept = cfg.types.map((t) => `.${t},${FILE_TYPES[t].mime}`).join(",");
  return (
    <div className="flex flex-col gap-4">
      {files.length ? (
        <ul className="flex flex-col gap-2 text-sm" data-testid="files">
          {files.map((f) => (
            <li
              key={f.id}
              data-testid="file-row"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2"
            >
              <span>
                <a
                  className="font-medium text-accent underline"
                  href={`/dashboard/files/${f.id}/download`}
                >
                  {f.fileName}
                </a>{" "}
                <span className="text-muted">
                  {sizeLabel(f.size)} · {f.uploadedByEmail ?? "member"} ·{" "}
                  {f.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
              </span>
              {f.uploadedBy === ctx.userId || can(ctx.role, "delete") ? (
                <form action={removeFile}>
                  <input type="hidden" name="id" value={f.id} />
                  <input type="hidden" name="back" value={back} />
                  <Button type="submit" className="bg-subtle px-2 py-1 text-xs text-ink">
                    Remove
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No files yet.</p>
      )}
      {can(ctx.role, "create") ? (
        <UploadForm
          subjectType={subjectType}
          subjectId={subjectId}
          back={back}
          accept={accept}
          hint={`${typesLabel()} up to ${sizeLabel(cfg.maxBytes)}. Files are private: only people who can see this ${subjectType === "workspace" ? "workspace or scope" : "record"} can download them.`}
          scopes={scopes}
          scopeLabel={SCOPE_LABEL}
        />
      ) : null}
    </div>
  );
}
