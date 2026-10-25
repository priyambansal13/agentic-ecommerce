'use client';
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { ProductThumb } from './commerce.js';

/**
 * Product photos (client islands only for the onError fallback and the gallery/carousel state).
 * Images are plain <img> with fixed boxes (no layout shift), lazy-loaded, object-fit contain on white —
 * when an image is missing or fails, the category placeholder (ProductThumb) is shown instead.
 */

/**
 * An <img> that failed while the page was still server-rendered HTML fires `error` before React attaches
 * onError — check once after mount so such images still fall back.
 */
function useBrokenOnMount(ref: RefObject<HTMLImageElement | null>, onBroken: () => void, key?: unknown) {
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0) onBroken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function ProductImage({
  src,
  category,
  title,
  box = 160,
  className = '',
  eager = false,
}: {
  /** e.g. productImageUrl(productId, 'card') from @ac/contracts; null → placeholder */
  src: string | null | undefined;
  category: string;
  title: string;
  /** square box in px (CSS width/height); the image is contained inside */
  box?: number | 'fill';
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(!src);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => setFailed(!src), [src]);
  useBrokenOnMount(img, () => setFailed(true), src);
  const style = box === 'fill' ? undefined : { width: box, height: box };
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ${box === 'fill' ? 'aspect-square w-full' : ''} ${className}`}
      style={style}
    >
      {failed || !src ? (
        <ProductThumb category={category} title={title} size={box === 'fill' ? 120 : Math.round(box * 0.8)} />
      ) : (
        <img
          ref={img}
          src={src}
          alt={title}
          width={box === 'fill' ? 400 : box}
          height={box === 'fill' ? 400 : box}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      )}
    </span>
  );
}

export interface GalleryImage {
  thumb: string;
  full: string;
  alt: string;
  attribution?: { creator: string; license: string; licenseUrl: string | null; sourceUrl: string; title: string } | null;
}

/** Product page gallery: thumbnail rail + main image; arrow keys move between images. */
export function Gallery({ images, category, title }: { images: GalleryImage[]; category: string; title: string }) {
  const [i, setI] = useState(0);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const main = useRef<HTMLImageElement>(null);
  useBrokenOnMount(main, () => setFailed((f) => ({ ...f, [i]: true })), i);
  if (!images.length) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-[var(--radius)] bg-white">
        <ProductThumb category={category} title={title} size={220} />
      </div>
    );
  }
  const cur = images[Math.min(i, images.length - 1)];
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') (e.preventDefault(), setI((x) => (x + 1) % images.length));
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') (e.preventDefault(), setI((x) => (x - 1 + images.length) % images.length));
  };
  return (
    <figure>
      <div className="flex flex-col gap-3 sm:flex-row-reverse">
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[var(--radius)] bg-white p-4">
        {failed[i] ? (
          <ProductThumb category={category} title={title} size={220} />
        ) : (
          <img ref={main} src={cur.full} alt={cur.alt} width={1000} height={1000} decoding="async" className="h-full w-full object-contain" onError={() => setFailed((f) => ({ ...f, [i]: true }))} />
        )}
      </div>
      {images.length > 1 && (
        <div role="tablist" aria-label="Product images" aria-orientation="vertical" onKeyDown={onKey} className="flex gap-2 sm:flex-col">
          {images.map((im, k) => (
            <button
              key={im.thumb}
              type="button"
              role="tab"
              aria-selected={k === i}
              aria-label={`Image ${k + 1} of ${images.length}`}
              tabIndex={k === i ? 0 : -1}
              onClick={() => setI(k)}
              onMouseEnter={() => setI(k)}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-white p-0.5 ${k === i ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/40' : 'border-[var(--line)]'}`}
            >
              <img src={im.thumb} alt="" width={56} height={56} loading="lazy" decoding="async" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      )}
      </div>
      {cur.attribution && (
        <figcaption className="mt-2 text-[11px] text-[var(--muted)] sm:pl-16">
          <Credit a={cur.attribution} />
        </figcaption>
      )}
    </figure>
  );
}

/** "Photo: creator · CC BY 2.0 (source)" — required credit for stock photos. */
export function Credit({ a }: { a: NonNullable<GalleryImage['attribution']> }) {
  return (
    <>
      Photo: {a.creator} ·{' '}
      {a.licenseUrl ? (
        <a href={a.licenseUrl} className="underline" rel="noopener noreferrer license" target="_blank">
          {a.license}
        </a>
      ) : (
        a.license
      )}{' '}
      (
      <a href={a.sourceUrl} className="underline" rel="noopener noreferrer" target="_blank">
        source
      </a>
      )
    </>
  );
}

export interface Slide {
  image: string;
  title: string;
  text: string;
  href: string;
  cta: string;
}

/** Homepage hero: rotating category banners with previous/next and pause on hover/focus. */
export function HeroCarousel({ slides, interval = 6000 }: { slides: Slide[]; interval?: number }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.querySelectorAll<HTMLImageElement>('img[data-slide]').forEach((el) => {
      if (el.complete && el.naturalWidth === 0) setFailed((f) => ({ ...f, [Number(el.dataset.slide)]: true }));
    });
  }, []);
  useEffect(() => {
    if (paused || slides.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), interval);
    return () => clearInterval(t);
  }, [paused, slides.length, interval]);
  if (!slides.length) return null;
  const go = (d: number) => setI((x) => (x + d + slides.length) % slides.length);
  return (
    <section
      ref={root}
      aria-roledescription="carousel"
      aria-label="Featured departments"
      className="relative overflow-hidden rounded-[var(--radius)] bg-[var(--nav-2)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {slides.map((s, k) => (
        <div key={s.href} aria-hidden={k !== i} className={`${k === i ? 'relative' : 'absolute inset-0 opacity-0 pointer-events-none'} transition-opacity duration-500`}>
          <div className="relative h-[220px] sm:h-[300px]">
            {!failed[k] && (
              <img
                data-slide={k}
                src={s.image}
                alt=""
                width={1000}
                height={300}
                loading={k === 0 ? 'eager' : 'lazy'}
                decoding="async"
                onError={() => setFailed((f) => ({ ...f, [k]: true }))}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/40 to-transparent" />
            <div className="relative flex h-full max-w-[560px] flex-col justify-center gap-2 px-6 text-white sm:px-14">
              <h2 className="text-[24px] font-bold leading-tight sm:text-[32px]">{s.title}</h2>
              <p className="text-[14px] sm:text-[16px]">{s.text}</p>
              <a href={s.href} tabIndex={k === i ? 0 : -1} className="mt-2 inline-flex w-fit rounded-full bg-[var(--btn)] px-5 py-2 text-[14px] font-bold text-[#0f1111] hover:brightness-95">
                {s.cta}
              </a>
            </div>
          </div>
        </div>
      ))}
      {slides.length > 1 && (
        <>
          <CarouselButton label="Previous" onClick={() => go(-1)} side="left">
            ‹
          </CarouselButton>
          <CarouselButton label="Next" onClick={() => go(1)} side="right">
            ›
          </CarouselButton>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {slides.map((s, k) => (
              <button
                key={s.href}
                type="button"
                aria-label={`Show ${s.title}`}
                aria-current={k === i}
                onClick={() => setI(k)}
                className={`h-2 rounded-full transition-all ${k === i ? 'w-6 bg-white' : 'w-2 bg-white/55'}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CarouselButton({ label, onClick, side, children }: { label: string; onClick: () => void; side: 'left' | 'right'; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`absolute top-1/2 ${side === 'left' ? 'left-2' : 'right-2'} hidden h-12 w-9 -translate-y-1/2 items-center justify-center rounded-md bg-white/80 text-[28px] leading-none text-[#0f1111] hover:bg-white sm:flex`}
    >
      {children}
    </button>
  );
}

/** Amazon homepage card: title, one image (or 2×2 grid), link. */
export function CategoryCard({
  title,
  href,
  cta = 'Shop now',
  category,
  images,
}: {
  title: string;
  href: string;
  cta?: string;
  category: string;
  /** 1 image → large; 4 → 2×2 quad with labels */
  images: { src: string | null; label: string; href: string }[];
}) {
  return (
    <section className="flex flex-col rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4">
      <h3 className="mb-3 text-[19px] font-bold leading-snug">{title}</h3>
      {images.length >= 4 ? (
        <div className="grid flex-1 grid-cols-2 gap-3">
          {images.slice(0, 4).map((im) => (
            <a key={im.href + im.label} href={im.href} className="group block">
              <ProductImage src={im.src} category={category} title={im.label} box="fill" className="bg-[var(--surface-2)] group-hover:opacity-90" />
              <span className="mt-1 line-clamp-1 block text-[12px]">{im.label}</span>
            </a>
          ))}
        </div>
      ) : (
        <a href={images[0]?.href ?? href} className="group block flex-1">
          <ProductImage src={images[0]?.src} category={category} title={images[0]?.label ?? title} box="fill" className="group-hover:opacity-90" />
        </a>
      )}
      <a href={href} className="mt-3 text-[13px] text-[var(--link)] hover:underline">
        {cta}
      </a>
    </section>
  );
}
