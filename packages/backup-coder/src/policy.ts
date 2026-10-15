/**
 * Deterministic limits on what the Backup Coder may deliver (ADR-0055). Never decided by a model: the checks are
 * plain patterns over the generated text, applied to every slot's output before it leaves the Backup Coder.
 */

export interface PolicyViolation {
  rule: "non-cryptographic-hash" | "placeholder-code";
  /** The text that matched (short), for logs and the delivery report. */
  match: string;
  why: string;
}

const HASH_RULES: RegExp[] = [
  // Java-style string hash: (h << 5) - h + c, h * 31 + c
  /\(\s*\w+\s*<<\s*5\s*\)\s*[-+]\s*\w+/,
  /\b\w+\s*\*\s*31\s*\+\s*\w+(?:\.charCodeAt|\[)/,
  // Math.imul based hashes (FNV-1a, murmur, cyrb53)
  /Math\.imul\s*\(/,
  // Named non-cryptographic hashes and their constants (djb2 5381, FNV offset/prime)
  /\b(?:djb2|sdbm|fnv-?1a?|murmur(?:hash)?\d*|cyrb53|crc32|adler-?32|hashCode)\b/i,
  /\b(?:0x811c9dc5|2166136261|16777619|0x01000193)\b/i,
  /\bhash\s*=\s*5381\b/,
  // Folding character codes with bit operations is a hand-made hash
  /charCodeAt\([^)]*\)[^;\n]{0,80}(?:<<|>>>|\|\s*0\b|&\s*0x[fF]{8}|\^)/,
  /(?:<<|>>>|\|\s*0\b|\^)[^;\n]{0,80}charCodeAt\(/,
  // Broken digests for identity
  /createHash\(\s*["'](?:md5|sha1|md4)["']\s*\)/i,
];

const PLACEHOLDER_RULES: RegExp[] = [
  /\bfor\s+(?:demo(?:nstration)?|illustration|illustrative|example)\s+purposes\b/i,
  /\bdemo\s+(?:only|implementation|version|code|logic|mode)\b/i,
  /\b(?:this\s+is|just)\s+a\s+(?:demo|placeholder|stub|mock)\b/i,
  /\bplaceholder\s+(?:implementation|logic|code|value|for|until)\b/i,
  /\bstub(?:bed)?\s+(?:implementation|for|out)\b/i,
  /\bdummy\s+(?:implementation|logic|value|hash|data)\b/i,
  /\bnot\s+(?:yet\s+)?implemented\b/i,
  /\bin\s+a\s+real\s+(?:app|application|implementation|system|world|project|deployment)\b/i,
  /\bin\s+production,?\s+(?:you\s+(?:would|should)|use|replace)\b/i,
  /\breplace\s+(?:this\s+)?with\s+a\s+real\b/i,
  /\bsimplified\s+(?:version|implementation|example|hash)\b/i,
];

/**
 * Violations in `code`. A match that already exists in `baseline` (the file a T4 correction rewrites, or contracts
 * the model was given) is not counted: the Backup Coder is judged on what it adds.
 */
export function checkBackupCode(code: string, baseline = ""): PolicyViolation[] {
  const out: PolicyViolation[] = [];
  const scan = (rules: RegExp[], rule: PolicyViolation["rule"], why: string) => {
    for (const re of rules) {
      const m = re.exec(code);
      if (!m) continue;
      if (baseline && baseline.includes(m[0])) continue;
      out.push({ rule, match: m[0].slice(0, 80), why });
    }
  };
  scan(
    HASH_RULES,
    "non-cryptographic-hash",
    'non-cryptographic hashes collide ("Aa" and "BB" share a 32-bit hash): identity and idempotency keys use ' +
      'node:crypto createHash("sha256") or randomUUID(), persisted with a unique constraint',
  );
  scan(
    PLACEHOLDER_RULES,
    "placeholder-code",
    "demo, placeholder or stub code is never delivered: the gap is reported as not covered instead",
  );
  return out;
}

/**
 * Capabilities whose guarantee needs persistence and a unique constraint (idempotency, deduplication, exactly-once).
 * A pure Backup Coder helper cannot provide that, so such a gap is reported as not covered, never generated.
 */
export const needsPersistence = (capability: string) =>
  /idempot|dedup|exactly-?once|unique-?key/i.test(capability);

export class BackupPolicyError extends Error {
  constructor(readonly violations: PolicyViolation[]) {
    super(
      `backup coder output refused by policy: ${violations
        .map((v) => `${v.rule} (${v.match})`)
        .join("; ")}`,
    );
    this.name = "BackupPolicyError";
  }
}
