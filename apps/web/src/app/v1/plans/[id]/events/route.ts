/** GET /v1/plans/{id}/events — live trace of the flow (decisions, components, checks): same stream as builds. */
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export { GET } from "../../../builds/[id]/events/route";
