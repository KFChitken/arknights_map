"use client";
/* eslint-disable @next/next/no-img-element -- the site's own small pictures, shown as they are */

import type { ReactNode } from "react";
import { fmt, T } from "@/i18n";
import { badgeById } from "@/lib/badges";
import { LISTEN_DEFAULTS } from "@/lib/listen";
import type { Page2 } from "@/lib/pamphlet";
import { MODE_KINDS } from "@/lib/squadMode";
import RoachIcon from "../RoachIcon";
import { HaimaoFigure } from "./Haimao";
import { DancePlayIcon, FirePlayIcon, FishPlayIcon, ModePlayIcon, StackPlayIcon } from "./squad/SquadPlays";
import "./pamphlet2.css";

/**
 * 最近更新 第 2 期's pictures (src/lib/pamphlet.ts), drawn here as 第 1 期's are in Pamphlet.tsx: in a box of
 * 330 × 220 (the cover's, 330 × 128), with the site's own small pictures and words, and its 玩 tiles' icons; nothing
 * read from the map, and nothing the site does not already have (no character art).
 */

/** The cover: a disco ball over five roaches dancing in its lights */
export function CoverArt2() {
  return (
    <div className="pp-art pa2-cover">
      <svg className="beams" viewBox="0 0 330 128" aria-hidden="true">
        <path d="M165 34 L58 124 L112 124 Z" fill="#ff4fd8" opacity="0.28" />
        <path d="M165 34 L146 124 L186 124 Z" fill="#3fd0ff" opacity="0.32" />
        <path d="M165 34 L218 124 L272 124 Z" fill="#ffd23f" opacity="0.42" />
      </svg>
      <Ball className="ball" size={52} />
      <span className="ground" />
      <img className="r1" src="/avatars/doctor.webp" alt="" />
      <span className="r2">
        <RoachIcon color="pink" size={56} />
      </span>
      <img className="r3" src="/avatars/endmin.webp" alt="" />
      <span className="r4">
        <RoachIcon color="cyan" size={56} />
      </span>
      <img className="r5" src="/avatars/imp.webp" alt="" />
      <Note className="n1" />
      <Note className="n2" />
      <Note className="n3" />
    </div>
  );
}

/** A page's picture; until the reader comes near its page, only its paper */
export function Art2({ page, drawn, roomMax = LISTEN_DEFAULTS.roomMax }: { page: Page2; drawn: boolean; roomMax?: number }) {
  const art: Record<Page2, () => ReactNode> = {
    squad: () => <ArtSquad />,
    plays: () => <ArtPlays />,
    listen: () => <ArtListen max={roomMax} />,
    disco: () => <ArtDisco />,
    passes: () => <ArtPasses />,
    study: () => <ArtStudy />,
    haimao: () => <ArtHaimao />,
    fish: () => <ArtFish />,
    profile: () => <ArtProfile />,
  };
  return <div className={`pp-art pa2-${page}`}>{drawn && art[page]()}</div>;
}

/** 听歌's disco's ball: its facets, a shine, and the string it hangs from */
function Ball({ className, size }: { className: string; size: number }) {
  return (
    <svg className={className} viewBox="0 0 52 64" width={size} height={(size * 64) / 52} aria-hidden="true">
      <path d="M26 0 V12" stroke="#1b1d22" strokeWidth="2" />
      <circle cx="26" cy="38" r="24" fill="#c9ced8" stroke="#1b1d22" strokeWidth="2.2" />
      <path d="M4 30 H48 M2.6 38 H49.4 M4 46 H48 M9 54 H43 M9 22 H43" stroke="#7d8594" strokeWidth="1.2" />
      <path d="M26 14 Q14 38 26 62 M26 14 Q38 38 26 62 M26 14 Q2 38 26 62 M26 14 Q50 38 26 62" fill="none" stroke="#7d8594" strokeWidth="1.2" />
      <path d="M13 27 l4 -3 l3 4 l-4 3 Z" fill="#ffffff" />
      <path d="M32 44 l3 -2 l2 3 l-3 2 Z" fill="#ffd23f" />
      <path d="M18 47 l3 -2 l2 3 l-3 2 Z" fill="#ff4fd8" />
      <path d="M36 25 l3 -2 l2 3 l-3 2 Z" fill="#3fd0ff" />
    </svg>
  );
}

function Note({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M6 3 L13 1.5 V10" fill="none" stroke="#1b1d22" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M6 3 V12.5" stroke="#1b1d22" strokeWidth="1.6" />
      <ellipse cx="4.2" cy="12.8" rx="2.4" ry="1.9" fill="#1b1d22" />
      <ellipse cx="11.2" cy="10.4" rx="2.4" ry="1.9" fill="#1b1d22" />
    </svg>
  );
}

/** A room on 一起卫戍's list: 难度 and how the host wants to play, four seats, three taken and ready, and 三缺一 */
function ArtSquad() {
  const t = T.squad;
  const seats = ["doctor", "endmin", "imp"] as const;
  return (
    <>
      <div className="room">
        <div className="head">
          <b>{t.levels[2]}</b>
          <span>{t.tags[1]}</span>
          <i>{t.list.lastOne}</i>
        </div>
        <div className="seats">
          {seats.map((a, k) => (
            <div key={a} className="seat">
              <span className="sq">
                <img src={`/avatars/${a}.webp`} alt="" />
              </span>
              <span className={k === 0 ? "tag host" : "tag"}>{k === 0 ? t.list.host : t.room.inGameTag}</span>
            </div>
          ))}
          <div className="seat open">
            <span className="sq">
              <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                <path d="M10 4 V16 M4 10 H16" stroke="#1b1d22" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </span>
            <span className="tag">{t.list.join}</span>
          </div>
        </div>
      </div>
      <div className="say">{t.say.lines[4]}</div>
      <div className="chips">
        <span>{t.list.music}</span>
        <span>{fmt(t.list.keyAge, { n: 3 })}</span>
      </div>
      <div className="go">{t.list.join}</div>
    </>
  );
}

/** 「玩」 in a room: those always there, then the matches, one waiting for people */
function ArtPlays() {
  const t = T.squad;
  const anytime: [string, ReactNode][] = [
    [T.fish.pond.fish, <FishPlayIcon key="fish" look="line" />],
    [t.fire.play, <FirePlayIcon key="fire" look="big" />],
    [t.stack.title, <StackPlayIcon key="stack" />],
    [t.dance.title, <DancePlayIcon key="dance" />],
  ];
  return (
    <>
      <p className="grp g1">{t.plays.anytime}</p>
      <div className="tiles t1">
        {anytime.map(([name, icon], k) => (
          <span key={name} className="tile">
            {icon}
            {k === 1 && <em>{fmt(t.plays.level, { n: 12 })}</em>}
            <b>{name}</b>
          </span>
        ))}
      </div>
      <p className="grp g2">{t.plays.oneAtATime}</p>
      <div className="tiles t2">
        {MODE_KINDS.map((kind, k) => (
          <span key={kind} className="tile">
            <ModePlayIcon kind={kind} />
            {k === 0 && <em className="wait">{fmt(t.modes.waitTag, { n: 2 })}</em>}
            <b>{t.modes.names[kind]}</b>
          </span>
        ))}
      </div>
    </>
  );
}

/** 听歌: a record turning, its lists, and a 一起听 (of max at most) with its people and a 短评 */
function ArtListen({ max }: { max: number }) {
  const l = T.listen;
  return (
    <>
      <div className="disc" aria-hidden="true">
        <span className="label">
          <Note className="dn" />
        </span>
      </div>
      <div className="lists">
        <span className="on">{l.lists.fav}</span>
        <span>{l.lists.hot}</span>
        <span>{l.lite}</span>
      </div>
      <div className="bar">
        <i />
      </div>
      <div className="keys" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="18" height="18">
          <path d="M14 4 L6 10 L14 16 Z" fill="#1b1d22" />
        </svg>
        <span className="play">
          <svg viewBox="0 0 20 20" width="18" height="18">
            <path d="M6.5 4.5 H8.6 V15.5 H6.5 Z M11.4 4.5 H13.5 V15.5 H11.4 Z" fill="#ffffff" />
          </svg>
        </span>
        <svg viewBox="0 0 20 20" width="18" height="18">
          <path d="M6 4 L14 10 L6 16 Z" fill="#1b1d22" />
        </svg>
      </div>
      <div className="room">
        <span className="pill">{fmt(T.pamphlet.two.art.listenNow, { n: 5, max })}</span>
        <span className="faces">
          {(["doctor", "endmin", "imp", "gugu"] as const).map((a) => (
            <img key={a} src={`/avatars/${a}.webp`} alt="" />
          ))}
          <span className="hood">
            <RoachIcon color="gold" size={26} />
          </span>
        </span>
      </div>
      <div className="rx">{l.rx[0][2]}</div>
    </>
  );
}

/** The disco: the ball, its beams and spots over the dark, and the roaches dancing under them */
function ArtDisco() {
  return (
    <>
      <svg className="beams" viewBox="0 0 330 220" aria-hidden="true">
        <path d="M165 52 L26 220 L104 220 Z" fill="#ff4fd8" opacity="0.32" />
        <path d="M165 52 L138 220 L194 220 Z" fill="#3fd0ff" opacity="0.3" />
        <path d="M165 52 L226 220 L304 220 Z" fill="#ffd23f" opacity="0.34" />
      </svg>
      <span className="spot s1" />
      <span className="spot s2" />
      <span className="spot s3" />
      <span className="spot s4" />
      <Ball className="ball" size={60} />
      <img className="d1" src="/avatars/doctor.webp" alt="" />
      <span className="d2">
        <RoachIcon color="pink" size={52} />
      </span>
      <img className="d3" src="/avatars/endmin.webp" alt="" />
      <span className="d4">
        <RoachIcon color="cyan" size={52} />
      </span>
      <img className="d5" src="/avatars/gugu.webp" alt="" />
      <span className="floor" />
      <Note className="n1" />
      <Note className="n2" />
    </>
  );
}

/** Our own mark: two feelers over a little head, in a ring (as on the back of a pass) */
function Feelers({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M20 30.5c-4.6 0-7.4-3.2-7.4-7.2 0-3.6 3-6.3 7.4-6.3s7.4 2.7 7.4 6.3c0 4-2.8 7.2-7.4 7.2z" fill="currentColor" />
      <path d="M17.2 17.6C15.4 11.6 12 8.4 7.6 8.2M22.8 17.6c1.8-6 5.2-9.2 9.6-9.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** A pass face down, one turned over in its 镭射 look with its number, the tickets, and the wish list's 保底 */
function ArtPasses() {
  const a = T.pamphlet.two.art;
  return (
    <>
      <div className="back">
        <Feelers className="mark" />
        <small>PASS</small>
      </div>
      <div className="laser">
        <span className="tag">{a.passLaser}</span>
        <Feelers className="mark" />
        <span className="site">ZHOUP MAP</span>
        <span className="no">{fmt(a.passNo, { no: "000325" })}</span>
        <i className="corner" />
      </div>
      <div className="ticket">
        <b>{fmt(a.passTickets, { n: 10 })}</b>
      </div>
      <div className="wish" aria-hidden="true">
        {Array.from({ length: 6 }, (_, k) => (
          <i key={k} className={k === 2 ? "got" : undefined} />
        ))}
      </div>
      <div className="pity">
        <span>{fmt(a.passPity, { n: 27 })}</span>
        <span className="track">
          <i />
        </span>
      </div>
    </>
  );
}

const STUDY_BADGES = ["study7", "study14", "study30", "study90", "study180", "study325"] as const;
const STUDY_DAYS = [7, 14, 30, 90, 180, 325];

/** A page of a 作业本: the 3.25 秒停表 stopped on it, the days studied, and the six titles, the first got */
function ArtStudy() {
  return (
    <>
      <div className="watch" aria-hidden="true">
        <span className="knob" />
        <span className="face">
          <b>3.25</b>
          <small>{T.study.stopwatch.exact}</small>
        </span>
      </div>
      <div className="days">{fmt(T.pamphlet.two.art.studyDays, { n: 7 })}</div>
      <div className="seals">
        {STUDY_BADGES.map((id, k) => (
          <span key={id} className={k === 0 ? "got" : undefined}>
            <img src={`/badges/${id}.svg`} alt="" width={50} height={50} />
            <small>{k === 0 ? badgeById(id)?.name : fmt(T.pamphlet.two.art.studyAt, { n: STUDY_DAYS[k] })}</small>
          </span>
        ))}
      </div>
    </>
  );
}

/** 香艳制作人 singing, her ALL 转盘 and her 好感度 (the line that goes under who she is, under the page's words) */
function ArtHaimao() {
  const h = T.guides.haimao;
  const slices = 7;
  return (
    <>
      <span className="glow" />
      <span className="her">
        <HaimaoFigure size={150} singing />
      </span>
      <div className="sing">{h.dame.singing}</div>
      <svg className="wheel" viewBox="0 0 120 128" aria-hidden="true">
        {Array.from({ length: slices }, (_, k) => {
          const a0 = ((k / slices) * 2 - 0.5) * Math.PI - Math.PI / slices;
          const a1 = a0 + (2 * Math.PI) / slices;
          const p = (a: number) => `${(60 + 54 * Math.cos(a)).toFixed(1)} ${(68 + 54 * Math.sin(a)).toFixed(1)}`;
          return <path key={k} d={`M60 68 L${p(a0)} A54 54 0 0 1 ${p(a1)} Z`} fill={["#ff8fc7", "#ffffff", "#c9a7ff", "#ffffff", "#ffd23f", "#ffffff", "#ff8fc7"][k]} stroke="#1b1d22" strokeWidth="1.6" />;
        })}
        <circle cx="60" cy="68" r="17" fill="#1b1d22" />
        <text x="60" y="73" textAnchor="middle" fontSize="13" fontWeight="900" fill="#ffd23f">
          ALL
        </text>
        <path d="M60 18 L53 4 H67 Z" fill="#b0341f" stroke="#1b1d22" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <div className="love">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M8 14 C2 9.6 1 7 1 5.2 A3.4 3.4 0 0 1 8 3.6 A3.4 3.4 0 0 1 15 5.2 C15 7 14 9.6 8 14 Z" fill="#ff4f8b" />
        </svg>
        {fmt(T.pamphlet.two.art.haimaoLove, { n: 13 })}
      </div>
    </>
  );
}

/** 龙门外环's bank: the line in the water, the float bitten with its yellow ring, and what came up */
function ArtFish() {
  const f = T.fish;
  return (
    <>
      <span className="water" />
      <svg className="waves" viewBox="0 0 330 100" aria-hidden="true">
        <path d="M0 18 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="#9fd3f7" strokeWidth="2" />
        <path d="M14 52 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="#9fd3f7" strokeWidth="2" opacity="0.7" />
      </svg>
      <div className="sign">
        <b>{f.scene.sign}</b>
      </div>
      <svg className="line" viewBox="0 0 180 160" aria-hidden="true">
        <path d="M6 8 L52 40" stroke="#7a4a22" strokeWidth="4" strokeLinecap="round" />
        <path d="M52 40 Q100 52 118 132" fill="none" stroke="#1b1d22" strokeWidth="1.6" />
      </svg>
      <span className="ring" />
      <svg className="float" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M11.5 22a8.5 8.2 0 0 1 17 0Z" fill="#ff4a2e" />
        <path d="M11.5 22a8.5 8.2 0 0 0 17 0Z" fill="#fff" />
        <path d="M11.5 22a8.5 8.2 0 0 1 17 0a8.5 8.2 0 0 1-17 0Z" fill="none" stroke="#1b1d22" strokeWidth="1.5" />
      </svg>
      <div className="bang">{f.bang}</div>
      <div className="catch">
        <img src="/fish/koi.webp" alt="" />
        <b>{f.items.koi.name}</b>
        <span className="kg">9.41 kg</span>
        <span className="first">{f.firstTime}</span>
      </div>
      <div className="hint">{T.pamphlet.two.art.fishRing}</div>
    </>
  );
}

/** The new 我的资料: who sees what of you, 触须之交's picked, and 我的记录's last seven days */
function ArtProfile() {
  const p = T.profile2;
  const bars = [3, 6, 2, 8, 5, 9, 4];
  return (
    <>
      <div className="segs">
        {(["stranger", "bold", "friend"] as const).map((k) => (
          <span key={k} className={k === "friend" ? "on" : undefined}>
            {p.segs[k]}
          </span>
        ))}
      </div>
      <div className="card">
        <img src="/avatars/doctor.webp" alt="" />
        <span className="who">
          <b>{T.pamphlet.two.art.squadWho}</b>
          <span className="worn">{badgeById("study30")?.name}</span>
        </span>
        <span className="seen">{p.corner.friend}</span>
      </div>
      <div className="rec">
        <div className="top">
          <b>{T.pamphlet.two.art.profileWeek}</b>
          <span>{T.pamphlet.two.art.profileOnly}</span>
        </div>
        <div className="bars" aria-hidden="true">
          {bars.map((h, k) => (
            <span key={k} className={k === 5 ? "on" : undefined}>
              <i style={{ height: `${h * 4}px` }} />
              <small>{T.records.weekdays[(k + 1) % 7]}</small>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
