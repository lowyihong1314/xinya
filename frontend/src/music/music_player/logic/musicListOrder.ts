type PlayMinutesLike = {
  play_minutes?: number | null;
};

export const PINNED_ALL_SONGS_CACHE_LIMIT = 10;

export function sortAllSongsByListOrder<T extends PlayMinutesLike>(musics: T[]): T[] {
  return [...musics].sort((a, b) => Number(b.play_minutes ?? 0) - Number(a.play_minutes ?? 0));
}

export function getPinnedAllSongsCacheCandidates<T extends PlayMinutesLike>(
  musics: T[],
  limit = PINNED_ALL_SONGS_CACHE_LIMIT,
): T[] {
  return sortAllSongsByListOrder(musics).slice(0, Math.max(0, limit));
}
