import type { EnvironmentInput } from "@turbineh/shared";

/** "app" = a new, complete app in a declared stack (the default, ADR-0050); "repo" / "upload" = an existing project. */
export type EnvMode = "app" | "repo" | "upload";

/** The only stack new apps are built on (every recipe template). */
export const SUPPORTED_STACK = "TypeScript + Next.js + PostgreSQL + Drizzle";

/** What a new app in the chosen stack gives, before planning (the plan repeats it with one-click choices). */
export function stackNote(language: string, framework: string): string {
  if (framework === "Next.js")
    return `Supported stack: ${SUPPORTED_STACK}. You get a new, complete Next.js project: screens, server code, PostgreSQL database with Drizzle, sign-in and tests, verified in our sandbox and ready to run or deploy.${language === "TypeScript" ? "" : " The project is written in TypeScript."}`;
  if (language === "TypeScript" || language === "JavaScript")
    return `${framework} is not supported for new apps (supported: ${SUPPORTED_STACK}). With ${framework} you get a complete Next.js app whose server code (data, validation, rules) you can import into ${framework}; its screens are not converted to ${framework}. The plan offers a complete Next.js app in one click.`;
  return `${language} is not supported for new apps (supported: ${SUPPORTED_STACK}), so nothing is written in ${language}. You get a complete Next.js app that runs next to your ${language} code as its own service. The plan offers it in one click.`;
}

/** Environment sent to POST /v1/plans for each choice. */
export function environmentFor(
  mode: EnvMode,
  input: {
    repo: string;
    files: Record<string, string>;
    language: string;
    framework: string;
    versions: string;
  },
): EnvironmentInput {
  if (mode === "repo") {
    const [owner, name] = input.repo.trim().split("/");
    return owner && name ? { repo: { provider: "github", fullName: `${owner}/${name}` } } : {};
  }
  if (mode === "upload") return { files: input.files };
  const v = Object.fromEntries(
    input.versions
      .split(",")
      .map((p) => p.trim().split(/\s+/))
      .filter((p) => p.length === 2 && p[0] && p[1])
      .map((p) => [p[0] as string, p[1] as string]),
  );
  return { stack: { language: input.language, framework: input.framework, versions: v } };
}
