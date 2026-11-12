/**
 * How a notice's text is written (公告, src/components/app/NoticeBody.tsx): plain text with a few marks,
 * read the same way for the admin's preview and for everyone who reads it. Nothing in it is ever HTML.
 *
 * - Line by line; a blank line ends a paragraph or a list, and the lines of one paragraph keep their breaks.
 * - 「## 」 starts a heading; 「- 」 or 「• 」 a list item.
 * - A line that is only 【Q群二维码】 is the QQ group's QR code; the paragraph after it is centred.
 * - In paragraphs and list items: **bold**, [words](https://…), and bare https:// addresses, which end at a
 *   space, Chinese punctuation (，。、；！？）」) or 「)」. Nothing but https:// becomes a link.
 */

export type NoticeInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string };

export type NoticeBlock =
  | { kind: "p"; parts: NoticeInline[]; thanks: boolean }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: NoticeInline[][] }
  | { kind: "qr" };

/** The line that stands for the QQ group's QR code */
export const QR_LINE = "【Q群二维码】";

const INLINE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s，。、；！？）」)]+)/g;
const ITEM = /^[-•]\s+(.*)$/;

/** Bold, links and the plain text between them */
export function inlineParts(text: string): NoticeInline[] {
  const out: NoticeInline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "link", text: m[2], href: m[3] });
    else out.push({ kind: "link", text: m[4], href: m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** A notice's body as blocks, in order */
export function noticeBlocks(body: string): NoticeBlock[] {
  const blocks: NoticeBlock[] = [];
  let para: string[] = [];
  let list: NoticeInline[][] | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ kind: "p", parts: inlineParts(para.join("\n")), thanks: blocks.at(-1)?.kind === "qr" });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push({ kind: "ul", items: list });
    list = null;
  };
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    const item = line.match(ITEM);
    if (!line || line === QR_LINE || line.startsWith("## ")) {
      endPara();
      endList();
      if (line === QR_LINE) blocks.push({ kind: "qr" });
      else if (line) blocks.push({ kind: "h", text: line.slice(3).trim() });
    } else if (item) {
      endPara();
      (list ??= []).push(inlineParts(item[1]));
    } else {
      endList();
      para.push(line);
    }
  }
  endPara();
  endList();
  return blocks;
}

const plain = (parts: NoticeInline[]) => parts.map((p) => p.text).join("");

/** The first paragraph or list item as plain text, at most max characters, for the list of notices */
export function noticeExcerpt(body: string, max = 60): string {
  const first = noticeBlocks(body).find((b) => b.kind === "p" || b.kind === "ul");
  if (!first) return "";
  const text = (first.kind === "p" ? plain(first.parts) : plain(first.items[0])).replace(/\s*\n\s*/g, " ");
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}
