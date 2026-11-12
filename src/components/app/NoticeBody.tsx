/* eslint-disable @next/next/no-img-element -- one small PNG, which next/image would only copy */

import { Fragment } from "react";
import { noticeBlocks, type NoticeInline } from "@/lib/noticeText";

const QQ_GROUP = "278579278";
/** What the group's QR code opens: QQ's page for joining the group (the second group: the first is full, 11/12) */
const QQ_JOIN = "https://qm.qq.com/q/yEAmVqJZ4Y";
/** Links open in a new tab and tell the other site nothing about this page */
const OUT = { target: "_blank", rel: "noreferrer noopener" } as const;

/**
 * A notice's text (src/lib/noticeText.ts) as the page shows it, for the players' board and the admin's
 * preview alike. Everything is a React element or text: whatever HTML someone writes shows as the words.
 */
export default function NoticeBody({ body }: { body: string }) {
  return (
    <div className="notice">
      {noticeBlocks(body).map((b, i) => {
        switch (b.kind) {
          case "h":
            return <h3 key={i}>{b.text}</h3>;
          case "ul":
            return (
              <ul key={i}>
                {b.items.map((parts, j) => (
                  <li key={j}>
                    <Inline parts={parts} />
                  </li>
                ))}
              </ul>
            );
          case "qr":
            return (
              <a key={i} className="notice-qr" href={QQ_JOIN} {...OUT} aria-label={`加入QQ群 ${QQ_GROUP}`}>
                <img src="/notice/qq-group-2.png" alt={`QQ群 ${QQ_GROUP} 的二维码`} width={160} height={160} />
                <span>扫一扫，或者点二维码加群</span>
              </a>
            );
          case "p":
            return (
              <p key={i} className={b.thanks ? "notice-thanks" : undefined}>
                <Inline parts={b.parts} />
              </p>
            );
        }
      })}
    </div>
  );
}

function Inline({ parts }: { parts: NoticeInline[] }) {
  return parts.map((p, i) =>
    p.kind === "bold" ? (
      <strong key={i}>{p.text}</strong>
    ) : p.kind === "link" ? (
      <a key={i} href={p.href} {...OUT}>
        {p.text}
      </a>
    ) : (
      <Fragment key={i}>{p.text}</Fragment>
    ),
  );
}
