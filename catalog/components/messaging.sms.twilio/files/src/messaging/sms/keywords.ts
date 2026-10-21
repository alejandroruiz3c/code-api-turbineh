/**
 * Reply keywords (component messaging.sms.twilio), as Twilio's default opt-out handling reads them: a reply whose whole
 * text is one of these words (any case, surrounding spaces and punctuation ignored). With Twilio Advanced Opt-Out the
 * webhook also carries OptOutType (STOP, START, HELP), which wins: custom keywords configured there are honoured too.
 */
export const OPT_OUT = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "OPTOUT",
  "REVOKE",
];
export const OPT_IN = ["START", "YES", "UNSTOP"];
export const HELP = ["HELP", "INFO"];

export type ReplyKind = "opt-out" | "opt-in" | "help" | "other";

export function replyKind(body: string | undefined, optOutType?: string | undefined): ReplyKind {
  const type = (optOutType ?? "").trim().toUpperCase();
  if (type === "STOP") return "opt-out";
  if (type === "START") return "opt-in";
  if (type === "HELP") return "help";
  const word = (body ?? "")
    .trim()
    .replace(/^[\s.!¡?¿,;:"'()]+|[\s.!¡?¿,;:"'()]+$/g, "")
    .toUpperCase();
  if (OPT_OUT.includes(word)) return "opt-out";
  if (OPT_IN.includes(word)) return "opt-in";
  if (HELP.includes(word)) return "help";
  return "other";
}
