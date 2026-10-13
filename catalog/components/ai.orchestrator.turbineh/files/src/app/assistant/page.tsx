import { notFound } from "next/navigation";
import { AssistantWidget } from "@/components/assistant-widget";
import { publicAssistant } from "@/lib/ai/assistant";

/** Public assistant page (ADR-0033): available only when a toolkit is meant for the public. */
export default function AssistantPage() {
  const assistant = publicAssistant();
  if (!assistant.enabled) notFound();
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-12">
      <AssistantWidget title={assistant.title} greeting={assistant.greeting} />
    </main>
  );
}
