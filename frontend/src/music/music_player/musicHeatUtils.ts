export function formatMusicHeat(minutes?: number | null): string {
  const value = Number(minutes ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "热度 0 分钟";
  }

  if (value >= 100 || Number.isInteger(value)) {
    return `热度 ${Math.round(value)} 分钟`;
  }

  return `热度 ${value.toFixed(1)} 分钟`;
}
