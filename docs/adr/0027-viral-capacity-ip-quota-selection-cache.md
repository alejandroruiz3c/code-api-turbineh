# ADR-0027 · Viral capacity: per-IP quota and selection cache

- Status: accepted (2026-10-12)
- Date: 2026-10-12
- Implements the two missing items of PLAN §9 "Capacidad viral" (the waitlist when the cost cap is reached and the
  pre-built sandbox base images already existed).

## Per-IP daily quota

- Browser sessions count builds per client network as well as per account (`IP_DAILY_BUILDS`, default 30/day), so
  many accounts from one place cannot drain the beta. API keys keep their own quota (servers share IPs).
- The IP comes from Vercel's edge headers (`x-vercel-forwarded-for`, then `x-real-ip`) and is **never stored**:
  `builds.client_ip_hash` holds HMAC-SHA256(server secret, "ip-quota:" + IP).

## Selection cache

- Key: SHA-256 of the normalized BuildSpec parts the decider sees (recipe, summary, acceptance criteria; case and
  spacing normalized) plus a hash of every candidate card. Any catalog change changes the key.
- Hit → the stored selection is reused without calling the decider (`decider.cached = true` in metrics); entries
  are valid for 7 days and purged after 30. Everything downstream (resolution, assembly, verification) runs as
  always, so a cached selection still has to pass the full verification.
- A version constant invalidates all entries when the selection questions or policy change.
