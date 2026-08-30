import { diyFontFileUrl } from "./diyApi";
import type { DiyElement } from "./diyApi";

// 画布绘制 + 字体加载。抽出来单独放，是因为「画布上看到的」和「PDF 里印出来的」
// 必须是同一条式子算出来的，混在组件里迟早会被改歪。
//
// 和后端 diy_paiwei.py 的 _draw_element 一一对应：
//   第 i 个字的基线 = y + font_size + i * spacing   （从页面顶边往下量）
//   竖排一个字一行；横排 \n 分行，行距同 spacing
// canvas 的 textBaseline = "alphabetic" 正好就是 PDF 的基线，所以两边写法几乎一样。
//
// 唯一多出来的一项是 offsetY：底图 PDF 的 MediaBox 左下角不在 (0,0)，overlay 合上去之后
// 文字相对画面会整体下移 y0。PDF 那头正常牌位也吃同一份偏移（所以不能去动），
// 画布铺的却是按 CropBox 渲的图，得自己补上，否则预览比印出来的高一截。

/** 没有字体文件的（宋体走 reportlab 内置 CID）只能退回系统字体，尽量挑接近的。 */
const FALLBACK_STACK: Record<string, string> = {
  song: '"Songti SC","STSong","Noto Serif SC","SimSun",serif',
};
const GENERIC_FALLBACK = '"Kaiti SC","KaiTi","STKaiti","Songti SC","SimSun",serif';

export function fontFamilyFor(fontId: string): string {
  const fallback = FALLBACK_STACK[fontId] || GENERIC_FALLBACK;
  return `"diy-${fontId}", ${fallback}`;
}

const loading = new Map<string, Promise<boolean>>();

/** 把后端那份字体文件加载成 @font-face，画布才会用和 PDF 一样的字形。
 *  同一个字体只加载一次；加载不动就静默退回系统字体（字形会不一样，但不至于白屏）。 */
export function ensureDiyFont(fontId: string, hasFile: boolean): Promise<boolean> {
  if (!hasFile || typeof document === "undefined" || !("FontFace" in window)) {
    return Promise.resolve(false);
  }
  const family = `diy-${fontId}`;
  const existing = loading.get(family);
  if (existing) {
    return existing;
  }
  const task = (async () => {
    try {
      const face = new FontFace(family, `url(${diyFontFileUrl(fontId)})`);
      await face.load();
      (document.fonts as FontFaceSet).add(face);
      return true;
    } catch {
      return false;
    }
  })();
  loading.set(family, task);
  return task;
}

export type Box = { left: number; top: number; width: number; height: number };

/** 文字块在页面上占的矩形（PDF 点）。拖动的命中区、选中框都用它。 */
export function elementBox(ctx: CanvasRenderingContext2D | null, element: DiyElement): Box {
  const size = element.font_size;
  const spacing = element.spacing || size * 1.15;

  if (element.vertical) {
    const chars = Array.from(element.text.replace(/\n/g, ""));
    const count = Math.max(1, chars.length);
    return {
      left: element.x,
      top: element.y,
      width: size,
      height: (count - 1) * spacing + size,
    };
  }

  const lines = element.text.split("\n");
  let width = size;
  if (ctx) {
    ctx.font = `${size}px ${fontFamilyFor(element.font)}`;
    width = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
  } else {
    width = Math.max(...lines.map((line) => line.length * size), size);
  }
  return {
    left: element.x,
    top: element.y,
    width,
    height: (lines.length - 1) * spacing + size,
  };
}

/** 元素坐标 → 画布像素（补上底图偏移）。拖动、命中区、辅助线全走这两个函数。 */
export function toScreenX(x: number, scale: number) {
  return x * scale;
}
export function toScreenY(y: number, scale: number, offsetY: number) {
  return (y + offsetY) * scale;
}
export function fromScreenY(py: number, scale: number, offsetY: number) {
  return py / scale - offsetY;
}

/** 把一个文字块画到 canvas 上。和后端 _draw_element 是同一条式子。 */
function drawElement(ctx: CanvasRenderingContext2D, element: DiyElement, scale: number, offsetY: number) {
  const size = element.font_size;
  const spacing = element.spacing || size * 1.15;
  const x = element.x * scale;

  ctx.font = `${size * scale}px ${fontFamilyFor(element.font)}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = element.color || "#000000";
  ctx.strokeStyle = element.color || "#000000";
  // 和后端一样：加粗 = 填充之后再描一遍边
  ctx.lineWidth = Math.max(0.3, size * 0.028) * scale;

  const put = (line: string, index: number) => {
    const baseline = (element.y + offsetY + size + index * spacing) * scale;
    ctx.fillText(line, x, baseline);
    if (element.bold) {
      ctx.strokeText(line, x, baseline);
    }
  };

  if (element.vertical) {
    Array.from(element.text)
      .filter((char) => char !== "\n")
      .forEach((char, index) => put(char, index));
    return;
  }
  element.text.split("\n").forEach((line, index) => put(line, index));
}

export function drawPage({
  canvas,
  background,
  elements,
  pageWidth,
  pageHeight,
  scale,
  offsetY,
}: {
  canvas: HTMLCanvasElement;
  background: HTMLImageElement | null;
  elements: DiyElement[];
  pageWidth: number;
  pageHeight: number;
  scale: number;
  offsetY: number;
}) {
  const ctx = canvas.getContext("2d");
  if (!ctx || scale <= 0) {
    return;
  }

  const cssWidth = pageWidth * scale;
  const cssHeight = pageHeight * scale;
  // 高分屏按 devicePixelRatio 放大后备缓冲，否则字是糊的
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  if (canvas.width !== Math.round(cssWidth * ratio) || canvas.height !== Math.round(cssHeight * ratio)) {
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
  }
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  if (background) {
    ctx.drawImage(background, 0, 0, cssWidth, cssHeight);
  }

  elements.forEach((element) => drawElement(ctx, element, scale, offsetY));
}


export type SnapCandidate = { value: number; label: string };
export type SnapResult = { x: number; y: number; hitX: SnapCandidate | null; hitY: SnapCandidate | null };

/** 吸附：x 和 y 各自独立找最近的候选，够近就贴上去。
 *  分开处理是故意的 —— 只对齐一个方向（例如几块字左边对齐）比整点吸附更常用。 */
export function snapPosition(
  x: number,
  y: number,
  candidatesX: SnapCandidate[],
  candidatesY: SnapCandidate[],
  tolerance: number,
): SnapResult {
  const pick = (value: number, candidates: SnapCandidate[]) => {
    let best: SnapCandidate | null = null;
    let bestDistance = tolerance;
    candidates.forEach((candidate) => {
      const distance = Math.abs(candidate.value - value);
      if (distance <= bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    });
    return best;
  };

  const hitX = pick(x, candidatesX);
  const hitY = pick(y, candidatesY);
  return {
    x: hitX ? (hitX as SnapCandidate).value : x,
    y: hitY ? (hitY as SnapCandidate).value : y,
    hitX,
    hitY,
  };
}
