# ADR-0048 · Recipe actor aliases from the role model

- Status: accepted (number may need renumbering at merge)
- Date: 2026-10-13
- Context: staging build f0788924 of the Frontiers shop spec was verified 11/11, yet 2 of its 8 criteria stayed open
  only because the compiler named the actor "administrator" while the storefront tests act as, and say, "owner":
  "Given an administrator is signed in, when they access the admin area, then they must be able to create or edit
  product details" and "… view the admin dashboard … a list of all completed orders". In the storefront the E2E owner
  _is_ the shop's administrator. Meanwhile ADR-0044's `actingAs` appended "acting as <owner label>" to every E2E proof,
  including tests that act as an anonymous visitor.

## Decision

1. **Recipes declare actor aliases** in `aliases.yaml › actors`, with the same mechanism as components' aliases
   (ADR-0047): `term` (the role the recipe's tests name), `means` (the words requests use for it) and `why` (the role
   model that makes it true). Declared only where the role model says so:
   - storefront, corporate-site, landing-waitlist: owner → administrator, admin, staff (+ shop/site owner). The E2E
     owner is a verified ADMIN_EMAILS staff member and those admin areas are `requireAdmin()` = staff.
   - client-portal: owner → staff (staff are owners and admins; "admin" is a separate workspace role there, so it
     is not an alias).
   - saas-crud and the others: none (owner, admin and member are distinct roles).
2. **The request's role matrix** (ADR-0044) adds the stored owner's (and admin's) label, e.g. owner → "manager". This
   replaces `actingAs`: the alias applies only to tests that name the role.
3. Both apply to the recipe's and the generated tests (owners.json: not component files), are written to
   `.turbineh/aliases.json` and re-applied at verification. Refusal and actor checks are unchanged: an alias never
   satisfies a refusal, and a criterion about "a member" or "a customer" is not the owner's.
4. The two staging criteria are proven by tests that assert them: the owner's CRUD test now checks it is the
   signed-in owner in the admin area, and the orders test checks the paid (completed) orders on the admin dashboard.

## Measurements

- The two staging criteria: open → proven (storefront, full E2E gate green).
- 109 labelled pairs: precision 1.00, recall 0.92 (also with the storefront actor aliases applied to the shop runs'
  pairs).
- `verify:spec` unchanged: Fieldnote 9/11, Kilnwise 1/6, Pixelyard 2/7 (covered).
