import Link from 'next/link';
import Image from 'next/image';

import { SectionHeading } from '@/components/books/BookShelf';
import { formatDate } from '@/lib/cn';
import { BLOG_CATEGORY_LABEL } from '@/lib/constants';
import type { BlogListItem } from '@/server/content';

/**
 * Editorial teaser for the homepage.
 *
 * The blog exists for two reasons beyond content marketing: it earns organic
 * search traffic for long-tail queries ("books like Normal People"), and it
 * gives the homepage a reason to link inward to product pages with descriptive
 * anchors — which is exactly the internal-linking signal that lifts category
 * pages in search.
 */
export function ReadingRoomTeaser({ posts }: { posts: BlogListItem[] }) {
  if (posts.length === 0) return null;

  return (
    <section className="py-8 sm:py-10" aria-labelledby="reading-room-heading">
      <SectionHeading
        id="reading-room-heading"
        title="The reading room"
        subtitle="Reviews, reading guides and honest opinions"
        href="/blog"
        hrefLabel="All articles"
      />

      <ul className="mt-5 grid gap-5 sm:grid-cols-3">
        {posts.map((post) => (
          <li key={post.id}>
            <article className="group">
              <Link href={`/blog/${post.slug}`} className="block">
                <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-paper-sunken">
                  {post.coverImage ? (
                    <Image
                      src={post.coverImage}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 100vw, 33vw"
                      loading="lazy"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <svg className="h-8 w-8 text-ink-faint" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M4 5.5A1.5 1.5 0 015.5 4H10a2 2 0 012 2v13a1.5 1.5 0 00-1.5-1.5H5.5A1.5 1.5 0 014 16V5.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        <path d="M20 5.5A1.5 1.5 0 0018.5 4H14a2 2 0 00-2 2v13a1.5 1.5 0 011.5-1.5h5A1.5 1.5 0 0020 16V5.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>
              </Link>

              <p className="mt-3 text-2xs font-semibold uppercase tracking-[0.12em] text-accent">
                {BLOG_CATEGORY_LABEL[post.category] ?? post.category}
              </p>

              <h3 className="mt-1.5 clamp-2 font-display text-base font-semibold leading-snug">
                <Link href={`/blog/${post.slug}`} className="text-ink transition-colors hover:text-accent">
                  {post.title}
                </Link>
              </h3>

              <p className="mt-2 clamp-2 text-sm leading-relaxed text-ink-muted">{post.excerpt}</p>

              <p className="mt-2 text-2xs text-ink-faint">
                {post.authorName ? `${post.authorName} · ` : ''}
                {formatDate(post.publishedAt)} · {post.readingMinutes} min read
              </p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
