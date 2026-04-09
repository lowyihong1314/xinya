import { useEffect, useMemo, useState, type ComponentProps } from "react";

import { CachedImage } from "../../../../components/CachedMedia";
import { resolveAlbumCoverCandidates, type MusicCoverSource } from "../../shared/musicCoverSources";

type MusicCoverImageProps = Omit<ComponentProps<typeof CachedImage>, "src"> & {
  source?: MusicCoverSource;
  candidates?: string[];
};

export function MusicCoverImage({
  source,
  candidates,
  cacheKey,
  refreshKey,
  onError,
  ...props
}: MusicCoverImageProps) {
  const coverCandidates = useMemo(() => {
    if (candidates?.length) {
      return candidates.filter(Boolean);
    }
    return resolveAlbumCoverCandidates(source);
  }, [candidates, source]);
  const coverSignature = coverCandidates.join("|");
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [coverSignature]);

  const safeCandidateIndex = Math.min(candidateIndex, Math.max(coverCandidates.length - 1, 0));
  const activeSource = coverCandidates[safeCandidateIndex];
  const scopedCacheKey = cacheKey ? `${cacheKey}:candidate:${safeCandidateIndex}` : undefined;
  const scopedRefreshKey =
    refreshKey == null ? safeCandidateIndex : `${String(refreshKey)}:${safeCandidateIndex}`;

  return (
    <CachedImage
      {...props}
      src={activeSource}
      cacheKey={scopedCacheKey}
      refreshKey={scopedRefreshKey}
      onError={(event) => {
        if (safeCandidateIndex < coverCandidates.length - 1) {
          setCandidateIndex(safeCandidateIndex + 1);
          return;
        }
        onError?.(event);
      }}
    />
  );
}
