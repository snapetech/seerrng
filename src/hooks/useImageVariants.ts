import type { ImageVariant } from '@app/utils/loadedImages';
import {
  loadedImages,
  requiredImageWidth,
  selectImageUpgrade,
} from '@app/utils/loadedImages';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

const subscribe = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
const NO_VARIANTS: readonly ImageVariant[] = [];

const matchesImageRequest = (image: HTMLImageElement, src: string) =>
  (image.currentSrc || image.src) ===
  new URL(src, image.ownerDocument.baseURI).href;

/** Preserve native lazy loading while progressively upgrading visible artwork. */
const useImageVariants = (
  baseSrc: string,
  variants: readonly ImageVariant[] = NO_VARIANTS,
  enabled = true
) => {
  // Hydration must start with the same base URL as SSR. A new client navigation
  // can reuse a loaded variant in its very first render.
  const isClient = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot
  );
  // Call sites can declare variants inline without restarting pending work.
  const candidateKey = JSON.stringify([
    { src: baseSrc, width: 0 },
    ...variants,
  ]);
  const candidates = useMemo<ImageVariant[]>(
    () => JSON.parse(candidateKey),
    [candidateKey]
  );
  const identity = `${enabled}:${candidateKey}`;
  const initialSrc = () =>
    (enabled && isClient && loadedImages.findLargest(candidates)?.src) ||
    baseSrc;
  const [selection, setSelection] = useState(() => ({
    identity,
    src: initialSrc(),
  }));
  // A changed artwork must never render the previous artwork, even for one
  // commit. The identity also isolates in-flight completions from old props.
  let activeSrc = selection.src;
  if (selection.identity !== identity) {
    activeSrc = initialSrc();
    setSelection({ identity, src: activeSrc });
  }
  const [element, setElement] = useState<HTMLImageElement | null>(null);
  const evaluateRef = useRef<(() => void) | undefined>(undefined);
  const onLoad = useCallback(
    (image: HTMLImageElement) => {
      // Next Image can assign img.src to itself, making its DOM attribute
      // absolute. Keep the declared resolved URL as the shared registry key.
      if (matchesImageRequest(image, activeSrc)) {
        loadedImages.record(activeSrc, image.naturalWidth, image.naturalHeight);
        evaluateRef.current?.();
      }
    },
    [activeSrc]
  );

  const onError = useCallback(
    (image: HTMLImageElement) => {
      if (!matchesImageRequest(image, activeSrc)) return;
      // Metadata outlives the browser's byte cache. A remembered variant can fail
      // when requested again; remove it before choosing a compatible fallback.
      loadedImages.markFailed(activeSrc);
      const fallback =
        loadedImages.findLargest(candidates)?.src ??
        (activeSrc !== baseSrc && !loadedImages.isCoolingDown(baseSrc)
          ? baseSrc
          : undefined);
      if (fallback) {
        setSelection((previous) =>
          previous.identity === identity && previous.src === activeSrc
            ? { identity, src: fallback }
            : previous
        );
      }
    },
    [activeSrc, baseSrc, candidates, identity]
  );

  useEffect(() => {
    if (!enabled || !isClient || !element) return;
    if (candidates.length === 1) {
      // Cards and single-source providers only register successful loads.
      if (element.complete && element.naturalWidth > 0) onLoad(element);
      return;
    }
    let disposed = false;
    const requests = new Set<string>();
    let mediaQuery: MediaQueryList | undefined;

    const evaluate = () => {
      if (disposed) return;
      const rect = element.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= window.innerHeight ||
        rect.left >= window.innerWidth
      ) {
        return;
      }
      const current =
        loadedImages.get(activeSrc) ??
        (element.complete && matchesImageRequest(element, activeSrc)
          ? loadedImages.record(
              activeSrc,
              element.naturalWidth,
              element.naturalHeight
            )
          : undefined);
      // Wait for the base to load. Native loading="lazy" controls offscreen
      // downloads; the thumbnail stays visible throughout upgrade decoding.
      if (!current) return;
      const requiredWidth = requiredImageWidth({
        width: element.clientWidth,
        height: element.clientHeight,
        naturalWidth: current.width,
        naturalHeight: current.height,
        devicePixelRatio: window.devicePixelRatio,
        objectFit: window.getComputedStyle(element).objectFit,
      });
      const cached = loadedImages.findLargest(candidates);
      if (cached && cached.width > current.width) {
        setSelection((previous) =>
          previous.identity === identity && previous.src === activeSrc
            ? { identity, src: cached.src }
            : previous
        );
        return;
      }
      const upgrade = selectImageUpgrade(
        candidates.filter(({ src }) => src !== activeSrc),
        current.width,
        requiredWidth
      );
      if (!upgrade || requests.has(upgrade.src)) return;
      requests.add(upgrade.src);
      void loadedImages.preload(upgrade.src).then((loaded) => {
        requests.delete(upgrade.src);
        if (disposed || !loaded || loaded.width <= current.width) return;
        setSelection((previous) => {
          if (previous.identity !== identity) return previous;
          const previousWidth = loadedImages.get(previous.src)?.width ?? 0;
          return loaded.width > previousWidth
            ? { identity, src: loaded.src }
            : previous;
        });
      });
    };
    evaluateRef.current = evaluate;
    const observeDpr = () => {
      mediaQuery?.removeEventListener('change', onDprChange);
      mediaQuery = window.matchMedia?.(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`
      );
      mediaQuery?.addEventListener('change', onDprChange);
    };
    const onDprChange = () => {
      observeDpr();
      evaluate();
    };
    const resizeObserver = window.ResizeObserver
      ? new window.ResizeObserver(evaluate)
      : undefined;
    resizeObserver?.observe(element);
    const intersectionObserver = window.IntersectionObserver
      ? new window.IntersectionObserver(evaluate)
      : undefined;
    intersectionObserver?.observe(element);
    window.addEventListener('resize', evaluate);
    if (!intersectionObserver) {
      window.addEventListener('scroll', evaluate, true);
    }
    observeDpr();
    if (element.complete && element.naturalWidth > 0) onLoad(element);
    else evaluate();

    return () => {
      disposed = true;
      evaluateRef.current = undefined;
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      mediaQuery?.removeEventListener('change', onDprChange);
      window.removeEventListener('resize', evaluate);
      window.removeEventListener('scroll', evaluate, true);
    };
  }, [activeSrc, candidates, element, enabled, identity, isClient, onLoad]);

  return { src: activeSrc, ref: setElement, onLoad, onError };
};

export default useImageVariants;
