import { describe, expect, it } from "vitest";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
describe("s3 presigner contract", () => {
  it("creates a short-lived signed URL offline", async () => {
    const client = new S3Client({ region: "fr-par", endpoint: "https://s3.fr-par.scw.cloud", forcePathStyle: true, credentials: { accessKeyId: "AKID", secretAccessKey: "SECRET" } });
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: "b", Key: "doc.pdf" }), { expiresIn: 300 });
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=300");
  });
});
