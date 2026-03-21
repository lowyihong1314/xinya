
export function getMaxZIndex() {
  const elements = document.getElementsByTagName('*');
  let maxZ = 0;
  for (let i = 0; i < elements.length; i++) {
    const z = parseInt(window.getComputedStyle(elements[i]).zIndex, 10);
    if (!isNaN(z)) {
      maxZ = Math.max(maxZ, z);
    }
  }
  return maxZ;
}
