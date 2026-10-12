import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TOOL_LABELS, TOOL_REGISTRY } from "@/server/tools";

/** Shared fields of the create and edit forms of an assistant. */
export function AgentFields({
  prefix,
  values,
}: {
  prefix: string;
  values?: { name: string; instructions: string; tools: string[]; useKnowledge: boolean };
}) {
  return (
    <>
      <div>
        <Label htmlFor={`${prefix}-name`}>Name</Label>
        <Input
          id={`${prefix}-name`}
          name="name"
          required
          maxLength={80}
          defaultValue={values?.name}
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-instructions`}>Instructions</Label>
        <textarea
          id={`${prefix}-instructions`}
          name="instructions"
          required
          minLength={10}
          maxLength={4000}
          rows={4}
          defaultValue={values?.instructions}
          className="w-full rounded-md border border-slate-300 p-2 text-sm"
        />
      </div>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1 font-medium">Tools</legend>
        {TOOL_REGISTRY.map((t) => (
          <label key={t.name} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="tools"
              value={t.name}
              defaultChecked={values?.tools.includes(t.name)}
            />
            {TOOL_LABELS[t.name] ?? t.name}
          </label>
        ))}
        <label className="mt-2 flex items-center gap-2">
          <input
            type="checkbox"
            name="useKnowledge"
            defaultChecked={values?.useKnowledge ?? true}
          />
          Answer from the knowledge base
        </label>
      </fieldset>
    </>
  );
}
