// Server code in the app (a server component or route): the five latest published posts, newest first, each with
// its author, tags and reading time (drafts are never returned).
import { listPublished } from "@/blog/posts";

export async function latestPosts() {
  const { posts } = await listPublished({ limit: 5 });
  return posts.map((p) => ({
    href: `/blog/${p.slug}`,
    title: p.title,
    minutes: p.readingMinutes,
    tags: p.tags.map((t) => t.name),
  }));
}
