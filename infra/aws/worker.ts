/**
 * Extra production worker on AWS (ADR-0024): one EC2 instance that runs the same worker unit as Scaleway, against the
 * same queue and database. Easy to switch off: `stop` (only the disk and the reserved IP are billed) or `terminate`;
 * Scaleway keeps serving alone. Idempotent (resources matched by name tag). Credentials come from .env.local and are
 * never printed.
 *
 *   npx tsx infra/aws/worker.ts check       identity (dedicated IAM user) and candidate instance types (read-only)
 *   npx tsx infra/aws/worker.ts create      key pair, security group (SSH from this machine only), instance, fixed IP
 *   npx tsx infra/aws/worker.ts status|stop|start|terminate
 *
 * Prices: public on-demand list for eu-west-3 (the IAM user has EC2 permissions only, no pricing/quotas).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AllocateAddressCommand,
  AssociateAddressCommand,
  AuthorizeSecurityGroupIngressCommand,
  CreateSecurityGroupCommand,
  DescribeAddressesCommand,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  DescribeInstanceTypesCommand,
  DescribeKeyPairsCommand,
  DescribeSecurityGroupsCommand,
  EC2Client,
  ImportKeyPairCommand,
  ReleaseAddressCommand,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  waitUntilInstanceRunning,
  type _InstanceType,
  type Instance,
} from "@aws-sdk/client-ec2";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { loadLocalEnv } from "@turbineh/shared";

loadLocalEnv();
const REGION = process.env.AWS_REGION ?? "eu-west-3";
const NAME = "turbineh-worker-prod-aws";
const TYPE: _InstanceType = "c7i.2xlarge";
/** Candidates: x86 (the sandbox images are amd64), ≥ 16 GB so two builds run at once with 3 GB sandboxes each. */
const CANDIDATES: _InstanceType[] = ["c7i.2xlarge", "m7i.2xlarge", "c7i.4xlarge", "m7i.4xlarge"];
const ec2 = new EC2Client({ region: REGION });
const tag = (type: "instance" | "security-group" | "key-pair" | "elastic-ip" | "volume") => ({
  ResourceType: type,
  Tags: [
    { Key: "Name", Value: NAME },
    { Key: "project", Value: "code-api-turbineh" },
  ],
});

async function check(): Promise<void> {
  const who = await new STSClient({ region: REGION }).send(new GetCallerIdentityCommand({}));
  const arn = who.Arn ?? "";
  console.log(
    `identity: account …${(who.Account ?? "").slice(-4)}, ${arn.includes(":root") ? "ROOT user (use an IAM user instead)" : arn.split(":").pop()}`,
  );
  const types = await ec2.send(new DescribeInstanceTypesCommand({ InstanceTypes: CANDIDATES }));
  for (const t of types.InstanceTypes ?? []) {
    console.log(
      `${t.InstanceType ?? ""}: ${t.VCpuInfo?.DefaultVCpus ?? "?"} vCPU, ${((t.MemoryInfo?.SizeInMiB ?? 0) / 1024).toFixed(0)} GB, ${(t.ProcessorInfo?.SupportedArchitectures ?? []).join("/")}`,
    );
  }
}

async function findInstance(): Promise<Instance | undefined> {
  const r = await ec2.send(
    new DescribeInstancesCommand({
      Filters: [
        { Name: "tag:Name", Values: [NAME] },
        { Name: "instance-state-name", Values: ["pending", "running", "stopping", "stopped"] },
      ],
    }),
  );
  return r.Reservations?.flatMap((x) => x.Instances ?? [])[0];
}

async function keyPair(): Promise<string> {
  const name = NAME;
  const found = await ec2
    .send(new DescribeKeyPairsCommand({ KeyNames: [name] }))
    .then((r) => r.KeyPairs?.length ?? 0)
    .catch(() => 0);
  if (!found) {
    // Same operator key as the Scaleway workers (public half only).
    const pub = readFileSync(join(homedir(), ".ssh/id_ed25519_turbineh_staging.pub"));
    await ec2.send(
      new ImportKeyPairCommand({
        KeyName: name,
        PublicKeyMaterial: pub,
        TagSpecifications: [tag("key-pair")],
      }),
    );
    console.log("key pair imported");
  }
  return name;
}

async function securityGroup(): Promise<string> {
  const existing = await ec2.send(
    new DescribeSecurityGroupsCommand({ Filters: [{ Name: "group-name", Values: [NAME] }] }),
  );
  const sg = existing.SecurityGroups?.[0]?.GroupId;
  if (sg) return sg;
  const created = await ec2.send(
    new CreateSecurityGroupCommand({
      GroupName: NAME,
      Description: "TurbineH worker: SSH from the operator only; no inbound web ports",
      TagSpecifications: [tag("security-group")],
    }),
  );
  const ip = (await (await fetch("https://checkip.amazonaws.com")).text()).trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error("could not detect the operator IP");
  await ec2.send(
    new AuthorizeSecurityGroupIngressCommand({
      GroupId: created.GroupId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 22,
          ToPort: 22,
          IpRanges: [{ CidrIp: `${ip}/32`, Description: "operator" }],
        },
      ],
    }),
  );
  console.log("security group created (SSH from the operator IP only)");
  return created.GroupId ?? "";
}

async function create(): Promise<void> {
  const existing = await findInstance();
  if (existing) return console.log(`instance exists (${existing.State?.Name ?? "?"})`);
  const [key, sg] = [await keyPair(), await securityGroup()];
  const images = await ec2.send(
    new DescribeImagesCommand({
      Owners: ["099720109477"], // Canonical
      Filters: [
        { Name: "name", Values: ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"] },
        { Name: "state", Values: ["available"] },
      ],
    }),
  );
  const image = (images.Images ?? []).sort((a, b) =>
    (b.CreationDate ?? "").localeCompare(a.CreationDate ?? ""),
  )[0];
  if (!image?.ImageId) throw new Error("Ubuntu 24.04 image not found");
  const run = await ec2.send(
    new RunInstancesCommand({
      ImageId: image.ImageId,
      InstanceType: TYPE,
      MinCount: 1,
      MaxCount: 1,
      KeyName: key,
      SecurityGroupIds: [sg],
      // IMDSv2 only; no instance profile: the worker needs no AWS permissions.
      MetadataOptions: {
        HttpTokens: "required",
        HttpEndpoint: "enabled",
        HttpPutResponseHopLimit: 1,
      },
      BlockDeviceMappings: [
        {
          DeviceName: image.RootDeviceName ?? "/dev/sda1",
          Ebs: { VolumeSize: 100, VolumeType: "gp3", Encrypted: true, DeleteOnTermination: true },
        },
      ],
      TagSpecifications: [tag("instance"), tag("volume")],
    }),
  );
  const id = run.Instances?.[0]?.InstanceId ?? "";
  console.log(`instance ${id} (${TYPE}, ${image.Name ?? ""}) starting`);
  await waitUntilInstanceRunning({ client: ec2, maxWaitTime: 300 }, { InstanceIds: [id] });
  // Fixed public IP: the database allow-list and SSH config stay valid across stop/start.
  const eip = await ec2.send(
    new AllocateAddressCommand({ Domain: "vpc", TagSpecifications: [tag("elastic-ip")] }),
  );
  await ec2.send(new AssociateAddressCommand({ AllocationId: eip.AllocationId, InstanceId: id }));
  console.log(`running with fixed IP ${eip.PublicIp ?? "?"}`);
}

async function status(): Promise<void> {
  const i = await findInstance();
  if (!i) return console.log("no instance");
  console.log(
    `${i.InstanceId ?? ""} ${i.InstanceType ?? ""} ${i.State?.Name ?? ""} ip=${i.PublicIpAddress ?? "-"}`,
  );
}

async function act(kind: "stop" | "start" | "terminate"): Promise<void> {
  const i = await findInstance();
  if (!i?.InstanceId) return console.log("no instance");
  const ids = { InstanceIds: [i.InstanceId] };
  if (kind === "stop") await ec2.send(new StopInstancesCommand(ids));
  if (kind === "start") await ec2.send(new StartInstancesCommand(ids));
  if (kind === "terminate") {
    await ec2.send(new TerminateInstancesCommand(ids));
    const addrs = await ec2.send(
      new DescribeAddressesCommand({ Filters: [{ Name: "tag:Name", Values: [NAME] }] }),
    );
    for (const a of addrs.Addresses ?? []) {
      if (a.AssociationId) continue; // released on the next run once detached
      if (a.AllocationId)
        await ec2.send(new ReleaseAddressCommand({ AllocationId: a.AllocationId }));
    }
  }
  console.log(`${kind} requested for ${i.InstanceId}`);
}

const steps: Record<string, () => Promise<void>> = {
  check,
  create,
  status,
  stop: () => act("stop"),
  start: () => act("start"),
  terminate: () => act("terminate"),
};
const step = process.argv.slice(2).find((a) => a !== "--") ?? "check";
const fn = steps[step];
if (!fn) throw new Error(`unknown step ${step}`);
await fn();
