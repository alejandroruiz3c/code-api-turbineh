import Link from "next/link";
import { switchOrganization } from "@/app/dashboard/account/organizations/actions";
import type { MyOrganization } from "@/server/organizations";

/**
 * The person's organizations in the dashboard menu: the active one is marked, any other is one click away (a server
 * action that checks membership before switching). Data shown afterwards is the selected organization's only.
 */
export function OrganizationSwitcher({
  organizations,
  activeId,
}: {
  organizations: MyOrganization[];
  activeId: string;
}) {
  return (
    <div className="mb-6" data-testid="organization-switcher">
      <p className="mb-1 text-xs font-medium uppercase text-muted">Organization</p>
      <ul className="flex flex-col gap-1 text-sm">
        {organizations.map((o) =>
          o.id === activeId ? (
            <li
              key={o.id}
              aria-current="true"
              className="rounded bg-subtle px-2 py-1 font-medium text-ink"
            >
              {o.name}
            </li>
          ) : (
            <li key={o.id}>
              <form action={switchOrganization}>
                <input type="hidden" name="organizationId" value={o.id} />
                <button
                  type="submit"
                  className="block w-full rounded px-2 py-1 text-left text-muted hover:bg-subtle"
                  aria-label={`Switch to ${o.name}`}
                >
                  {o.name}
                </button>
              </form>
            </li>
          ),
        )}
      </ul>
      <Link
        href="/dashboard/account/organizations/new"
        className="mt-1 block rounded px-2 py-1 text-xs text-accent hover:bg-subtle"
      >
        + New organization
      </Link>
    </div>
  );
}
