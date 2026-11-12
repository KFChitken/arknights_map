"use client";

import { useEffect, useState } from "react";
import { fmtParts } from "@/i18n";
import { chineseDate, portraitTitle, SI_LINES, STAMPS, STAMPS_PER_ROUND, stampAt } from "@/lib/si";
import { SEAL_RED } from "@/lib/siArt";
import type { RoachAvatar } from "@/lib/types";
import type { SiMe } from "@/lib/world/types";
import Sheet from "./Sheet";

/**
 * Your 集章本 from 祀掌柜 (src/lib/si.ts), for your eyes only: first the portrait she painted as you became 触须之交
 * (her own self-portrait instead, given by mistake, until you give it back or keep it; kept, it has a page of its
 * own after yours), then this round's 30 places for her seals, those she stamped showing them, today's marked.
 * The portraits are painted here on a canvas, in your look as it is now, and can be saved as a picture.
 */

/** The seals' and the portraits' own characters (public/fonts/si-seal.woff2, scripts/si-seal-font.py), then the system's Song */
export const SEAL_FONT = "SiSeal, 'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', STSong, SimSun, serif";

const PAPER = "#f7f1e3";
const INK = "#24221f";

// ---- the seals ----

/**
 * One of her seals, 朱文 (red characters inside a red border, on the paper), its characters in columns read top
 * to bottom from the right: one, two or three in a column, four as two columns. tilt: as stamped by hand (degrees)
 */
export function Seal({ text, size, tilt = 0 }: { text: string; size: number; tilt?: number }) {
  const chars = [...text];
  const cols = chars.length === 4 ? 2 : 1;
  const rows = Math.ceil(chars.length / cols);
  const cell = 20;
  const w = cols * cell + 6;
  const h = rows * cell + 6;
  const scale = size / Math.max(w, h);
  return (
    <svg className="si-seal" width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} style={{ transform: `rotate(${tilt}deg)` }} aria-label={`「${text}」`} role="img">
      <rect x="1.4" y="1.4" width={w - 2.8} height={h - 2.8} rx="1.8" fill="none" stroke={SEAL_RED} strokeWidth="2.2" strokeDasharray="17 0.8 9 0.6 23 0.9" />
      {chars.map((c, i) => {
        const col = cols - 1 - Math.floor(i / rows);
        const row = i % rows;
        return (
          <text
            key={i}
            x={3 + col * cell + cell / 2}
            y={3 + row * cell + cell * 0.84}
            textAnchor="middle"
            fontSize={cell * 0.9}
            fontFamily={SEAL_FONT}
            fontWeight={700}
            fill={SEAL_RED}
          >
            {c}
          </text>
        );
      })}
    </svg>
  );
}

/** A little hand-stamped slant for the k-th seal, the same every time */
const slant = (k: number) => (((k * 7919) % 11) - 5) * 0.8;

// ---- the portraits ----

const picture = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** Wings painted on the back of her self-portrait, behind the figure, the way she would have liked */
function wings(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.save();
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineCap = "round";
  for (const side of [-1, 1]) {
    g.save();
    g.translate(cx, cy);
    g.scale(side, 1);
    // the wing's shape in a wash, then its feathers in firmer strokes
    g.globalAlpha = 0.16;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(s * 0.35, -s * 0.55, s * 0.95, -s * 0.62, s * 1.05, -s * 0.3);
    g.bezierCurveTo(s * 0.9, -s * 0.1, s * 0.8, s * 0.05, s * 0.55, s * 0.18);
    g.bezierCurveTo(s * 0.35, s * 0.22, s * 0.15, s * 0.12, 0, 0);
    g.fill();
    g.globalAlpha = 0.7;
    g.lineWidth = s * 0.028;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(s * 0.35, -s * 0.55, s * 0.95, -s * 0.62, s * 1.05, -s * 0.3);
    g.stroke();
    g.lineWidth = s * 0.018;
    for (let k = 0; k < 5; k++) {
      const t = 0.3 + k * 0.17;
      g.beginPath();
      g.moveTo(s * t * 0.9, -s * (0.45 - k * 0.03));
      g.quadraticCurveTo(s * (t * 0.8), s * 0.02, s * (t * 0.55), s * (0.12 + k * 0.01));
      g.stroke();
    }
    g.restore();
  }
  g.restore();
}

/** Characters one under another from (x, y), as big as fit in `height` up to `size` */
function column(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, height: number) {
  const chars = [...text];
  const s = Math.min(size, height / Math.max(1, chars.length) / 1.08);
  g.font = `700 ${s}px ${SEAL_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "top";
  chars.forEach((c, i) => g.fillText(c, x, y + i * s * 1.08));
  return y + chars.length * s * 1.08;
}

/**
 * A portrait as she paints it, on a sheet of paper 3 : 4: the ink picture of a look (hers: the hood with wings on
 * its back), down the right its title and the day, and her 「祀」 seal under them
 */
export async function paintPortrait(opts: { look: RoachAvatar; title: string; at: number; hers: boolean }) {
  const W = 720;
  const H = 960;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  // mounted paper
  g.fillStyle = "#e6dcc5";
  g.fillRect(0, 0, W, H);
  g.fillStyle = PAPER;
  g.fillRect(28, 28, W - 56, H - 56);
  g.strokeStyle = "#d8c9a6";
  g.lineWidth = 2;
  g.strokeRect(40, 40, W - 80, H - 80);
  await Promise.allSettled([document.fonts?.load(`700 48px SiSeal`)]);
  const img = await picture(`/avatars/ink-${opts.hers ? "hood" : opts.look}.webp`).catch(() => null);
  // the ground it stands on, in a pale wash, and the figure
  const box = 470;
  const fx = 60;
  const fy = 330;
  g.fillStyle = INK;
  g.globalAlpha = 0.1;
  g.beginPath();
  g.ellipse(fx + box / 2, fy + box - 6, box * 0.42, 22, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  if (opts.hers) wings(g, fx + box / 2, fy + box * 0.42, box * 0.5);
  if (img) g.drawImage(img, fx, fy, box, box);
  // down the right: the title, then the day beside it, then her seal
  g.fillStyle = INK;
  const end = column(g, opts.title, W - 110, 90, 54, 520);
  g.fillStyle = "#4a4640";
  const dateEnd = column(g, chineseDate(opts.at), W - 178, 120, 30, 470);
  const sealY = Math.max(end, dateEnd) + 28;
  const s = 78;
  const x = W - 112 - s / 2;
  g.save();
  g.translate(x + s / 2, sealY + s / 2);
  g.rotate(-0.04);
  g.strokeStyle = SEAL_RED;
  g.lineWidth = 7;
  g.strokeRect(-s / 2 + 4, -s / 2 + 4, s - 8, s - 8);
  g.fillStyle = SEAL_RED;
  g.font = `700 ${s * 0.66}px ${SEAL_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("祀", 0, 3);
  g.restore();
  return c;
}

/** The picture saved: shared to the photos on a phone, downloaded elsewhere */
async function savePicture(c: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) return false;
  const file = new File([blob], `${name}.png`, { type: "image/png" });
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return true;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** What she wrote on her own */
const SELF_TITLE = "自画像";

/** A portrait (yours, titled `title`; or hers, 自画像), painted once for what it shows, with the way to save it */
function Portrait({ look, title, at, hers }: { look: RoachAvatar; title: string; at: number; hers: boolean }) {
  const [art, setArt] = useState<{ key: string; canvas: HTMLCanvasElement; url: string } | null>(null);
  const written = hers ? SELF_TITLE : title;
  const key = `${look}|${written}|${at}|${hers}`;
  useEffect(() => {
    let gone = false;
    void paintPortrait({ look, title: written, at, hers }).then((canvas) => {
      if (!gone) setArt({ key, canvas, url: canvas.toDataURL("image/png") });
    });
    return () => {
      gone = true;
    };
  }, [key, look, written, at, hers]);
  const shown = art?.key === key ? art : null;
  return (
    <figure className="si-portrait">
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element -- painted here, as a data URL, to be long-pressed and saved
        <img src={shown.url} alt={hers ? "祀掌柜的自画像" : title} />
      ) : (
        <div className="si-portrait-wait" aria-label="正在画" />
      )}
      <figcaption>
        <button className="pill" disabled={!shown} onClick={() => shown && void savePicture(shown.canvas, hers ? "祀掌柜自画像" : title)}>
          存成图片
        </button>
        <span className="muted">也可以长按图片保存</span>
      </figcaption>
    </figure>
  );
}

// ---- the book ----

type Page = "portrait" | "self" | "stamps";

/**
 * The book itself. name: yours as the map shows it (null: anonymous or none); look: your main roach's now.
 * onAnswer: give her self-portrait back or keep it (the server's answer is her line, said over her head too).
 */
export function SiBookSheet({
  si,
  userId,
  name,
  look,
  onAnswer,
  onClose,
}: {
  si: SiMe;
  userId: string;
  name: string | null;
  look: RoachAvatar;
  onAnswer: (choice: "return" | "keep") => Promise<string | null>;
  onClose: () => void;
}) {
  const portrait = si.portrait;
  const pages: Page[] = ["portrait", ...(portrait?.state === "kept" ? (["self"] as const) : []), "stamps"];
  const [page, setPage] = useState(0);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const at = Math.min(page, pages.length - 1);
  const shown = pages[at];
  const title = portraitTitle(name);

  const answer = async (choice: "return" | "keep") => {
    setBusy(true);
    const line = await onAnswer(choice);
    setBusy(false);
    if (line) setSaid(line);
  };

  // this round's places, and how far the book is stamped
  const total = si.stamps;
  const round = total > 0 ? Math.floor((total - 1) / STAMPS_PER_ROUND) : 0;
  const inRound = total - round * STAMPS_PER_ROUND;

  return (
    <Sheet
      title="集章本"
      onClose={onClose}
      footer={
        pages.length > 1 && (
          <div className="si-book-pager">
            <button className="pill" disabled={at === 0} onClick={() => setPage(at - 1)}>
              上一页
            </button>
            <span className="muted">
              {at + 1} / {pages.length}
            </span>
            <button className="pill" disabled={at === pages.length - 1} onClick={() => setPage(at + 1)}>
              下一页
            </button>
          </div>
        )
      }
    >
      {shown === "portrait" &&
        (!portrait ? (
          <p className="muted si-book-note">大胆碰她，成为触须之交，她会送你一幅画像。</p>
        ) : portrait.state === "wrong" ? (
          <div className="stack">
            <p className="si-says">{SI_LINES.portraitWrong}</p>
            <Portrait look={look} title={title} at={portrait.at} hers />
            <div className="consent-actions">
              <button className="primary" disabled={busy} onClick={() => void answer("return")}>
                还给她
              </button>
              <button className="pill" disabled={busy} onClick={() => void answer("keep")}>
                就不还
              </button>
            </div>
          </div>
        ) : (
          <div className="stack">
            {said && <p className="si-says">{said}</p>}
            <Portrait look={look} title={title} at={portrait.at} hers={false} />
          </div>
        ))}
      {shown === "self" && portrait && (
        <div className="stack">
          <p className="muted si-book-note">她的自画像，没还给她。</p>
          <Portrait look={look} title={title} at={portrait.at} hers />
        </div>
      )}
      {shown === "stamps" && (
        <div className="stack">
          <p className="muted si-book-note">
            {fmtParts("一共盖了 {n} 个章 · {round}这一轮 {inRound} / {per}", { n: total.toLocaleString(), round: round > 0 ? `第 ${round + 1} 轮，` : "", inRound: inRound, per: STAMPS_PER_ROUND })}
          </p>
          <ol className="si-stamps">
            {Array.from({ length: STAMPS_PER_ROUND }, (_, i) => {
              const k = round * STAMPS_PER_ROUND + i;
              const stamped = i < inRound;
              const today = stamped && si.stampedToday && k === total - 1;
              const text = STAMPS[stampAt(userId, k)];
              return (
                <li key={i} className={stamped ? (today ? "today" : "stamped") : "empty"}>
                  {stamped ? <Seal text={text} size={44} tilt={slant(k)} /> : <span className="muted">{i + 1}</span>}
                  {today && <small>今天</small>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Sheet>
  );
}
