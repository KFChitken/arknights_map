import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NoticeBody from "@/components/app/NoticeBody";
import { inlineParts, noticeBlocks, noticeExcerpt } from "./noticeText";

/** The words as the page shows them, without React's preload of the QR code's image */
const html = (body: string) => renderToStaticMarkup(createElement(NoticeBody, { body })).replace(/^<link [^>]*>/, "");

describe("a notice's words", () => {
  it("has headings, lists, paragraphs, bold and links", () => {
    expect(noticeBlocks("开头一段\n\n## 小标题\n- 第一条\n• 第二条\n\n**加粗**和[B站](https://space.bilibili.com/1)")).toEqual([
      { kind: "p", parts: [{ kind: "text", text: "开头一段" }], thanks: false },
      { kind: "h", text: "小标题" },
      { kind: "ul", items: [[{ kind: "text", text: "第一条" }], [{ kind: "text", text: "第二条" }]] },
      {
        kind: "p",
        parts: [
          { kind: "bold", text: "加粗" },
          { kind: "text", text: "和" },
          { kind: "link", text: "B站", href: "https://space.bilibili.com/1" },
        ],
        thanks: false,
      },
    ]);
  });

  it("makes bare https addresses links, ending at a space, Chinese punctuation or a bracket", () => {
    expect(inlineParts("看 https://a.cn/x，然后")).toEqual([
      { kind: "text", text: "看 " },
      { kind: "link", text: "https://a.cn/x", href: "https://a.cn/x" },
      { kind: "text", text: "，然后" },
    ]);
    for (const end of [" ", "。", "、", "；", "！", "？", "）", "」", ")"]) {
      expect(inlineParts(`https://a.cn/x${end}后`)[0]).toEqual({ kind: "link", text: "https://a.cn/x", href: "https://a.cn/x" });
    }
    expect(inlineParts("（https://a.cn/x）")).toEqual([
      { kind: "text", text: "（" },
      { kind: "link", text: "https://a.cn/x", href: "https://a.cn/x" },
      { kind: "text", text: "）" },
    ]);
  });

  it("links nothing but https, and shows any HTML as the words", () => {
    for (const text of ["http://a.cn/x", "[点这里](http://a.cn/x)", "[点这里](javascript:alert(1))", "javascript:alert(1)", "ftp://a.cn"]) {
      expect(inlineParts(text)).toEqual([{ kind: "text", text }]);
    }
    const out = html('<b>粗</b> <script>alert(1)</script> <a href="javascript:alert(1)">x</a> [点](javascript:alert(1)) http://a.cn');
    expect(out).toBe(
      '<div class="notice"><p>&lt;b&gt;粗&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt; &lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt; [点](javascript:alert(1)) http://a.cn</p></div>',
    );
    expect(html("[去看看](https://a.cn/x)")).toBe(
      '<div class="notice"><p><a href="https://a.cn/x" target="_blank" rel="noreferrer noopener">去看看</a></p></div>',
    );
  });

  it("puts the QR code where its line is, and centres the paragraph after it", () => {
    const blocks = noticeBlocks("加群：\n【Q群二维码】\n\n谢谢！\n\n还有一段");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "qr", "p", "p"]);
    expect(blocks.map((b) => b.kind === "p" && b.thanks)).toEqual([false, false, true, false]);
    // only a line that is just that
    expect(noticeBlocks("扫【Q群二维码】加群").map((b) => b.kind)).toEqual(["p"]);
    expect(html("【Q群二维码】\n谢谢！")).toBe(
      '<div class="notice"><a class="notice-qr" href="https://qm.qq.com/q/N2JAcrxeAC" target="_blank" rel="noreferrer noopener" aria-label="加入QQ群 1108446109">' +
        '<img src="/notice/qq-group.png" alt="QQ群 1108446109 的二维码" width="160" height="160"/><span>扫一扫，或者点二维码加群</span></a>' +
        '<p class="notice-thanks">谢谢！</p></div>',
    );
  });

  it("starts a paragraph at a blank line, and keeps the breaks inside one", () => {
    expect(noticeBlocks("第一行\r\n第二行\r\n\r\n\r\n下一段")).toEqual([
      { kind: "p", parts: [{ kind: "text", text: "第一行\n第二行" }], thanks: false },
      { kind: "p", parts: [{ kind: "text", text: "下一段" }], thanks: false },
    ]);
    // a list straight after a paragraph, and a paragraph straight after a list
    expect(noticeBlocks("说明：\n- 一\n- 二\n然后").map((b) => b.kind)).toEqual(["p", "ul", "p"]);
    // bold and link words never run over a line
    expect(inlineParts("**一\n二**")).toEqual([{ kind: "text", text: "**一\n二**" }]);
    expect(html("第一行\n第二行")).toBe('<div class="notice"><p>第一行\n第二行</p></div>');
    expect(noticeBlocks("")).toEqual([]);
    expect(noticeBlocks("\n\n")).toEqual([]);
  });

  it("takes the first paragraph or list item as plain words for the list, at most 60 of them", () => {
    expect(noticeExcerpt("## 标题\n\n- **加粗** 和 [链接](https://a.cn)\n- 第二条")).toBe("加粗 和 链接");
    expect(noticeExcerpt("第一行\n第二行\n\n第二段")).toBe("第一行 第二行");
    const long = "字".repeat(80);
    expect(Array.from(noticeExcerpt(long))).toHaveLength(60);
    expect(noticeExcerpt(long).endsWith("…")).toBe(true);
    expect(noticeExcerpt("字".repeat(60))).toBe("字".repeat(60));
    expect(noticeExcerpt("## 只有标题\n【Q群二维码】")).toBe("");
  });
});
