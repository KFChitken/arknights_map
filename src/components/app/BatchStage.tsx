"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { fmtParts, T } from "@/i18n";
import type { BatchAct } from "@/lib/friendly";
import { miniHeart } from "@/lib/touchArt";
import type { DrawnAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../RoachIcon";
import { star, vial } from "./DockFx";

/** How long a 一键 plays */
export const BATCH_MS = 2200;
/** Their roaches drawn around yours; the rest is 「+N」 */
const SHOWN = 6;
const RADIUS = 112;

const html = (markup: string) => ({ dangerouslySetInnerHTML: { __html: markup } });

/** A 寻访券, as on the map's 寻访 button, flying out to one of them */
const ticket = (size: number) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><g transform="rotate(-14 12 12)"><path d="M3.5 7.2c0-.8.6-1.4 1.4-1.4h14.2c.8 0 1.4.6 1.4 1.4v2.4a2.4 2.4 0 0 0 0 4.8v2.4c0 .8-.6 1.4-1.4 1.4H4.9c-.8 0-1.4-.6-1.4-1.4v-2.4a2.4 2.4 0 0 0 0-4.8Z" fill="#ffd23f" stroke="#1b1d22" stroke-width="0.9"/><path d="M9.2 7.4v9.2" stroke="#1b1d22" stroke-width="1.3" stroke-dasharray="1.5 1.5"/></g></svg>`;

type Look = { color: RoachColor; avatar: DrawnAvatar };

/**
 * 一键 (src/lib/friendly.ts) on your own screen, once however many it went to: your roach in
 * the middle, a ring of theirs around it (at most SHOWN, the rest as 「+N」). 贴贴 hearts fly out
 * to them, 击掌 a 「啪！」 by each, 吸欧气 stars fly in from them, 送券 a 寻访券 flies out to each,
 * 催理智 bottles fly off in every direction with 叮！. A tap ends it.
 */
export default function BatchStage({ act, you, them, onDone }: { act: BatchAct; you: Look; them: Look[]; onDone: () => void }) {
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  useEffect(() => {
    const t = window.setTimeout(finish, BATCH_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = them.slice(0, SHOWN);
  const more = them.length - shown.length;
  const places = shown.length + (more > 0 ? 1 : 0);
  // round the ring from the top, clockwise
  const spot = (i: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(places, 1);
    return { "--x": `${Math.round(Math.cos(a) * RADIUS)}px`, "--y": `${Math.round(Math.sin(a) * RADIUS)}px` } as CSSProperties;
  };
  const delay = (i: number, from = 0.25) => ({ animationDelay: `${from + i * 0.12}s` });

  let fx = null;
  if (act === "hug") fx = shown.map((_, i) => <div key={i} className="bs-fly" style={{ ...spot(i), ...delay(i) }} {...html(miniHeart(22))} />);
  else if (act === "highfive")
    fx = shown.map((_, i) => (
      <div key={i} className="bs-pa" style={{ ...spot(i), ...delay(i, 0.45) }}>
        {T.fx.pa}
      </div>
    ));
  else if (act === "gift") fx = shown.map((_, i) => <div key={i} className="bs-fly" style={{ ...spot(i), ...delay(i) }} {...html(ticket(22))} />);
  else if (act === "luck")
    fx = (
      <>
        {shown.map((_, i) => (
          <div key={i} className="bs-fly in" style={{ ...spot(i), ...delay(i) }} {...html(star(18))} />
        ))}
        <div className="bs-label">{fmtParts(T.fx.luck, { n: them.length })}</div>
      </>
    );
  else
    fx = (
      <>
        {shown.map((_, i) => (
          <div key={i} className="bs-fly" style={{ ...spot(i), ...delay(i, 0.15) }} {...html(vial(20))} />
        ))}
        <div className="bs-label bs-ding">{T.fx.ding}</div>
      </>
    );

  return (
    <>
      <button type="button" className="ta-skip" aria-label={T.fx.skip} onPointerDown={finish} onWheel={finish} />
      <div className="bs-stage" style={{ "--dur": `${BATCH_MS}ms` } as CSSProperties} aria-hidden="true">
        <div className="bs-you">
          <RoachIcon color={you.color} avatar={you.avatar} size={84} mine />
        </div>
        {shown.map((t, i) => (
          <div key={i} className="bs-friend" style={spot(i)}>
            {/* 击掌: each hops as the 啪！ comes */}
            <div className={act === "highfive" ? "bs-hop" : undefined} style={act === "highfive" ? delay(i, 0.3) : undefined}>
              <RoachIcon color={t.color} avatar={t.avatar} size={46} friend />
            </div>
          </div>
        ))}
        {more > 0 && (
          <div className="bs-more" style={spot(shown.length)}>
            +{more}
          </div>
        )}
        {fx}
      </div>
    </>
  );
}
