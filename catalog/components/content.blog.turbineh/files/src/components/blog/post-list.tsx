import Link from "next/link";
import type { PostCard } from "@/blog/posts";

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "";

/** Post cards of the public blog: title, date, author, reading time, tags and summary. */
export function PostList({ posts }: { posts: PostCard[] }) {
  if (posts.length === 0) return <p className="text-muted">No articles yet.</p>;
  return (
    <ul className="flex flex-col gap-8">
      {posts.map((p) => (
        <li key={p.slug} data-testid="blog-post">
          <h2 className="text-2xl font-semibold">
            <Link href={`/blog/${p.slug}`} className="hover:underline">
              {p.title}
            </Link>
          </h2>
          <PostMeta post={p} />
          <p className="mt-2 text-muted">{p.excerpt}</p>
        </li>
      ))}
    </ul>
  );
}

/** Date · author · "N min read" · tags (links to the author and tag pages). */
export function PostMeta({ post }: { post: PostCard }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      <time dateTime={post.publishedAt?.toISOString()}>{day(post.publishedAt)}</time>
      {post.author ? (
        <>
          <span aria-hidden>·</span>
          <Link href={`/blog/author/${post.author.slug}`} className="hover:underline">
            {post.author.name}
          </Link>
        </>
      ) : null}
      <span aria-hidden>·</span>
      <span>{post.readingMinutes} min read</span>
      {post.tags.map((t) => (
        <Link
          key={t.slug}
          href={`/blog/tag/${t.slug}`}
          className="rounded-full bg-subtle px-2 py-0.5 text-xs text-ink hover:underline"
        >
          #{t.name}
        </Link>
      ))}
    </p>
  );
}

/** Newer / Older links; `base` keeps the current search. */
export function Pager({ page, pages, base }: { page: number; pages: number; base: string }) {
  const join = base.includes("?") ? "&" : "?";
  return (
    <nav aria-label="Pagination" className="mt-10 flex gap-4 text-sm">
      {page > 1 ? <Link href={`${base}${join}page=${page - 1}`}>Newer</Link> : null}
      {page < pages ? <Link href={`${base}${join}page=${page + 1}`}>Older</Link> : null}
      <span className="text-muted">
        Page {page} of {pages}
      </span>
    </nav>
  );
}
