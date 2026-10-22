"use client";

import { useState, type ReactNode } from "react";
import { declarationText, FOODS, WELCOME_NAMES, type Declaration, type Food, type Template } from "@/lib/declarations";
import { GAME_NAMES, GAMES, type Game } from "@/lib/games";
import { displayName, type Profile } from "@/lib/profile";
import { DECLARATION_RADIUS_KM } from "@/lib/rules";
import { titlesFor } from "@/lib/titles";
import type { OwnRoach } from "@/lib/world/types";
import Sheet from "./Sheet";

/** Sentences whose blank is one of the sender's favourite characters */
const WITH_CHARACTER: Template[] = ["iam", "love", "buff", "canyou", "eat"];

export default function DeclareSheet({
  profile,
  roaches,
  onSend,
  onEditProfile,
  onClose,
}: {
  profile: Profile;
  roaches: OwnRoach[];
  onSend: (d: Declaration, from: string[]) => Promise<boolean>;
  onEditProfile: () => void;
  onClose: () => void;
}) {
  const main = roaches.find((r) => r.slot === 0);
  const clones = roaches.filter((r) => r.slot > 0);
  const all = roaches.map((r) => r.id);
  const [from, setFrom] = useState<string[]>(main ? [main.id] : []);
  const allOn = all.length > 0 && all.every((id) => from.includes(id));
  const toggle = (id: string) => setFrom((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const favourites = profile.games.flatMap((g) => profile.favourites[g].map((name) => ({ name, game: g })));
  const named = !profile.anonymous && Boolean(profile.name.trim());
  const [template, setTemplate] = useState<Template>("launch");
  const [game, setGame] = useState<Game>(profile.games[0] ?? "arknights");
  const [character, setCharacter] = useState(favourites[0]?.name ?? "");
  const characterGame = favourites.find((f) => f.name === character)?.game ?? "arknights";
  const titles = titlesFor(characterGame);
  const [pickedTitle, setTitle] = useState(titles[0]);
  const title = titles.includes(pickedTitle) ? pickedTitle : titles[0];
  const [food, setFood] = useState<Food>(FOODS[0]);
  const [sending, setSending] = useState(false);

  const d: Declaration = (() => {
    switch (template) {
      case "iam":
        return { template, character, title };
      case "love":
      case "buff":
      case "canyou":
        return { template, character };
      case "eat":
        return { template, character, food };
      case "myname":
        return { template, game, name: displayName(profile) };
      case "birthday":
        return { template };
      default:
        return { template: template === "welcome" ? "welcome" : "launch", game };
    }
  })();
  const blocked = (t: Template) => (WITH_CHARACTER.includes(t) && !favourites.length) || (t === "myname" && !named);
  const canSend = Boolean(main) && from.length > 0 && !blocked(template);

  const send = async () => {
    setSending(true);
    const ok = await onSend(d, from);
    setSending(false);
    if (ok) onClose();
  };

  // Blanks show as ___ until their sentence is picked
  const blank = (t: Template, picker: ReactNode) => (template === t ? picker : <span className="muted">___</span>);
  const pick = (t: Template) => () => !blocked(t) && setTemplate(t);
  const gameSelect = (t: Template) =>
    blank(
      t,
      <select value={game} onChange={(e) => setGame(e.target.value as Game)} aria-label="游戏">
        {GAMES.map((g) => (
          <option key={g} value={g}>
            {GAME_NAMES[g]}
          </option>
        ))}
      </select>,
    );
  const characterSelect = (t: Template) =>
    blank(
      t,
      <select value={character} onChange={(e) => setCharacter(e.target.value)} aria-label="厨力角色">
        {favourites.map((f) => (
          <option key={`${f.game}-${f.name}`} value={f.name}>
            {f.name}
          </option>
        ))}
      </select>,
    );
  const row = (t: Template, body: ReactNode) => (
    <label key={t} className={`tpl ${template === t ? "on" : ""} ${blocked(t) ? "off" : ""}`} onClick={pick(t)}>
      <input type="radio" name="tpl" checked={template === t} disabled={blocked(t)} onChange={pick(t)} />
      {body}
    </label>
  );

  return (
    <Sheet
      title="独立宣言"
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={send} disabled={!canSend || sending}>
          {!main ? "先放下蟑螂本体才能发表" : from.length ? "发表宣言" : "选一只蟑螂来发"}
        </button>
      }
    >
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        {clones.length
          ? `向你选的蟑螂周围 ${DECLARATION_RADIUS_KM} 公里内的所有舟p喊一句话。`
          : `向你的蟑螂本体 ${DECLARATION_RADIUS_KM} 公里内的所有舟p喊一句话。`}
      </p>

      {main && clones.length > 0 && (
        <div className="chips" style={{ marginBottom: 12 }} role="group" aria-label="从哪只蟑螂发">
          <button className={`chip ${from.includes(main.id) ? "on" : ""}`} onClick={() => toggle(main.id)}>
            本体
          </button>
          {clones.map((c, i) => (
            <button key={c.id} className={`chip ${from.includes(c.id) ? "on" : ""}`} onClick={() => toggle(c.id)}>
              克隆体 {i + 1}
            </button>
          ))}
          <button className={`chip ${allOn ? "on" : ""}`} onClick={() => setFrom(allOn ? [main.id] : all)}>
            全部
          </button>
        </div>
      )}

      {row("launch", <>{gameSelect("launch")}，启动！</>)}
      {row(
        "iam",
        <>
          我是{characterSelect("iam")}的
          {blank(
            "iam",
            <select value={title} onChange={(e) => setTitle(e.target.value)} aria-label="称呼">
              {titles.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>,
          )}
        </>,
      )}
      {row("love", <>我永远喜欢{characterSelect("love")}</>)}
      {row("buff", <>加强{characterSelect("buff")}</>)}
      {row(
        "myname",
        <>
          我是{named ? displayName(profile) : "（你的名字）"}，我要玩{gameSelect("myname")}
        </>,
      )}
      {row(
        "welcome",
        <>
          欢迎回家，
          {blank(
            "welcome",
            <select value={game} onChange={(e) => setGame(e.target.value as Game)} aria-label="称呼">
              {GAMES.map((g) => (
                <option key={g} value={g}>
                  {WELCOME_NAMES[g]}
                </option>
              ))}
            </select>,
          )}
        </>,
      )}
      {row("canyou", <>{characterSelect("canyou")}做得到吗？</>)}
      {row(
        "eat",
        <>
          我想吃{characterSelect("eat")}的
          {blank(
            "eat",
            <select value={food} onChange={(e) => setFood(e.target.value as Food)} aria-label="吃的">
              {FOODS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>,
          )}
        </>,
      )}
      {row("birthday", <>祝我生日快乐</>)}

      {(!favourites.length || !named) && (
        <p className="hint" style={{ marginTop: -2, marginBottom: 8 }}>
          {!favourites.length && "带角色的句子要先在资料里选厨力角色。"}
          {!named && "「我是…，我要玩…」要先在资料里填名字，并且不选匿名。"}
          <button className="pill" style={{ marginLeft: 6 }} onClick={onEditProfile}>
            去资料
          </button>
        </p>
      )}
      {template === "myname" && <p className="hint">这句会让收到的人看到你的名字。</p>}

      <div className="shout">「{declarationText(d)}」</div>
      <p className="hint">
        {DECLARATION_RADIUS_KM} 公里内有蟑螂（本体或克隆体）的舟p都会收到：开着网页的马上收到，没开的下次打开时收到，同一个人只收到一次。TA
        们只知道是 {DECLARATION_RADIUS_KM} 公里内的某只舟p，可以回应你或者碰你一下。
      </p>
    </Sheet>
  );
}
