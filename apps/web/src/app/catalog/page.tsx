import { redirect } from "next/navigation";

/** The catalog is now part of Discover (search by need across use cases and components). */
export default async function Catalog({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = (await searchParams).q;
  redirect(q ? `/discover?q=${encodeURIComponent(q)}` : "/discover");
}
