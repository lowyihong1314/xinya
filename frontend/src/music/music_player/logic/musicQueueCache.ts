type QueueTrackLike = {
  id: number;
};

type RepeatModeLike = "off" | "all" | "one";

export function resolveNextQueuedTrack<T extends QueueTrackLike>(
  queue: T[],
  currentTrackId: number | null,
  repeatMode: RepeatModeLike,
): T | null {
  if (!queue.length || repeatMode === "one" || currentTrackId == null) {
    return null;
  }

  const currentIndex = queue.findIndex((track) => track.id === currentTrackId);
  if (currentIndex < 0) {
    return null;
  }

  const nextIndex = currentIndex + 1;
  if (nextIndex < queue.length) {
    return queue[nextIndex] || null;
  }

  if (repeatMode === "all") {
    return queue[0] || null;
  }

  return null;
}
