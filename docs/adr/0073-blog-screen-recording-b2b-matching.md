# ADR-0073 · New use cases from real demand: blog, screen + camera recording, B2B organizations and matching

- Status: accepted (number reserved for this change)
- Date: 2026-10-21
- Context: the production requests since 2026-10-13 (analysed offline, no customer data in this repository) asked for
  four things the library did not prove: a blog (rejected — its AI-as-a-topic false positive is ADR-0069), a
  Loom-like screen + camera recorder in 4K with layouts (built on the CRUD base with 0 of its criteria met), a
  multi-tenant B2B platform that monitors opportunities against each organization's profile (4 of 13 criteria), and a
  bare "client portal" (1 of 9). Owner rule (ADR-0052/0063): only functions a shipped test proves are covered.

## Decision

### 1 · Three native components (ADR-0033/0041 pattern, canonical criteria linked to tests, ADR-0063)

| Component                         | Provides                      | What its tests prove                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content.blog.turbineh`           | `content.blog`, `content.rss` | Markdown posts with an optional frontmatter block (title, author, tags, excerpt; parser written here, no dependency), drafts that stay private, publish / unpublish / delete, authors with bio pages, tag pages, keyword search, paginated list newest first, reading time, Article JSON-LD + OpenGraph, RSS 2.0, `/blog/sitemap.xml`; the editor is staff-only. Required by `corporate-site` (its native blog moved into the component); selectable on any recipe (landing-waitlist overlay adds it to the sitemap).                                                                        |
| `media.screen-recording.turbineh` | `media.screen-recording`      | `getDisplayMedia` + `getUserMedia` with `ideal` constraints up to the asked preset (2160p = 3840×2160 for "4K"), the delivered resolution read from `track.getSettings()` and shown; layouts composed on a canvas (camera bubble in any corner, side by side, screen only, camera only) switchable while recording; `MediaRecorder` (MP4 when supported, else WebM); upload sniffed (WebM/MP4 only) into the private storage driver; library, player with HTTP Range (206), share links (hashed token, revocable), workspace isolation. Requires `storage.private-uploads.turbineh`.         |
| `domain.matching.turbineh`        | `domain.matching`             | An organization profile (sectors, business activities, geographic coverage, interest keywords; configure role only), records (opportunities, tenders, grants… — the request's noun) with search and filters, a pure deterministic scorer (weights per dimension, accents and case folded, multi-word keywords, expired deadlines excluded, stable order) and a matches dashboard best first with the reasons of each match, feedback (not relevant leaves the matches), organization isolation on pages and on the JSON API (`/api/matching/*`, other organizations' ids answer 404). No AI. |

E2E suites run in the verification gate. Screen and camera are proved on Chromium's fake devices
(`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--auto-select-desktop-capture-source`),
which deliver the asked resolution: the criterion is "asks for up to 4K and records at the highest resolution the
device delivers" — 4K is never promised.

### 2 · Base SaaS and existing components

- `saas-crud`: an organization switcher in the dashboard (better-auth organizations, the active one set on the server),
  creating another organization, and an account page (profile, organizations with role, display name). Canonical
  `saas-crud.switch-organization` and `saas-crud.account-profile`, proved by `tests/e2e/organizations.spec.ts`.
- Security Pack: `Permissions-Policy` keeps camera, microphone and display capture denied by default; a component that
  records ships `src/security/permissions-sources.ts` turning them to `(self)` (opt-in, unit-tested both ways).
- Roles: requests for role-based access control or for assigning roles select `domain.membership-access` (the owner
  assigns and changes roles; the E2E checks the stored role after a reload). Its `membership.change-role`, the audit
  log's `audit.see-changes` and the portal's download (`client-portal.file-uploads`, the attachment's bytes asserted)
  absorb the words requests use for them.

### 3 · Selection, gate and measurement

- Patterns `blog`, `screen-recording`, `matching` (`packages/compiler/src/fidelity/use-case-patterns.ts`): code
  detects them and writes the params (resolution preset from "4K"/"1080p"…, frame rate, the matched noun, page size).
  Social publishing is never a blog; a weaving loom, a photo upload or a video gallery is never a recorder; a sales
  pipeline without a profile is never matching. Capabilities `media.screen-recording` and `domain.matching`; category
  `media`.
- The gate knows the domain components the request selects by code (`gateDomains` → `gateComponents`: the fidelity
  wiring, run before the gate with no model, plus the domain detectors of ADR-0069), so their canonical criteria are
  proof at the gate and in the canonical wording. A request no product family matched whose functions such
  components prove is gated as `components` on the closest template (ADR-0052's "every requirement maps to catalogue
  components"); nothing changes for a request no component selects.
- Entities a selected component implements (`params.entities`) get no generated CRUD canonicals, as at assembly.
- `COMPONENT_COMBINATIONS`: landing-waitlist + blog, saas-crud + private uploads + recording, saas-crud +
  membership-access + matching (synthetic requests), so CI's `verify:recipe --all --domains --quick` checks them.

## Consequences

- Offline replay of the target builds (stored compiled specs through main's and this branch's logic, no decision
  engine): blog 3/6 → 4/5 proven (list, tags, drafts/publish, search map to the blog component; "copy citation" stays
  open); recorder 0/3 refused → 3/3 covered, also when the compiler says `out_of_scope`; B2B 4/13 → 9/13 (organization
  switch, isolation, role assignment, profile, records, detail, feedback, audit log); client portal 1/9 → 3/7
  (sign-in/out, profile, file download; criteria that name one function merge into it).
- Still not covered (no test proves them, so they stay open): saved searches, email notification preferences, a
  platform-wide administrator across organizations, usage analytics, changing the account email, invoices, support
  forms and notification lists in the portal, citation copy, video trimming/editing, comments, transcripts, system
  audio, pause/resume.
- Videos pass through the app server (bounded by `maxBytes`); direct-to-bucket uploads are a follow-up.
