/** Variants must be explicitly declared to contain the same, uncropped artwork. */
export interface ImageVariant {
  src: string;
  width: number;
}

export interface LoadedImage {
  src: string;
  width: number;
  height: number;
  accessedAt: number;
}

const MAX_ENTRIES = 512;
const IDLE_EXPIRY_MS = 30 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 60 * 1000;
const LOAD_TIMEOUT_MS = 30 * 1000;

/** Metadata only: the browser owns the image bytes and their cache lifetime. */
export class LoadedImageRegistry {
  private entries = new Map<string, LoadedImage>();
  private pending = new Map<string, Promise<LoadedImage | undefined>>();
  private failedUntil = new Map<string, number>();

  constructor(private now: () => number = Date.now) {}

  private prune() {
    const now = this.now();
    for (const [src, entry] of this.entries) {
      if (now - entry.accessedAt >= IDLE_EXPIRY_MS) {
        this.entries.delete(src);
      }
    }
    for (const [src, until] of this.failedUntil) {
      if (until <= now) this.failedUntil.delete(src);
    }
  }

  get(src: string): LoadedImage | undefined {
    if (typeof window === 'undefined') return;
    this.prune();
    const entry = this.entries.get(src);
    if (!entry) return;
    entry.accessedAt = this.now();
    this.entries.delete(src);
    this.entries.set(src, entry);
    return entry;
  }

  record(src: string, width: number, height: number): LoadedImage | undefined {
    if (
      typeof window === 'undefined' ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return;
    }
    this.prune();
    const entry = { src, width, height, accessedAt: this.now() };
    this.entries.delete(src);
    this.entries.set(src, entry);
    this.failedUntil.delete(src);
    while (this.entries.size > MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
    return entry;
  }

  isCoolingDown(src: string): boolean {
    return (
      typeof window !== 'undefined' &&
      (this.failedUntil.get(src) ?? 0) > this.now()
    );
  }

  markFailed(src: string) {
    if (typeof window === 'undefined') return;
    this.entries.delete(src);
    this.failedUntil.set(src, this.now() + FAILURE_COOLDOWN_MS);
    while (this.failedUntil.size > MAX_ENTRIES) {
      this.failedUntil.delete(this.failedUntil.keys().next().value as string);
    }
  }

  /** Only the supplied URLs are compatible; query parameters remain significant. */
  findLargest(variants: readonly ImageVariant[]): LoadedImage | undefined {
    if (typeof window === 'undefined') return;
    this.prune();
    let largest: LoadedImage | undefined;
    for (const { src } of variants) {
      const entry = this.entries.get(src);
      if (entry && (!largest || entry.width > largest.width)) largest = entry;
    }
    return largest ? this.get(largest.src) : undefined;
  }

  /** Share upgrade work until load and decode complete, including across views. */
  preload(src: string): Promise<LoadedImage | undefined> {
    if (typeof window === 'undefined') return Promise.resolve(undefined);
    const loaded = this.get(src);
    if (loaded) return Promise.resolve(loaded);
    const pending = this.pending.get(src);
    if (pending) return pending;
    if (this.isCoolingDown(src)) {
      return Promise.resolve(undefined);
    }

    const image = new window.Image();
    const promise = new Promise<LoadedImage | undefined>((resolve) => {
      let settled = false;
      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        const entry = success
          ? this.record(src, image.naturalWidth, image.naturalHeight)
          : undefined;
        if (!entry) this.markFailed(src);
        resolve(entry);
      };
      const timeout = window.setTimeout(() => finish(false), LOAD_TIMEOUT_MS);
      image.decoding = 'async';
      image.onload = async () => {
        try {
          if (image.decode) await image.decode();
          finish(true);
        } catch {
          finish(false);
        }
      };
      image.onerror = () => finish(false);
      image.src = src;
    });
    this.pending.set(src, promise);
    void promise.then(() => this.pending.delete(src));
    return promise;
  }
}

export const loadedImages = new LoadedImageRegistry();

/** Account for both axes when object-fit: cover crops the rendered image. */
export const requiredImageWidth = ({
  width,
  height,
  naturalWidth,
  naturalHeight,
  devicePixelRatio,
  objectFit,
}: {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  devicePixelRatio: number;
  objectFit: string;
}): number => {
  const ratio = naturalHeight > 0 ? naturalWidth / naturalHeight : 0;
  const heightWidth = height * ratio;
  const renderedWidth =
    objectFit === 'cover'
      ? Math.max(width, heightWidth)
      : objectFit === 'contain' && heightWidth > 0
        ? Math.min(width, heightWidth)
        : width;
  return renderedWidth * Math.max(1, devicePixelRatio || 1);
};

export const selectImageUpgrade = (
  variants: readonly ImageVariant[],
  currentWidth: number,
  requiredWidth: number
): ImageVariant | undefined => {
  if (currentWidth >= requiredWidth) return;
  const larger = variants
    .filter(
      ({ width }) => Number.isFinite(width) && width > currentWidth && width > 0
    )
    .sort((a, b) => a.width - b.width);
  return (
    larger.find(({ width }) => width >= requiredWidth) ??
    larger[larger.length - 1]
  );
};
