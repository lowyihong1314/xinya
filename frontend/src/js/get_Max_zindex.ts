export function getMaxZIndex(root: ParentNode = document): number {
  const elements = root.querySelectorAll<HTMLElement>("*");
  let maxZ = 0;

  for (const element of elements) {
    const zIndex = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
    if (!Number.isNaN(zIndex)) {
      maxZ = Math.max(maxZ, zIndex);
    }
  }

  return maxZ;
}
