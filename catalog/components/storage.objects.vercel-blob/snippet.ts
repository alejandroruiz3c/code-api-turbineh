// Server code (route handler or server action). The SDK reads BLOB_READ_WRITE_TOKEN from the environment.
import { del, put } from "@vercel/blob";

export async function storeAvatar(userId: string, png: Buffer): Promise<string> {
  const blob = await put(`avatars/${userId}.png`, png, {
    access: "public",
    contentType: "image/png",
    addRandomSuffix: false,
  });
  return blob.url;
}

export async function removeAvatar(url: string): Promise<void> {
  await del(url);
}
