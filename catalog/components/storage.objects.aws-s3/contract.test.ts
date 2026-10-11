import { describe, expect, it } from "vitest";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
describe("aws s3 client contract", () => {
  it("builds S3-compatible commands without network access", async () => {
    const client = new S3Client({ region: "fr-par", endpoint: "https://s3.fr-par.scw.cloud", credentials: { accessKeyId: "x", secretAccessKey: "y" } });
    const cmd = new PutObjectCommand({ Bucket: "b", Key: "k.txt", Body: "hi", ContentType: "text/plain" });
    expect(cmd.input.Key).toBe("k.txt");
    expect(await client.config.region()).toBe("fr-par");
    client.destroy();
  });
});
