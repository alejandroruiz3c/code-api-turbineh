import type { Workflow } from "./config";
import type { Actor, Item } from "./service";

/**
 * Extra sections of a workflow record's page (component domain.workflow.turbineh): nothing by default. Components
 * replace this file when they are in the app too — storage.private-uploads.turbineh adds the record's files — and
 * apps add their own sections here (comments, linked records) instead of editing the page.
 */
export async function ItemExtras(props: { ctx: Actor; wf: Workflow; item: Item }) {
  void props;
  return null;
}
