/**
 * Extra production worker on AWS (ADR-0024): read-only checks first, then (with the owner's approval) one EC2
 * instance that runs the same worker unit as Scaleway. Easy to switch off: stop or terminate it and Scaleway keeps
 * serving alone. Credentials come from .env.local and are never printed.
 *
 *   npx tsx infra/aws/worker.ts check     identity (must be the dedicated IAM user) and candidate instance types
 *
 * Prices: public on-demand list for eu-west-3 (the IAM user has EC2 permissions only, no pricing/quotas).
 */
import { DescribeInstanceTypesCommand, EC2Client, type _InstanceType } from "@aws-sdk/client-ec2";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { loadLocalEnv } from "@turbineh/shared";

loadLocalEnv();
const REGION = process.env.AWS_REGION ?? "eu-west-3";
/** Candidates: x86 (the sandbox images are amd64), ≥ 16 GB so two builds run at once with 3 GB sandboxes each. */
const CANDIDATES: _InstanceType[] = ["c7i.2xlarge", "m7i.2xlarge", "c7i.4xlarge", "m7i.4xlarge"];

async function check(): Promise<void> {
  const who = await new STSClient({ region: REGION }).send(new GetCallerIdentityCommand({}));
  const arn = who.Arn ?? "";
  console.log(
    `identity: account …${(who.Account ?? "").slice(-4)}, ${arn.includes(":root") ? "ROOT user (use an IAM user instead)" : arn.split(":").pop()}`,
  );

  const types = await new EC2Client({ region: REGION }).send(
    new DescribeInstanceTypesCommand({ InstanceTypes: CANDIDATES }),
  );
  for (const t of types.InstanceTypes ?? []) {
    console.log(
      `${t.InstanceType ?? ""}: ${t.VCpuInfo?.DefaultVCpus ?? "?"} vCPU, ${((t.MemoryInfo?.SizeInMiB ?? 0) / 1024).toFixed(0)} GB, ${(t.ProcessorInfo?.SupportedArchitectures ?? []).join("/")}`,
    );
  }
}

const steps: Record<string, () => Promise<void>> = { check };
const step = process.argv.slice(2).find((a) => a !== "--") ?? "check";
const fn = steps[step];
if (!fn) throw new Error(`unknown step ${step}`);
await fn();
