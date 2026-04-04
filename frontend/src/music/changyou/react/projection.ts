export type LyricProjectionBlock = {
  id: string;
  lines: string[];
  text: string;
  label: string;
  highlightable: boolean;
  weight: number;
};

export type LyricProjectionPage = {
  id: string;
  index: number;
  title: string;
  blocks: LyricProjectionBlock[];
  content: string;
  highlightableIndices: number[];
};

type ProjectionBlockLike = Partial<LyricProjectionBlock> & {
  lines?: string[] | null;
  text?: string | null;
  label?: string | null;
  highlightable?: boolean | null;
  weight?: number | null;
};

function isWideChar(char: string) {
  return /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char);
}

export function isSectionBoundary(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith(":")) return true;
  if (/^[A-Z][A-Z0-9 /+#&().-]*\^?$/.test(trimmed) && trimmed === trimmed.toUpperCase()) {
    return true;
  }
  return false;
}

function isChordLikeToken(token: string) {
  return /^([A-G](?:#|b)?)([^/]*?)(?:\/([A-G](?:#|b)?))?$/.test(token.trim());
}

export function isChordLine(line: string) {
  const pieces = line.split(/(\s+|\|)/).filter(Boolean);
  const meaningful = pieces.filter((piece) => piece.trim() && piece !== "|");
  if (!meaningful.length) return false;
  return meaningful.every(isChordLikeToken);
}

function isLyricLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isSectionBoundary(line)) return false;
  if (isChordLine(line)) return false;
  return /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AFa-zA-Z0-9]/.test(trimmed);
}

function normalizeLineForWeight(line: string) {
  return line.replace(/\t+/g, " ").replace(/ {2,}/g, " ").trim();
}

function estimateLineWeight(line: string) {
  const normalized = normalizeLineForWeight(line);
  if (!normalized) return 0.6;
  let width = 0;
  for (const char of normalized) {
    width += isWideChar(char) ? 2 : 1;
  }
  return Math.max(1, Math.ceil(width / 24));
}

function getBlockLabel(lines: string[]) {
  const sectionLine = lines.find((line) => isSectionBoundary(line));
  if (sectionLine) return sectionLine.trim();

  const lyricLine = lines.find((line) => isLyricLine(line));
  if (lyricLine) {
    const trimmed = lyricLine.trim();
    return trimmed.length > 20 ? `${trimmed.slice(0, 20)}...` : trimmed;
  }

  const fallback = lines.find((line) => line.trim())?.trim() || "未命名段落";
  return fallback.length > 20 ? `${fallback.slice(0, 20)}...` : fallback;
}

<<<<<<< HEAD
function createBlock(lines: string[], index: number): LyricProjectionBlock {
  const highlightable = lines.some((line) => isLyricLine(line));
=======
function isFallbackHighlightableLine(line: string) {
  const trimmed = line.trim();
  return Boolean(trimmed) && !isSectionBoundary(trimmed);
}

function inferBlockHighlightable(lines: string[]) {
  if (lines.some((line) => isLyricLine(line))) return true;
  return lines.some((line) => isFallbackHighlightableLine(line));
}

function createBlock(lines: string[], index: number): LyricProjectionBlock {
  const highlightable = inferBlockHighlightable(lines);
>>>>>>> 7410128 (update changyou)
  return {
    id: `block-${index}`,
    lines,
    text: lines.join("\n"),
    label: getBlockLabel(lines),
    highlightable,
    weight: Math.max(1, lines.reduce((sum, line) => sum + estimateLineWeight(line), 0)),
  };
}

export function buildProjectionBlocks(content: string) {
  const lines = content.split(/\r?\n/);
  const blocks: LyricProjectionBlock[] = [];
  let blockIndex = 0;
  let pendingHeading: string[] = [];
  let pendingLooseLines: string[] = [];

  const pushBlock = (linesToPush: string[]) => {
    const cleaned = linesToPush.filter((line, index, arr) => {
      if (line.trim()) return true;
      return arr.slice(index + 1).some((nextLine) => nextLine.trim());
    });
    if (!cleaned.length || !cleaned.some((line) => line.trim())) return;
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
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
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
<<<<<<< HEAD
      while (cursor < lines.length && isLyricLine(lines[cursor])) {
        blockLines.push(lines[cursor]);
        cursor += 1;
=======
      let collectedLyricLines = false;
      while (cursor < lines.length) {
        const nextLine = lines[cursor];
        const trimmedNext = nextLine.trim();
        if (!trimmedNext || isSectionBoundary(nextLine)) break;
        if (isLyricLine(nextLine)) {
          blockLines.push(nextLine);
          collectedLyricLines = true;
          cursor += 1;
          continue;
        }
        if (!collectedLyricLines) {
          blockLines.push(nextLine);
          cursor += 1;
          continue;
        }
        break;
>>>>>>> 7410128 (update changyou)
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
      while (cursor < lines.length && isLyricLine(lines[cursor])) {
        blockLines.push(lines[cursor]);
        cursor += 1;
      }
      pushBlock(blockLines);
      index = cursor - 1;
      continue;
    }

    if (pendingHeading.length) {
<<<<<<< HEAD
      pushBlock([...pendingHeading, line]);
      pendingHeading = [];
=======
      const blockLines = [...pendingHeading, line];
      pendingHeading = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const nextLine = lines[cursor];
        const trimmedNext = nextLine.trim();
        if (!trimmedNext || isSectionBoundary(nextLine) || isLyricLine(nextLine)) break;
        blockLines.push(nextLine);
        cursor += 1;
      }
      pushBlock(blockLines);
      index = cursor - 1;
>>>>>>> 7410128 (update changyou)
      continue;
    }

    pendingLooseLines.push(line);
  }

  flushLooseLines();
  flushHeadingOnly();
  return blocks;
}

export function ensureProjectionBlocks(blocks: ProjectionBlockLike[] | null | undefined, fallbackContent: string) {
  if (Array.isArray(blocks) && blocks.length) {
    const normalized = blocks
      .map((block, index) => {
        const normalizedLines = Array.isArray(block.lines)
          ? block.lines.filter((line): line is string => typeof line === "string")
          : [];
        const normalizedText =
          typeof block.text === "string"
            ? block.text
            : normalizedLines.length
              ? normalizedLines.join("\n")
              : "";
        const lines = normalizedLines.length ? normalizedLines : normalizedText ? normalizedText.split(/\r?\n/) : [];
        const text = normalizedText || lines.join("\n");
        if (!text.trim()) return null;
<<<<<<< HEAD
        const highlightable = typeof block.highlightable === "boolean"
          ? block.highlightable
          : lines.some((line) => isLyricLine(line));
=======
        const highlightable = block.highlightable === true || inferBlockHighlightable(lines);
>>>>>>> 7410128 (update changyou)
        const weight =
          typeof block.weight === "number" && Number.isFinite(block.weight) && block.weight > 0
            ? block.weight
            : Math.max(1, lines.reduce((sum, line) => sum + estimateLineWeight(line), 0));
        return {
          id: typeof block.id === "string" && block.id.trim() ? block.id : `block-${index}`,
          lines,
          text,
          label:
            typeof block.label === "string" && block.label.trim()
              ? block.label
              : getBlockLabel(lines),
          highlightable,
          weight,
        } satisfies LyricProjectionBlock;
      })
      .filter((block): block is LyricProjectionBlock => Boolean(block));

    if (normalized.length) {
      return normalized;
    }
  }

  const built = buildProjectionBlocks(fallbackContent);
  if (built.length) return built;

  if (fallbackContent.trim()) {
    const lines = fallbackContent.split(/\r?\n/);
    return [
      {
        id: "block-fallback",
        lines,
        text: fallbackContent,
        label: getBlockLabel(lines),
<<<<<<< HEAD
        highlightable: lines.some((line) => isLyricLine(line)),
=======
        highlightable: inferBlockHighlightable(lines),
>>>>>>> 7410128 (update changyou)
        weight: Math.max(1, lines.reduce((sum, line) => sum + estimateLineWeight(line), 0)),
      },
    ];
  }

  return [];
}

function getPageTitle(blocks: LyricProjectionBlock[], pageIndex: number) {
  const sectionBlock = blocks.find((block) => block.label.endsWith(":"));
  if (sectionBlock) return sectionBlock.label;
  const firstHighlightable = blocks.find((block) => block.highlightable);
  if (firstHighlightable) return firstHighlightable.label;
  return `第 ${pageIndex + 1} 页`;
}

function createPage(blocks: LyricProjectionBlock[], index: number): LyricProjectionPage {
  return {
    id: `page-${index}`,
    index,
    title: getPageTitle(blocks, index),
    blocks,
    content: blocks.map((block) => block.text).join("\n\n"),
    highlightableIndices: blocks.flatMap((block, blockIndex) => (block.highlightable ? [blockIndex] : [])),
  };
}

export function paginateProjectionBlocks(blocks: LyricProjectionBlock[], maxWeight = 12) {
  if (!blocks.length) return [];

  const pages: LyricProjectionPage[] = [];
  let currentBlocks: LyricProjectionBlock[] = [];
  let currentWeight = 0;

  for (const block of blocks) {
    const nextWeight = currentWeight + block.weight;
    if (currentBlocks.length && nextWeight > maxWeight) {
      pages.push(createPage(currentBlocks, pages.length));
      currentBlocks = [block];
      currentWeight = block.weight;
      continue;
    }
    currentBlocks.push(block);
    currentWeight = nextWeight;
  }

  if (currentBlocks.length) {
    pages.push(createPage(currentBlocks, pages.length));
  }

  return pages;
}

export function buildProjectionPages(content: string, maxWeight = 12) {
  return paginateProjectionBlocks(buildProjectionBlocks(content), maxWeight);
}

export function splitBlocksForDoublePage(blocks: LyricProjectionBlock[]) {
  if (blocks.length <= 1) {
    return { left: blocks, right: [] as LyricProjectionBlock[] };
  }

  const totalWeight = blocks.reduce((sum, block) => sum + block.weight, 0);
  let cumulative = 0;
  let bestIndex = 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 1; index < blocks.length; index += 1) {
    cumulative += blocks[index - 1].weight;
    const leftWeight = cumulative;
    const rightWeight = totalWeight - cumulative;
    if (leftWeight <= 0 || rightWeight <= 0) continue;

    const imbalance = Math.abs(leftWeight - rightWeight);
    const positionPenalty = Math.abs(index - blocks.length / 2) * 0.35;
    const score = imbalance + positionPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return {
    left: blocks.slice(0, bestIndex),
    right: blocks.slice(bestIndex),
  };
}
