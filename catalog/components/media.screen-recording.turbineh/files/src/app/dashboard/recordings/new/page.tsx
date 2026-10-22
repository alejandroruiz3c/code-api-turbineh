import { recordingConfig, resolutionChoices } from "@/recordings/config";
import { requireMember } from "@/server/authz";
import { Recorder } from "./recorder";

export const dynamic = "force-dynamic";

/** Recorder (media.screen-recording.turbineh): screen + camera + microphone, layouts, resolution up to the app's maximum. */
export default async function NewRecordingPage() {
  await requireMember();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New recording</h1>
      <Recorder
        resolutions={resolutionChoices()}
        layouts={recordingConfig.layouts}
        frameRate={recordingConfig.frameRate}
        maxMinutes={recordingConfig.maxMinutes}
        maxBytes={recordingConfig.maxBytes}
      />
    </div>
  );
}
