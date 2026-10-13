import Link from "next/link";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/server/authz";
import { collections } from "@/site-pages/config";

/** Public pages for staff (site.public-pages.turbineh): one editor per collection of the site. */
export default async function SitePagesAdmin() {
  await requireAdmin();
  return (
    <Card title="Public pages">
      <ul className="flex flex-col gap-2 text-sm">
        {collections.map((c) => (
          <li key={c.key}>
            <Link
              href={`/dashboard/site-pages/${c.key}`}
              className="font-medium text-accent underline"
            >
              {c.plural}
            </Link>{" "}
            <span className="text-muted">— public at {c.path}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
