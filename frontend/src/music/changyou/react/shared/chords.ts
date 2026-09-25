/**
 * 唱游模块和弦/转调的单一来源。
 * ChangyouDetailPage、ChangyouRoomController/helpers（投屏 payload）与 projection.ts 都从这里取逻辑。
 */

export type ChordFamily = "original" | "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type TransposeFamily = Exclude<ChordFamily, "original">;

export const CHORD_FAMILY_OPTIONS: ChordFamily[] = ["original", "C", "D", "E", "F", "G", "A", "B"];

const FAMILY_OFFSETS: Record<TransposeFamily, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const NOTE_INDEX: Record<string, number> = {
  C: 0,
  "B#": 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  F: 5,
  "E#": 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

// ---- 和弦语法 ----------------------------------------------------------------
// 根音：A–G + 可选 #/b
const ROOT_PATTERN = "[A-G](?:#|b)?";
// 后缀：只接受和弦记号，单字符/固定词为单位，避免嵌套量词回溯。
// 大写 M 只在后面跟数字时算（CM7），避免 "AM" 这类大写单词误判。
const SUFFIX_PATTERN = "(?:maj|min|dim|aug|sus|add|M\\d|m|\\+|-|°|ø|Δ|\\d|[#b])*";
// 谱面常见的括号注记，如 C（2拍）、C7(b9)
const ANNOTATION_PATTERN = "(?:[(（][^()（）]*[)）])?";
// 转位低音：/E、/F#，或 C6/9 这类数字
const BASS_PATTERN = "(?:[A-G](?:#|b)?|\\d+)";

const CHORD_PATTERN = `${ROOT_PATTERN}${SUFFIX_PATTERN}${ANNOTATION_PATTERN}(?:/${BASS_PATTERN})?`;
// 整个 token 必须由一个或多个和弦紧贴组成（谱面偶有 "Dm7G" 这种没空格的写法）
const CHORD_TOKEN_RE = new RegExp(`^(?:${CHORD_PATTERN})+$`);
// 逐个解析紧贴的和弦（sticky）
const CHORD_PART_RE = new RegExp(`(${ROOT_PATTERN})(${SUFFIX_PATTERN}${ANNOTATION_PATTERN})(?:/(${BASS_PATTERN}))?`, "y");
// 纯大写字母的多字符串（BAG、FADE、CB）不算和弦，即使每个字母都在 A–G 内
const BARE_LETTERS_RE = /^[A-G]{2,}$/;

/** 段落标签，如 [Chorus]、[Verse 1]、Verse 1、Chorus 2、Pre-Chorus、Intro (x2) */
const BRACKET_LABEL_RE = /^[[(【（][^\]）】)]*[\])】）]$/;
const KEYWORD_LABEL_RE =
  /^(?:intro|outro|verse|chorus|pre-?chorus|bridge|interlude|instrumental|refrain|coda|tag|ending|solo|vamp|hook)\b/i;

/**
 * 投屏分段用的「段落边界」判定（原 projection.ts 实现，行为不变）：
 * 以冒号结尾，或整行全大写（含数字/符号）。注意：全大写规则会把 "C G D" 这类纯大调和弦行也判成边界，
 * 所以转调时不能单凭它跳过整行，见 isSectionLabelLine。
 */
export function isSectionBoundary(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith(":")) return true;
  if (/^[A-Z][A-Z0-9 /+#&().-]*\^?$/.test(trimmed) && trimmed === trimmed.toUpperCase()) {
    return true;
  }
  return false;
}

/**
 * 转调时整行跳过的段落标签行：
 * - 方括号/圆括号标签：[Chorus]、（副歌）
 * - 以英文段落关键词开头：Verse 1、Chorus、Bridge、Pre-Chorus
 * - isSectionBoundary 判定为边界、且不是纯和弦行（CHORUS:、CHORUS、VERSE 2）。
 *   纯和弦行（C G D）虽然也满足全大写规则，但必须照常转调。
 */
export function isSectionLabelLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (BRACKET_LABEL_RE.test(trimmed)) return true;
  if (KEYWORD_LABEL_RE.test(trimmed)) return true;
  return isSectionBoundary(trimmed) && !isChordLine(trimmed);
}

/** 严格和弦语法：根音 [A-G] + 可选 #/b + 可选后缀 + 可选括号注记 + 可选转位低音；可多个紧贴。 */
export function isChordLikeToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) return false;
  if (BARE_LETTERS_RE.test(trimmed)) return false;
  return CHORD_TOKEN_RE.test(trimmed);
}

export function isChordLine(line: string) {
  const pieces = line.split(/(\s+|\|)/).filter(Boolean);
  const meaningful = pieces.filter((piece) => piece.trim() && piece !== "|");
  if (!meaningful.length) return false;
  return meaningful.every(isChordLikeToken);
}

function getPreferredNoteName(index: number, family: TransposeFamily) {
  if (family === "F") return FLAT_NAMES[index];
  return SHARP_NAMES[index];
}

function transposeRoot(root: string, offset: number, family: TransposeFamily) {
  const noteIndex = NOTE_INDEX[root.trim()];
  if (noteIndex == null) return root;
  return getPreferredNoteName((noteIndex + offset + 12) % 12, family);
}

export function transposeChordToken(token: string, targetFamily: TransposeFamily) {
  const trimmed = token.trim();
  if (!trimmed || trimmed === "|" || trimmed === "/") return token;
  if (!isChordLikeToken(trimmed)) return token;
  const offset = FAMILY_OFFSETS[targetFamily];
  let result = "";
  CHORD_PART_RE.lastIndex = 0;
  while (CHORD_PART_RE.lastIndex < trimmed.length) {
    const match = CHORD_PART_RE.exec(trimmed);
    if (!match) return token;
    const [, root, suffix = "", bass] = match;
    const nextRoot = transposeRoot(root, offset, targetFamily);
    const nextBass = bass ? transposeRoot(bass, offset, targetFamily) : null;
    result += `${nextRoot}${suffix}${nextBass ? `/${nextBass}` : ""}`;
  }
  return result;
}

export function transposeChordLine(line: string, targetFamily: TransposeFamily) {
  let result = "";
  let token = "";
  const flush = () => {
    if (!token) return;
    result += isChordLikeToken(token) ? transposeChordToken(token, targetFamily) : token;
    token = "";
  };
  for (const char of line) {
    if (char === "|" || char === " " || char === "\t") {
      flush();
      result += char;
    } else {
      token += char;
    }
  }
  flush();
  return result;
}

export function transformChordContent(content: string, targetFamily: ChordFamily) {
  if (targetFamily === "original") return content;
  return content
    .split("\n")
    .map((line) => {
      if (isSectionLabelLine(line)) return line;
      return isChordLine(line) ? transposeChordLine(line, targetFamily) : line;
    })
    .join("\n");
}
