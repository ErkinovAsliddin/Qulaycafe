import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';

/**
 * Stand-in for next/image: the design was exported from a Next.js project, and
 * this is a Vite build with no image server. It keeps the two props the call
 * sites rely on and turns them into plain HTML:
 *
 *   fill      — absolutely fill the (positioned, aspect-ratio'd) parent
 *   priority  — eager + high fetch priority, for the one image above the fold
 *
 * `sizes` stays meaningful because scripts/optimize-landing-images.mjs writes
 * three widths per photo and this builds the matching srcset, so a phone
 * fetches the 384/768 variant instead of the full-width one.
 */
const VARIANT_WIDTHS = [384, 768] as const;

function buildSrcSet(src: string): string | undefined {
  const match = /^(.*)\.webp$/.exec(src);
  if (!match) return undefined;
  const [, base] = match;
  return [
    ...VARIANT_WIDTHS.map(w => `${base}@${w}.webp ${w}w`),
    // The bare name is the widest variant the optimizer produced.
    `${src} 1536w`
  ].join(', ');
}

export function Img({
  src,
  alt,
  fill = false,
  priority = false,
  sizes,
  className,
  style
}: {
  src: string;
  alt: string;
  fill?: boolean;
  priority?: boolean;
  sizes?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <img
      src={src}
      srcSet={buildSrcSet(src)}
      sizes={sizes}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : undefined}
      draggable={false}
      className={cn(fill && 'absolute inset-0 size-full', className)}
      style={style}
    />
  );
}
