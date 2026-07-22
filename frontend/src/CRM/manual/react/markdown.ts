// 轻量 Markdown → HTML 渲染（自足，无第三方依赖）。
// 覆盖手册用到的语法：标题(带 id)、粗体、行内代码、链接、有序/无序列表(含一层嵌套)、
// GFM 表格、引用块、分割线、段落。内容为本站可信文档，输出用于 dangerouslySetInnerHTML。

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function slugify(text: string): string {
  return text.trim().replace(/\s+/g, "-");
}

function renderInline(raw: string): string {
  let text = escapeHtml(raw);
  text = text.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, (_m, inner) => `<strong>${inner}</strong>`);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const external = /^https?:/i.test(url);
    return `<a href="${url}"${external ? ' data-ext="1"' : ""}>${label}</a>`;
  });
  return text;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((cell) => cell.trim());
}

type ListItem = { indent: number; ordered: boolean; text: string };

function listItemMatch(line: string): ListItem | null {
  const m = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
  if (!m) return null;
  return { indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] };
}

function renderList(lines: string[], start: number, baseIndent: number): [string, number] {
  const first = listItemMatch(lines[start]);
  const tag = first && first.ordered ? "ol" : "ul";
  let i = start;
  let html = `<${tag}>`;
  while (i < lines.length) {
    const item = listItemMatch(lines[i]);
    if (!item || item.indent < baseIndent || item.indent > baseIndent) break;
    let itemHtml = renderInline(item.text);
    i += 1;
    const nested = i < lines.length ? listItemMatch(lines[i]) : null;
    if (nested && nested.indent > baseIndent) {
      const [sub, next] = renderList(lines, i, nested.indent);
      itemHtml += sub;
      i = next;
    }
    html += `<li>${itemHtml}</li>`;
  }
  html += `</${tag}>`;
  return [html, i];
}

const BLOCK_START = /^\s*(#{1,6}\s|>\s?|---+\s*$|([-*]|\d+\.)\s+)/;

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      out.push("<hr/>");
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      out.push(`<h${level} id="${slugify(text)}">${renderInline(text)}</h${level}>`);
      i += 1;
      continue;
    }
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      lines[i + 1].includes("-") &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])
    ) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      let table = "<table><thead><tr>";
      table += header.map((c) => `<th>${renderInline(c)}</th>`).join("");
      table += "</tr></thead><tbody>";
      for (const row of rows) {
        table += "<tr>" + row.map((c) => `<td>${renderInline(c)}</td>`).join("") + "</tr>";
      }
      table += "</tbody></table>";
      out.push(table);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderInline(buf.join(" "))}</blockquote>`);
      continue;
    }
    if (listItemMatch(line)) {
      const [html, next] = renderList(lines, i, listItemMatch(line)!.indent);
      out.push(html);
      i = next;
      continue;
    }
    const buf: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]) && !lines[i].includes("|")) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${renderInline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}
