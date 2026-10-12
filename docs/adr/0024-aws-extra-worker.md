# ADR-0024 · Extra production worker on AWS

- Status: accepted (owner approved the budget, 2026-10-12) · running: `turbineh-worker-prod-aws`, fixed IP 13.36.73.0
- Date: 2026-10-12
- Replaces the OVH plan (owner decision). Scaleway stays the primary worker; AWS adds capacity and removes the
  single-provider dependency.

## Decision

- Account access through a dedicated IAM user (`turbineh-ec2`, EC2 permissions only; no root keys). Keys live in
  `.env.local` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=eu-west-3`) and are never printed.
- Region `eu-west-3` (Paris), next to the Scaleway database (fr-par).
- Proposed instance `c7i.2xlarge` (8 vCPU, 16 GB, x86_64: the sandbox images are amd64), `WORKER_CONCURRENCY=2`,
  same systemd unit, same `/etc/turbineh/worker.env` as the Scaleway production worker (same queue, same database).
  On-demand list price [oficial]: 0.4242 USD/h (≈ 310 USD/month if always on). Stopped when idle, only the disk is
  billed.
- Easy to switch off: `stop`/`terminate` steps added to `infra/aws/worker.ts` together with `create` (step 2); the queue keeps working with Scaleway alone (workers
  claim builds with `FOR UPDATE SKIP LOCKED`, stale builds are re-queued after 15 minutes).
- Security: security group with SSH from the operator IP only, no inbound web ports (the worker only makes outbound
  calls), IMDSv2 required, encrypted root volume, no AWS credentials on the instance.

## Steps

1. `npx tsx infra/aws/worker.ts check` (read-only): identity and instance types. Done 2026-10-12.
2. After approval: create key pair, security group and instance; run `infra/staging/setup-host.sh`; deploy with
   `WORKER_HOST=<ip> infra/staging/deploy.sh production worker`.
3. Load test (two workers) and full benchmark for the G3 report.
