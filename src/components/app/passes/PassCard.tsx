"use client";
/* eslint-disable @next/next/no-img-element -- the site's own pictures, shown as they are */

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { T } from "@/i18n";
import { passArtUrl, passColor, type PassArtList } from "@/lib/passArt";
import { GAME_OF, type PassChar } from "@/lib/passCatalog";
import { goldKind, isFoil, padNo, styleFor, type PassOnCard } from "@/lib/passes";
import { useLeanArt } from "@/lib/passLean";
import type { Art } from "../OperatorNames";
import "./pass.css";

/**
 * A pass, small (2:3: the results of a draw, the wish list, 我的通行证, profile cards) or whole (popped up from a
 * profile card or 我的通行证, a wish held up): ① 通行认证 for a character of 明日方舟, ③ 长条挂牌 for one of 终末地, and
 * their special looks ② ④ (fancy: two copies or more, src/lib/passes.ts isFancy). Gold numbers (goldKind) add a gold corner
 * or chip, nothing else. Everything inside is sized in cqw (pass.css), so one looks the same at any width.
 * The picture is the character's 立绘 (src/lib/passArt.ts), its blur first and the picture fading in over it, or the
 * blur alone to save data (src/lib/passLean.ts); without one, their small picture (/operator-art), else a figure in
 * their colour. Which characters have a 立绘 comes once a page (usePassArt), handed to the passes inside PassArtProvider.
 */

let artPending: Promise<PassArtList> | null = null;

/** The 立绘 there are (/api/pass-art), asked once a page; null while on its way, and empty when it could not be had */
export function usePassArt(): PassArtList | null {
  const [list, setList] = useState<PassArtList | null>(null);
  useEffect(() => {
    let live = true;
    artPending ??= fetch("/api/pass-art")
      .then((res) => (res.ok ? (res.json() as Promise<PassArtList>) : {}))
      .catch(() => {
        // asked again the next time a page wants them
        artPending = null;
        return {};
      });
    artPending.then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);
  return list;
}

const PassArtContext = createContext<PassArtList | null>(null);
/** The 立绘 there are (usePassArt), for every pass inside */
export const PassArtProvider = PassArtContext.Provider;

/** A figure drawn in the character's colour, where there is no picture of them */
const FIGURE =
  "M150 40c-30 0-50 22-50 54 0 22 6 38 14 50-30 10-52 34-60 70-6 26-8 60-8 106h208c0-46-2-80-8-106-8-36-30-60-60-70 8-12 14-28 14-50 0-32-20-54-50-54z";

/** Dark or white words on a block of a colour (#rrggbb), by how light it is */
export function inkOf(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => {
    const x = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? "#15181d" : "#ffffff";
}

/** The character's small round picture's address, where there is one */
export function artUrl(c: PassChar, art: Art | null): string | null {
  const file = art?.[GAME_OF[c.game]]?.[c.name];
  return file ? `/operator-art/${file}` : null;
}

/** What a pass's picture is made of: the 立绘's files (null: none), else the small picture's address */
export type PassPic = { file: string | null; avatar: string | null };
export const picOf = (c: PassChar, passArt: PassArtList | null, art: Art | null): PassPic => ({
  file: passArt?.[c.id]?.[0] ?? null,
  avatar: artUrl(c, art),
});

/** The address to fetch ahead for a pass about to be shown small */
export const smallUrl = (pic: PassPic, lean: boolean) => (pic.file ? passArtUrl(pic.file, lean ? "blur" : "small") : pic.avatar);

function Picture({ pic, big }: { pic: PassPic; big?: boolean }) {
  const [shown, setShown] = useState<string | null>(null);
  const lean = useLeanArt();
  if (pic.file) {
    const on = lean || shown === pic.file;
    const file = pic.file;
    return (
      <div className={`art lh${on ? " in" : ""}${lean ? " lean" : ""}`}>
        <img className="bl" src={passArtUrl(file, "blur")} alt="" draggable={false} />
        {!lean &&
          (big ? (
            <picture>
              <source type="image/avif" srcSet={passArtUrl(file, "big", "avif")} />
              <img className="fg" src={passArtUrl(file, "big")} alt="" decoding="async" draggable={false} onLoad={() => setShown(file)} />
            </picture>
          ) : (
            <img className="fg" src={passArtUrl(file, "small")} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setShown(file)} />
          ))}
      </div>
    );
  }
  if (pic.avatar) {
    return (
      <div className="art">
        <img src={pic.avatar} alt="" loading="lazy" decoding="async" draggable={false} />
      </div>
    );
  }
  return (
    <div className="art drawn">
      <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
        <path d={FIGURE} transform="translate(0 80)" />
      </svg>
    </div>
  );
}

export function MiniPass({
  c,
  no,
  fancy,
  art,
  pic,
  color,
  className,
}: {
  c: PassChar;
  /** null leaves the number off (a wish not drawn yet) */
  no: number | null;
  fancy: boolean;
  /** the small round pictures (OperatorNames useOperatorArt) */
  art: Art | null;
  /** its picture and colour, when they came with the pass (a profile card's): else the 立绘 there are (PassArtProvider) */
  pic?: PassPic;
  color?: string;
  className?: string;
}) {
  const passArt = useContext(PassArtContext);
  const style = styleFor(c.game, fancy);
  const pc = color ?? passColor(passArt, c);
  const corner = no !== null && isFoil(no) && <i className="mfo" aria-hidden="true" />;
  const number = no !== null && <b>{padNo(no)}</b>;
  const vars = { "--pc": pc, "--pk": style === "rax" ? "#1b2330" : inkOf(pc) } as CSSProperties;
  const picture = <Picture pic={pic ?? picOf(c, passArt, art)} />;
  return (
    <div className={`mp${className ? ` ${className}` : ""}`} aria-hidden="true">
      {style === "ra" || style === "rax" ? (
        <div className={`mpc ra${style === "rax" ? " rax" : ""}`} style={vars}>
          {picture}
          <span className="mra-t">ZHOUP MAP</span>
          <i className="mra-l" />
          <i className="mra-p" />
          {number}
          {corner}
        </div>
      ) : (
        <div className={`mpc tag${style === "tagx" ? " tagx" : ""}`} style={vars}>
          {picture}
          <i className="mtg-b" />
          <i className="mtg-k" />
          <i className="mtg-f" />
          {number}
          {corner}
        </div>
      )}
    </div>
  );
}

/** Our own mark: two feelers over a little head, in a ring */
export function Feelers({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M20 30.5c-4.6 0-7.4-3.2-7.4-7.2 0-3.6 3-6.3 7.4-6.3s7.4 2.7 7.4 6.3c0 4-2.8 7.2-7.4 7.2z" fill="currentColor" />
      <path
        d="M17.2 17.6C15.4 11.6 12 8.4 7.6 8.2M22.8 17.6c1.8-6 5.2-9.2 9.6-9.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A pass face down, before it is turned over */
export function CardBack() {
  return (
    <div className="zb">
      <Feelers />
      <small>PASS</small>
    </div>
  );
}

/** The day a pass was drawn, as printed on it: 2026.11.20, in Beijing time like the site's days */
export const issued = (at: number) => new Date(at + 8 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, ".");

/** The English name printed big: the English words' one, or a name written in Latin letters alone, in capitals */
export const printedEn = (c: Pick<PassChar, "en" | "name">) => (c.en ?? (/^[\x20-\x7e]+$/.test(c.name) ? c.name : "")).toUpperCase();

const stars = (r: number | null) => (r ? "★".repeat(r) : "");
const gameMark = (c: PassChar) => (c.game === "ak" ? "AK" : "EF");

/** A gold number (src/lib/passes.ts goldKind): 前 100 or 靓号 on a gold chip by the number */
function FoilChip({ no }: { no: number }) {
  const kind = goldKind(no);
  if (!kind) return null;
  return <span className="zfoil">{T.passes.pass.gold[kind]}</span>;
}

/** The strap through the slot of a 通行认证, its buckle, and the label sewn on it */
function HangRa() {
  return (
    <div className="hwr ra" aria-hidden="true">
      <svg viewBox="0 0 60 128">
        <path d="M30 4 L52 40 Q54.5 45 49 45 L11 45 Q5.5 45 8 40 Z" fill="none" stroke="#a9aeb6" strokeOpacity=".45" strokeWidth="7.2" strokeLinejoin="round" />
        <path d="M30 4 L52 40 Q54.5 45 49 45 L11 45 Q5.5 45 8 40 Z" fill="none" stroke="#17181b" strokeWidth="5.2" strokeLinejoin="round" />
        <path d="M20.5 27 L29 12.5" stroke="#9aa0a8" strokeWidth="1.4" strokeLinecap="round" />
        <rect x="14" y="40" width="32" height="88" rx="1.5" fill="#121316" stroke="#ffffff" strokeOpacity=".16" strokeWidth=".8" />
        <rect x="14" y="40" width="32" height="9" fill="#202227" />
        <path d="M16 64h3l7.5-14h-3zM22 64h3l7.5-14h-3zM28 64h3l7.5-14h-3zM34 64h3l7.5-14h-3z" fill="#f4f4f2" />
        <text
          transform="translate(25.8 67.5) rotate(90)"
          style={{ fontFamily: "var(--font-num)" }}
          fontWeight="700"
          fontSize="10.2"
          letterSpacing=".3"
          fill="#f4f4f2"
        >
          ZHOUP MAP
        </text>
        <rect x="46" y="58" width="11" height="36" rx="1" fill="#ebe3cd" stroke="#cdc3a6" strokeWidth=".6" />
        <path d="M49 62v28M52 62v24M55 62v27" stroke="#6d6656" strokeWidth="1.1" strokeDasharray="2.2 1.2" />
        <rect x="9" y="112" width="42" height="16" rx="3.2" fill="#26282d" stroke="#ffffff" strokeOpacity=".14" strokeWidth=".8" />
        <rect x="12" y="115" width="36" height="2" rx="1" fill="#3a3d44" />
      </svg>
    </div>
  );
}

/** The yellow clip and key ring of a 长条挂牌 */
function HangTag() {
  return (
    <div className="hwr tag" aria-hidden="true">
      <svg viewBox="0 0 100 120">
        <g transform="rotate(-34 50 92)">
          <rect x="39" y="0" width="22" height="88" rx="6.5" fill="#f2e21a" stroke="#c7b600" strokeWidth="1.3" />
          <rect x="45.5" y="8" width="9" height="30" rx="3.5" fill="#c7b600" fillOpacity=".55" />
          <path d="M43.5 52h13l-6.5 11z" fill="#c7b600" />
          <rect x="44" y="70" width="12" height="3" rx="1.5" fill="#c7b600" fillOpacity=".7" />
          <circle cx="50" cy="81.5" r="4.2" fill="#3a3d44" fillOpacity=".35" />
        </g>
        <circle cx="50" cy="101" r="15" fill="none" stroke="#c4c8ce" strokeWidth="4.6" />
        <path d="M38 93a15 15 0 0 1 10-7" fill="none" stroke="#f4f6f8" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

type FaceProps = { c: PassChar; no: number; color: string; pic: PassPic; holder: string; at: number };

/** ① 通行认证, and ② its special look (x) */
function RaFace({ c, no, color, pic, holder, at, x }: FaceProps & { x: boolean }) {
  const en = printedEn(c);
  const len = [...c.name].length;
  const gm = gameMark(c);
  const code = `ZHOUP MAP - ${gm}${String(c.id).padStart(3, "0")} · OPERATOR`;
  const ef = en ? Math.min(10.5, 60 / (en.length * 0.47)) : 0;
  const nf = en ? (len <= 4 ? 6.4 : len === 5 ? 5.6 : len === 6 ? 5 : 4.4) : len <= 3 ? 9.4 : len === 4 ? 8.6 : len === 5 ? 7.4 : len === 6 ? 6.4 : 5.4;
  const vars = { "--pc": color, "--pk": x ? "#1b2330" : inkOf(color) } as CSSProperties;
  return (
    <div className={`zc ra${x ? " rax" : ""}`} style={vars}>
      <div className="ra-art">
        <Picture pic={pic} big />
      </div>
      <i className="ra-hole l" />
      <i className="ra-hole r" />
      <i className="slot" />
      <i className="ra-col" />
      <div className="ra-low">
        <i className="ra-bar" />
        <Feelers className="ra-wm" />
        {en ? (
          <>
            <b className="ra-en" style={{ "--ef": `${ef.toFixed(2)}cqw` } as CSSProperties}>
              {en}
            </b>
            <span className="ra-code">{code}</span>
            <span className="ra-cn" style={{ "--nf": `${nf}cqw` } as CSSProperties}>
              {c.name}
              <i>{stars(c.rarity)}</i>
            </span>
          </>
        ) : (
          <>
            <b className="ra-cn big" style={{ "--nf": `${nf}cqw` } as CSSProperties}>
              {c.name}
            </b>
            <span className="ra-code">{code}</span>
            <span className="ra-st">{stars(c.rarity)}</span>
          </>
        )}
        <div className="ra-foot">
          <span className="ra-logo">
            <Feelers />
            ZHOUP
          </span>
          <span className="ra-fine">
            OPERATOR PASS
            <br />
            {T.passes.pass.holder} {holder}
            <br />
            {issued(at)}
          </span>
          <span className="ra-no">
            <FoilChip no={no} />
            <small>No.</small>
            {padNo(no)}
          </span>
        </div>
      </div>
      <span className="ra-big" aria-hidden="true">
        ZHOUP MAP PASS
      </span>
      <span className="ra-edge" aria-hidden="true">
        ZHOUP MAP · {gm}-{padNo(no)}
      </span>
      {x && <i className="ra-holo holo" />}
    </div>
  );
}

/** ③ 长条挂牌, and ④ its special look (x) */
function TagFace({ c, no, color, pic, holder, at, x }: FaceProps & { x: boolean }) {
  const en = printedEn(c);
  const chars = [...c.name];
  const tn = en ? Math.min(17, 132 / (en.length * 0.47)) : Math.min(21, 124 / chars.length);
  const nf = chars.length <= 4 ? 7 : chars.length === 5 ? 6 : chars.length === 6 ? 5.2 : 4.4;
  return (
    <div className={`zc tag${x ? " tagx" : ""}`} style={{ "--pc": color } as CSSProperties}>
      <i className="tg-bg" />
      <div className="tg-art">
        <Picture pic={pic} big />
      </div>
      <i className="slot" />
      <div className="tg-tl">
        <span>ZP</span>
        <span>{gameMark(c)}</span>
      </div>
      <i className="tg-lines" />
      <div className="tg-ticks">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="tg-band">
        <span>OPERATOR · ZHOUP MAP</span>
      </div>
      <span className="tg-plus" aria-hidden="true">
        +
      </span>
      <span className={`tg-name${en ? "" : " cn"}`} style={{ "--tn": `${tn.toFixed(2)}cqw` } as CSSProperties} aria-hidden="true">
        {en || chars.map((ch, i) => <i key={i}>{ch}</i>)}
      </span>
      {x && <i className="tg-holo holo" />}
      <div className="tg-foot">
        <span className="tg-cn" style={{ "--nf": `${nf}cqw` } as CSSProperties}>
          {c.name}
          <i>{stars(c.rarity)}</i>
        </span>
        <span className="tg-no">
          <small>No.</small>
          {padNo(no)}
          <FoilChip no={no} />
        </span>
        <span className="tg-hold">
          {T.passes.pass.holder} {holder} · {issued(at)}
        </span>
      </div>
    </div>
  );
}

const stillMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A whole pass, w wide (a 长条挂牌 0.644 of it, as tall); hang: with its strap or clip above it, as one that pops up;
 * tilt: leaning after the pointer, its shine moving, unless the player asked for less motion. Its picture and colour
 * as MiniPass's: given (a profile card's), else from the 立绘 there are.
 */
export function FullPass({
  c,
  no,
  fancy,
  art = null,
  color,
  pic,
  holder,
  at,
  w,
  hang,
  tilt,
  label,
  children,
}: Omit<FaceProps, "color" | "pic"> & {
  fancy: boolean;
  art?: Art | null;
  color?: string;
  pic?: PassPic;
  w: number;
  hang?: boolean;
  tilt?: boolean;
  label?: string;
  children?: ReactNode;
}) {
  const passArt = useContext(PassArtContext);
  const style = styleFor(c.game, fancy);
  const tall = style === "tag" || style === "tagx";
  const self = useRef<HTMLDivElement>(null);
  const follow = (e: PointerEvent) => {
    const el = self.current;
    if (!tilt || !el || stillMotion()) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    el.style.setProperty("--ry", `${((x - 0.5) * 18).toFixed(1)}deg`);
    el.style.setProperty("--rx", `${((0.5 - y) * 12).toFixed(1)}deg`);
    el.style.setProperty("--hx", `${(x * 100).toFixed(0)}%`);
  };
  const rest = () => {
    for (const v of ["--rx", "--ry", "--hx"]) self.current?.style.removeProperty(v);
  };
  const face: FaceProps = { c, no, color: color ?? passColor(passArt, c), pic: pic ?? picOf(c, passArt, art), holder, at };
  return (
    <div
      ref={self}
      className={`zp${tall ? " s-tag" : ""}${hang ? " hang" : ""}${tilt ? " tilt" : ""}`}
      style={{ "--w": `${w}px` } as CSSProperties}
      role="img"
      aria-label={label}
      onPointerMove={tilt ? follow : undefined}
      onPointerLeave={tilt ? rest : undefined}
      onPointerCancel={tilt ? rest : undefined}
    >
      {hang && (tall ? <HangTag /> : <HangRa />)}
      {tall ? <TagFace {...face} x={style === "tagx"} /> : <RaFace {...face} x={style === "rax"} />}
      {children}
    </div>
  );
}

/** A character as the catalogue has them, from what a worn pass carries (profile cards have no catalogue) */
export const charOfCard = (p: PassOnCard): PassChar => ({ id: p.charId, game: p.game, name: p.name, en: p.en, rarity: p.rarity, color: p.color });
/** A worn pass's picture */
export const picOfCard = (p: PassOnCard): PassPic => ({ file: p.art, avatar: p.avatar ? `/operator-art/${p.avatar}` : null });
