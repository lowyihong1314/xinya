/**
 * 歌词正文 → 投屏块 → 投屏页。**纯函数**，不碰网络也不碰 React。
 *
 * 从旧 src/music/changyou/react/projection.ts 移植，分段和分页的判据一行没改 ——
 * 块的形状（见 types.ts 的 ProjectionBlock）会被原样写进 Redis 再推给播放端，
 * 线上还有一份没法逐个升级的 APK 老播放页按那些键读。
 *
 * 移植时只补了一件事：**数组下标的空值分支**。旧文件没进 tsconfig 的 include，
 * 从来没被 noUncheckedIndexedAccess 查过，`lines[cursor]` 那种写法在新配置下
 * 是 `string | undefined`。
 *
 * 为什么放在模块里而不是 shared：现在只有唱游房间用它。
 * music 模块重写时如果也要（那边有同一份代码），到时候再上浮 ——
 * 判据见 docs/frontend_rewrite/01-架构与约定.md：被两个以上模块用才进 shared。
 */
import type { ProjectionBlock } from "../types";

/** 一页投屏：若干块 + 给控制台看的标题。 */
export interface ProjectionPage {
  index: number;
  /** 段落名优先，没有就用首个可高亮块的 label，再没有就 "第 N 页"。 */
  title: string;
  blocks: ProjectionBlock[];
  /** 块正文用空行拼起来，POST /project 的 content 字段发的就是它。 */
  content: string;
}

/** 一页最多装多少「权重」。12 是旧实现的默认值，按投影仪竖排能放下调出来的。 */
const DEFAULT_PAGE_WEIGHT = 12;

/** 全角字符（中日韩 + 全角标点）占两个字宽，估行宽时要算两倍。 */
function isWideChar(char: string): boolean {
  return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/.test(
    char,
  );
}

/** 段落标题：以冒号结尾，或者整行全大写（VERSE 1、CHORUS^）。 */
export function isSectionBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith(":")) return true;
  return /^[A-Z][A-Z0-9 /+#&().-]*\^?$/.test(trimmed) && trimmed === trimmed.toUpperCase();
}

function isChordLikeToken(token: string): boolean {
  return /^([A-G](?:#|b)?)([^/]*?)(?:\/([A-G](?:#|b)?))?$/.test(token.trim());
}

/** 和弦行：拆掉空格和小节线之后，**每一个**片段都长得像和弦。 */
export function isChordLine(line: string): boolean {
  const meaningful = line
    .split(/(\s+|\|)/)
    .filter(Boolean)
    .filter((piece) => piece.trim() && piece !== "|");
  if (!meaningful.length) return false;
  return meaningful.every(isChordLikeToken);
}

/** 歌词行：不是空行、不是段落标题、不是和弦行，且含中/日/韩/拉丁字符。 */
function isLyricLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isSectionBoundary(line)) return false;
  if (isChordLine(line)) return false;
  return /[一-鿿぀-ヿ가-힯a-zA-Z0-9]/.test(trimmed);
}

function estimateLineWeight(line: string): number {
  const normalized = line.replace(/\t+/g, " ").replace(/ {2,}/g, " ").trim();
  // 空行也占地方，但不足一行。
  if (!normalized) return 0.6;
  let width = 0;
  for (const char of normalized) width += isWideChar(char) ? 2 : 1;
  return Math.max(1, Math.ceil(width / 24));
}

function sumWeight(lines: string[]): number {
  return Math.max(1, lines.reduce((sum, line) => sum + estimateLineWeight(line), 0));
}

function truncateLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 20 ? `${trimmed.slice(0, 20)}...` : trimmed;
}

function getBlockLabel(lines: string[]): string {
  const sectionLine = lines.find(isSectionBoundary);
  if (sectionLine) return sectionLine.trim();

  const lyricLine = lines.find(isLyricLine);
  if (lyricLine) return truncateLabel(lyricLine);

  const fallback = lines.find((line) => line.trim());
  return fallback ? truncateLabel(fallback) : "未命名段落";
}

/** 有歌词行就能高亮；一行歌词都没有时，退而求其次：非段落标题的行也算。 */
function inferBlockHighlightable(lines: string[]): boolean {
  if (lines.some(isLyricLine)) return true;
  return lines.some((line) => line.trim() && !isSectionBoundary(line));
}

function createBlock(lines: string[], index: number): ProjectionBlock {
  return {
    id: `block-${index}`,
    lines,
    text: lines.join("\n"),
    label: getBlockLabel(lines),
    highlightable: inferBlockHighlightable(lines),
    weight: sumWeight(lines),
  };
}

/**
 * 正文切成块。规则（按优先级）：
 *   空行      → 断块
 *   段落标题  → 断块，并把标题挂到下一个块的头上
 *   和弦行    → 和它下面紧跟的歌词行合成一块（和弦要和歌词一起投，否则对不上）
 *   歌词行    → 连续的歌词行合成一块
 *   其它      → 攒着，碰到上面任意一种再断
 */
export function buildProjectionBlocks(content: string): ProjectionBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: ProjectionBlock[] = [];
  let blockIndex = 0;
  let pendingHeading: string[] = [];
  let pendingLooseLines: string[] = [];

  const pushBlock = (linesToPush: string[]) => {
    // 去掉块尾的空行（块中间的空行留着，它是排版的一部分）。
    const cleaned = linesToPush.filter((line, index, arr) => {
      if (line.trim()) return true;
      return arr.slice(index + 1).some((nextLine) => nextLine.trim());
    });
    if (!cleaned.some((line) => line.trim())) return;
    blocks.push(createBlock(cleaned, blockIndex));
    blockIndex += 1;
  };

  const flushLooseLines = () => {
    if (!pendingLooseLines.length) return;
    pushBlock(pendingLooseLines);
    pendingLooseLines = [];
  };

  const flushHeadingOnly = () => {
    if (!pendingHeading.length) return;
    pushBlock(pendingHeading);
    pendingHeading = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      flushLooseLines();
      flushHeadingOnly();
      continue;
    }

    if (isSectionBoundary(line)) {
      flushLooseLines();
      flushHeadingOnly();
      pendingHeading = [line];
      continue;
    }

    if (isChordLine(line)) {
      flushLooseLines();
      const blockLines = [...pendingHeading, line];
      pendingHeading = [];
      let cursor = index + 1;
      let collectedLyricLines = false;
      while (cursor < lines.length) {
        const nextLine = lines[cursor] ?? "";
        if (!nextLine.trim() || isSectionBoundary(nextLine)) break;
        if (isLyricLine(nextLine)) {
          blockLines.push(nextLine);
          collectedLyricLines = true;
          cursor += 1;
          continue;
        }
        // 还没收到歌词就遇到第二行和弦：那是「和弦 / 和弦 / 歌词」的谱式，继续收；
        // 已经收过歌词再遇到非歌词行，说明下一段开始了，断在这。
        if (!collectedLyricLines) {
          blockLines.push(nextLine);
          cursor += 1;
          continue;
        }
        break;
      }
      pushBlock(blockLines);
      index = cursor - 1;
      continue;
    }

    if (isLyricLine(line)) {
      flushLooseLines();
      const blockLines = [...pendingHeading, line];
      pendingHeading = [];
      let cursor = index + 1;
      while (cursor < lines.length && isLyricLine(lines[cursor] ?? "")) {
        blockLines.push(lines[cursor] ?? "");
        cursor += 1;
      }
      pushBlock(blockLines);
      index = cursor - 1;
      continue;
    }

    if (pendingHeading.length) {
      const blockLines = [...pendingHeading, line];
      pendingHeading = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const nextLine = lines[cursor] ?? "";
        if (!nextLine.trim() || isSectionBoundary(nextLine) || isLyricLine(nextLine)) break;
        blockLines.push(nextLine);
        cursor += 1;
      }
      pushBlock(blockLines);
      index = cursor - 1;
      continue;
    }

    pendingLooseLines.push(line);
  }

  flushLooseLines();
  flushHeadingOnly();
  return blocks;
}

/**
 * 把后端存下来的块补全成可渲染的形状。
 *
 * 为什么要这一层：Redis 里那份 JSON 是**前端某个版本**写进去的，可能缺键
 * （老 APK 写的块没有 weight），也可能整个是空的（推了歌但还没投屏）。
 * 缺什么补什么，一个都补不出来就从 fallbackContent 现切一份 ——
 * 播放端宁可自己切一遍，也不要显示空白。
 */
export function ensureProjectionBlocks(
  blocks: readonly Partial<ProjectionBlock>[] | null | undefined,
  fallbackContent: string,
): ProjectionBlock[] {
  // 用 blocks?.length 而不是 Array.isArray：后者对 readonly 数组只能窄化成 any[]，
  // 整个回调里的类型就全塌成 any 了（隐式 any 会被 tsc 拦下来，但更坏的是它不拦时）。
  if (blocks?.length) {
    const normalized: ProjectionBlock[] = [];
    blocks.forEach((block, index) => {
      // 类型上 lines 是 string[]，但这份数据是从 Redis 里的 JSON 反序列化来的，
      // 写它的可能是任意一个历史版本的前端 —— 所以逐项还要验一次。
      const rawLines = Array.isArray(block.lines)
        ? block.lines.filter((line): line is string => typeof line === "string")
        : [];
      const rawText = typeof block.text === "string" ? block.text : rawLines.join("\n");
      const lines = rawLines.length ? rawLines : rawText ? rawText.split(/\r?\n/) : [];
      const text = rawText || lines.join("\n");
      if (!text.trim()) return;
      normalized.push({
        id: typeof block.id === "string" && block.id.trim() ? block.id : `block-${index}`,
        lines,
        text,
        label:
          typeof block.label === "string" && block.label.trim()
            ? block.label
            : getBlockLabel(lines),
        highlightable: block.highlightable === true || inferBlockHighlightable(lines),
        weight:
          typeof block.weight === "number" && Number.isFinite(block.weight) && block.weight > 0
            ? block.weight
            : sumWeight(lines),
      });
    });
    if (normalized.length) return normalized;
  }

  const built = buildProjectionBlocks(fallbackContent);
  if (built.length) return built;

  // 切不出块又确实有内容：整段当一块，总比空白强。
  if (fallbackContent.trim()) {
    const lines = fallbackContent.split(/\r?\n/);
    return [
      {
        id: "block-fallback",
        lines,
        text: fallbackContent,
        label: getBlockLabel(lines),
        highlightable: inferBlockHighlightable(lines),
        weight: sumWeight(lines),
      },
    ];
  }

  return [];
}

function getPageTitle(blocks: readonly ProjectionBlock[], pageIndex: number): string {
  const sectionBlock = blocks.find((block) => block.label.endsWith(":"));
  if (sectionBlock) return sectionBlock.label;
  const firstHighlightable = blocks.find((block) => block.highlightable);
  if (firstHighlightable) return firstHighlightable.label;
  return `第 ${pageIndex + 1} 页`;
}

function createPage(blocks: ProjectionBlock[], index: number): ProjectionPage {
  return {
    index,
    title: getPageTitle(blocks, index),
    blocks,
    content: blocks.map((block) => block.text).join("\n\n"),
  };
}

/** 按权重装页：装不下就翻页，单块超重也自成一页（不切块，切了和弦就和歌词分家）。 */
export function paginateProjectionBlocks(
  blocks: readonly ProjectionBlock[],
  maxWeight = DEFAULT_PAGE_WEIGHT,
): ProjectionPage[] {
  if (!blocks.length) return [];

  const pages: ProjectionPage[] = [];
  let currentBlocks: ProjectionBlock[] = [];
  let currentWeight = 0;

  for (const block of blocks) {
    if (currentBlocks.length && currentWeight + block.weight > maxWeight) {
      pages.push(createPage(currentBlocks, pages.length));
      currentBlocks = [block];
      currentWeight = block.weight;
      continue;
    }
    currentBlocks.push(block);
    currentWeight += block.weight;
  }

  if (currentBlocks.length) pages.push(createPage(currentBlocks, pages.length));
  return pages;
}

/** 正文 → 分好页的投屏内容。控制台的分页列表用它。 */
export function buildProjectionPages(
  content: string,
  maxWeight = DEFAULT_PAGE_WEIGHT,
): ProjectionPage[] {
  return paginateProjectionBlocks(buildProjectionBlocks(content), maxWeight);
}
