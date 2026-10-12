import { redirect } from "next/navigation";

/** Old build links keep working: a build is now a flow. */
export default async function BuildPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const q = new URLSearchParams(
    Object.entries(await searchParams).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  ).toString();
  redirect(`/flows/${encodeURIComponent(id)}${q ? `?${q}` : ""}`);
}
