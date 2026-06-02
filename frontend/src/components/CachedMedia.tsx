import {
  forwardRef,
  useEffect,
  useState,
  type ImgHTMLAttributes,
  type VideoHTMLAttributes,
} from "react";

import {
  normalizeMediaSource,
  resolveNativeCachedUrl,
  type NativeCacheOptions,
} from "../js/nativeMediaCache";

type CachedImageProps = ImgHTMLAttributes<HTMLImageElement> & NativeCacheOptions;
type CachedVideoProps = VideoHTMLAttributes<HTMLVideoElement> & NativeCacheOptions;

function useCachedMediaSource(
  src?: string | null,
  cacheKey?: string,
  refreshKey?: string | number | boolean | null,
  resolveRelativeToApi?: boolean,
  staleWhileRevalidate?: boolean,
) {
  const normalizedSource = normalizeMediaSource(src, { resolveRelativeToApi });
  const [resolvedSource, setResolvedSource] = useState(normalizedSource);

  useEffect(() => {
    let cancelled = false;
    setResolvedSource(normalizedSource);

    if (!normalizedSource) {
      return () => {
        cancelled = true;
      };
    }

    void resolveNativeCachedUrl(normalizedSource, {
      cacheKey,
      refreshKey,
      resolveRelativeToApi,
      staleWhileRevalidate,
    }).then((nextSource) => {
      if (!cancelled) {
        setResolvedSource(nextSource);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, normalizedSource, refreshKey, resolveRelativeToApi, staleWhileRevalidate]);

  return resolvedSource;
}

export const CachedImage = forwardRef<HTMLImageElement, CachedImageProps>(function CachedImage(
  {
    src,
    cacheKey,
    refreshKey,
    resolveRelativeToApi,
    staleWhileRevalidate,
    ...props
  },
  ref,
) {
  const resolvedSource = useCachedMediaSource(src, cacheKey, refreshKey, resolveRelativeToApi, staleWhileRevalidate);
  return <img ref={ref} src={resolvedSource || undefined} {...props} />;
});

export const CachedVideo = forwardRef<HTMLVideoElement, CachedVideoProps>(function CachedVideo(
  {
    src,
    cacheKey,
    refreshKey,
    resolveRelativeToApi,
    staleWhileRevalidate,
    ...props
  },
  ref,
) {
  const resolvedSource = useCachedMediaSource(src, cacheKey, refreshKey, resolveRelativeToApi, staleWhileRevalidate);
  return <video ref={ref} src={resolvedSource || undefined} {...props} />;
});
