"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { T } from "@/i18n";
import { HAIMAO, HAIMAO_LAYERS, HAIMAO_LINES, HAIMAO_LOVE_MAX, HAIMAO_VIEWBOX, haimaoLayerClass, haimaoLayerUrl } from "@/lib/haimao";
import { FRIEND, HEART } from "@/lib/roachSvg";
import type { HaimaoMe } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";
import { playSound, setSoundOn, soundOn } from "./haimaoSound";
import Sheet from "./Sheet";

/** 香艳制作人 (src/lib/haimao.ts) on the page: her Q figure, her card, and the card that tells players she is here. */

/**
 * Her Q figure, size px square, its tentacles and gull moving (globals.css .hm-l); her still picture, or the hood when
 * that is off too, once a layer will not load. friend: a 触须之交's pink ground in place of her shadow, and a heart.
 */
export function HaimaoFigure({ size, friend = false }: { size: number; friend?: boolean }) {
  const [plain, setPlain] = useState(false);
  if (plain) return <RoachIcon color={HAIMAO.color} size={size} avatar={HAIMAO.avatar} friend={friend} />;
  return (
    <svg className="hm-fig" viewBox={HAIMAO_VIEWBOX} width={size} height={size} aria-hidden="true">
      {friend && <ellipse cx="32" cy="54.4" rx="15" ry="3.2" fill={FRIEND} stroke="#1b1d22" strokeWidth="1.2" />}
      {HAIMAO_LAYERS.filter((l) => !(friend && l.part === "shadow")).map((l) => (
        <image
          key={l.part}
          className={haimaoLayerClass(l.part)}
          href={haimaoLayerUrl(l.part)}
          x={l.x}
          y={l.y}
          width={l.w}
          height={l.h}
          preserveAspectRatio="none"
          onError={() => setPlain(true)}
        />
      ))}
      {friend && <g dangerouslySetInnerHTML={{ __html: HEART }} />}
    </svg>
  );
}

/** Her figure on her card, a button: her gull says 喵, out loud and in a bubble */
function GullButton({ size, friend }: { size: number; friend: boolean }) {
  const [meowing, setMeowing] = useState(0);
  useEffect(() => {
    if (!meowing) return;
    const t = window.setTimeout(() => setMeowing(0), 1400);
    return () => window.clearTimeout(t);
  }, [meowing]);
  return (
    <button
      type="button"
      className="hm-avatar"
      aria-label={T.guides.haimao.gull}
      onClick={() => {
        playSound("meow", true);
        setMeowing(Date.now());
      }}
    >
      <HaimaoFigure size={size} friend={friend} />
      {meowing > 0 && (
        <span key={meowing} className="hm-meow" aria-live="polite">
          {HAIMAO_LINES.meow}
        </span>
      )}
    </button>
  );
}

/**
 * Her card, the same for everyone who opens it: who she is (and who she is not, word for word), her 个性签名, the
 * 好感度 she keeps for you once you are signed in, and the two touches, with her sounds' 静音 kept in this browser.
 * Visitors see it all but her 好感度, and are asked to sign in as they touch her.
 */
export function HaimaoCard({
  me,
  friend,
  signedIn,
  waiting,
  touching,
  sharesUid,
  onTouch,
  onSignIn,
  onOpenFriend,
  under,
  onClose,
}: {
  me: HaimaoMe | null;
  friend: boolean;
  signedIn: boolean;
  waiting: boolean;
  touching: boolean;
  sharesUid: boolean;
  onTouch: (bold: boolean) => void;
  onSignIn: () => void;
  onOpenFriend?: () => void;
  /** Roaches under her picture: to pick one of them (StackUnderGuide) */
  under?: ReactNode;
  onClose: () => void;
}) {
  const [sound, setSound] = useState(true);
  // what this browser keeps, read once in it
  useEffect(() => setSound(soundOn()), []);
  const love = me ? Math.min(HAIMAO_LOVE_MAX, Math.max(0, me.love)) : null;
  return (
    <div className="card stack haimao-card" role="dialog" aria-label={HAIMAO.name}>
      <div className="card-head">
        <GullButton size={56} friend={friend} />
        <div>
          <strong>{HAIMAO.name}</strong>
          <p className="muted">{HAIMAO.note}</p>
          <button
            type="button"
            className="hm-mute"
            aria-pressed={!sound}
            onClick={() => {
              setSoundOn(!sound);
              setSound(!sound);
            }}
          >
            {sound ? T.guides.haimao.mute : T.guides.haimao.unmute}
          </button>
        </div>
      </div>
      <p className="hm-sign">
        <span>{T.guides.haimao.signature}</span>
        <b>{HAIMAO_LINES.signature}</b>
      </p>
      <p className="hm-note">{HAIMAO_LINES.disclaimer}</p>
      {love !== null && (
        <div className="hm-love">
          <span>{T.guides.haimao.love}</span>
          <span
            className="hm-bar"
            role="meter"
            aria-label={T.guides.haimao.love}
            aria-valuemin={0}
            aria-valuemax={HAIMAO_LOVE_MAX}
            aria-valuenow={love}
          >
            <i style={{ width: `${(love / HAIMAO_LOVE_MAX) * 100}%` }} />
          </span>
          <b>{love}</b>
          <span className="muted">/{HAIMAO_LOVE_MAX}</span>
        </div>
      )}
      {onOpenFriend && (
        <div className="row-actions">
          <button className="pill" onClick={onOpenFriend}>
            {T.common.seeThem}
          </button>
        </div>
      )}
      <div className="touch-buttons">
        <button disabled={touching || waiting} onClick={() => (signedIn ? onTouch(false) : onSignIn())}>
          {T.common.reachSneaky}
          <small>{T.guides.haimao.sneakyNote}</small>
        </button>
        <button disabled={touching || waiting} className="bold" onClick={() => (signedIn ? onTouch(true) : onSignIn())}>
          {T.common.reachBold}
          <small>{sharesUid ? T.guides.haimao.boldUid : T.guides.haimao.bold}</small>
        </button>
      </div>
      {under}
      <button className="close" onClick={onClose} aria-label={T.common.close}>
        ×
      </button>
    </div>
  );
}

/** Once in each browser, for every signed-in player with a main roach she shows to, after the other guides' cards. */
export function HaimaoIntroSheet({ onGo, onLater }: { onGo: () => void; onLater: () => void }) {
  const [picture, setPicture] = useState(true);
  const ref = useRef<HTMLImageElement>(null);
  // a picture that failed before the page could listen
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && !img.naturalWidth) setPicture(false);
  }, []);
  return (
    <Sheet title={T.guides.haimao.introTitle} onClose={onLater}>
      <div className="amiya-greet">
        {picture ? (
          // her face from her picture as she was first drawn, from the server's own folder; her Q figure when it is off
          <span className="hm-intro-pic">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={ref} src={HAIMAO_BASE} alt="" onError={() => setPicture(false)} />
          </span>
        ) : (
          <HaimaoFigure size={96} />
        )}
      </div>
      <p className="consent-place">{HAIMAO_LINES.introCard}</p>
      <p className="hm-note hm-note-c">{HAIMAO_LINES.disclaimer}</p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onGo}>
          {T.guides.haimao.goSee}
        </button>
        <button className="pill" onClick={onLater}>
          {T.common.later}
        </button>
      </div>
    </Sheet>
  );
}

/** Her picture as she was first drawn (立绘), for her introduction */
const HAIMAO_BASE = "/guide-art/haimao-base.webp?v=1";

// ---- what this browser remembers about her, per player ----

const introKey = (userId: string) => `zhoup.haimaoIntro.${userId}`;

export function haimaoIntroShown(userId: string) {
  try {
    return localStorage.getItem(introKey(userId)) === "1";
  } catch {
    // without storage, rather say it happened than repeat it on every visit
    return true;
  }
}
export function markHaimaoIntroShown(userId: string) {
  try {
    localStorage.setItem(introKey(userId), "1");
  } catch {}
}

/** 清掉我和香艳制作人的记录 (local testing only) */
export function forgetHaimaoHere(userId: string) {
  try {
    localStorage.removeItem(introKey(userId));
  } catch {}
}
