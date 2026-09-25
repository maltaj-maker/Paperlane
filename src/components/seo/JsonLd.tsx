import { serialiseJsonLd } from '@/lib/seo';

/**
 * Renders one or more JSON-LD blocks.
 *
 * `dangerouslySetInnerHTML` is required here — structured data must be literal
 * JSON, not escaped text. The safety comes from `serialiseJsonLd`, which
 * neutralises `<`, `>` and `&`, so a book title or review containing `</script>`
 * cannot break out of the tag.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Array<Record<string, unknown>> }) {
  const blocks = Array.isArray(data) ? data : [data];

  return (
    <>
      {blocks.filter(Boolean).map((block, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serialiseJsonLd(block) }}
        />
      ))}
    </>
  );
}
