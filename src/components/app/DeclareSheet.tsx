"use client";

import { useState, type ReactNode } from "react";
import { fmtParts } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import {
  declarationText,
  FOODS,
  isStayTemplate,
  SPOUSES,
  STAY_NEEDED,
  WELCOME_NAMES,
  type Declaration,
  type Food,
  type Spouse,
  type Template,
} from "@/lib/declarations";
import { activeEvents, untilText, type EventLine } from "@/lib/events";
import { GAME_NAMES, GAMES, type Game } from "@/lib/games";
import { displayName, type Profile } from "@/lib/profile";
import { DECLARATION_RADIUS_KM } from "@/lib/rules";
import { titlesFor } from "@/lib/titles";
import type { OwnRoach } from "@/lib/world/types";
import Sheet from "./Sheet";

/** Sentences whose blank is one of the sender's favourite characters */
const WITH_CHARACTER: Template[] = ["iam", "love", "buff", "canyou", "eat", "drunklove", "kr168"];

export default function DeclareSheet({
  profile,
  roaches,
  initial,
  drunk = false,
  stayed = false,
  onSend,
  onEditProfile,
  onClose,
}: {
  profile: Profile;
  roaches: OwnRoach[];
  /** The sentence picked to begin with, such as 欢迎回家 for a player just back */
  initial?: Template;
  /** The main roach lies drunk: its own lines come first */
  drunk?: boolean;
  /** Their ink roach has had a room at 缘缘庄 (src/lib/si.ts): 祀掌柜's two are theirs; everyone sees them, greyed till then */
  stayed?: boolean;
  onSend: (d: Declaration, from: string[]) => Promise<boolean>;
  onEditProfile: () => void;
  onClose: () => void;
}) {
  const main = roaches.find((r) => r.slot === 0);
  const clones = roaches.filter((r) => r.slot > 0);
  const all = roaches.map((r) => r.id);
  // nothing picked to begin with: you choose which of your roaches it goes out from each time
  const [from, setFrom] = useState<string[]>([]);
  const allOn = all.length > 0 && all.every((id) => from.includes(id));
  const toggle = (id: string) => setFrom((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const favourites = profile.games.flatMap((g) => profile.favourites[g].map((name) => ({ name, game: g })));
  const named = !profile.anonymous && Boolean(profile.name.trim());
  // while an event is on, its first line is picked to begin with
  const [events] = useState(() => activeEvents());
  const [line, setLine] = useState(events[0]?.lines[0]?.id ?? "");
  const [template, setTemplate] = useState<Template>(initial ?? (drunk ? "water" : events.length ? "event" : "launch"));
  const [game, setGame] = useState<Game>(profile.games[0] ?? "arknights");
  const [character, setCharacter] = useState(favourites[0]?.name ?? "");
  const characterGame = favourites.find((f) => f.name === character)?.game ?? "arknights";
  const titles = titlesFor(characterGame);
  const [pickedTitle, setTitle] = useState(titles[0]);
  const title = titles.includes(pickedTitle) ? pickedTitle : titles[0];
  const [food, setFood] = useState<Food>(FOODS[0]);
  const [spouse, setSpouse] = useState<Spouse>(SPOUSES[0]);
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
      case "event":
        return { template, line };
      case "drunklove":
        return { template, character };
      case "kr168":
        return { template, character, spouse };
      case "water":
      case "radar":
      case "roguelike":
      case "xianshu":
      case "rental":
      case "sihouse":
      case "simine":
        return { template };
      default:
        return { template: template === "welcome" ? "welcome" : "launch", game };
    }
  })();
  const blocked = (t: Template) =>
    (WITH_CHARACTER.includes(t) && !favourites.length) || (t === "myname" && !named) || (isStayTemplate(t) && !stayed);
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
  // anyone with a main roach can send these, so they are never greyed out
  const eventRow = (l: EventLine) => {
    const on = template === "event" && line === l.id;
    const choose = () => {
      setTemplate("event");
      setLine(l.id);
    };
    return (
      <label key={l.id} className={`tpl limited ${on ? "on" : ""}`} onClick={choose}>
        <input type="radio" name="tpl" checked={on} onChange={choose} />
        <span className="limited-line">
          {l.text}
          {/* each game's line ends with that game's version */}
          <small>
            {GAME_NAMES[l.game]} · {untilText(l)}
          </small>
        </span>
      </label>
    );
  };

  return (
    <Sheet
      title="我宣布个事儿"
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={send} disabled={!canSend || sending}>
          {!main ? "先放下蟑螂本体才能发表" : from.length ? "发表宣言" : "选一只蟑螂来发"}
        </button>
      }
    >
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        {clones.length
          ? `先选从哪几只蟑螂发，会向它们周围 ${DECLARATION_RADIUS_KM} 公里内的所有舟P喊一句话。`
          : `先选从本体发，会向它周围 ${DECLARATION_RADIUS_KM} 公里内的所有舟P喊一句话。`}
      </p>

      {main && (
        <div className="chips" style={{ marginBottom: 12 }} role="group" aria-label="从哪只蟑螂发">
          <button className={`chip ${from.includes(main.id) ? "on" : ""}`} onClick={() => toggle(main.id)}>
            本体
          </button>
          {clones.map((c, i) => (
            <button key={c.id} className={`chip ${from.includes(c.id) ? "on" : ""}`} onClick={() => toggle(c.id)}>
              {fmtParts("克隆体 {n}", { n: i + 1 })}
            </button>
          ))}
          {clones.length > 0 && (
            <button className={`chip ${allOn ? "on" : ""}`} onClick={() => setFrom(allOn ? [] : all)}>
              全部
            </button>
          )}
        </div>
      )}

      {drunk && (
        <div className="drunk-group" role="group" aria-label="醉酒限定宣言">
          <div className="drunk-tag">醉酒限定</div>
          {row("water", <>这白开水怎么没味啊？</>)}
          {row("drunklove", <>{fmtNodes("我永远喜欢{character}！", { character: characterSelect("drunklove") })}</>)}
          {row(
            "kr168",
            <>
              {fmtNodes("氪了168，{character}{spouse}回家家", {
                character: characterSelect("kr168"),
                spouse: blank(
                  "kr168",
                  <select value={spouse} onChange={(e) => setSpouse(e.target.value as Spouse)} aria-label="老婆还是老公">
                    {SPOUSES.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>,
                ),
              })}
            </>,
          )}
          {row("radar", <>我的方舟雷达💡的一下响了</>)}
          {row("roguelike", <>我要打集成战略！</>)}
          {row("xianshu", <>我要看仙术杯！</>)}
          {/* one span, so the long line wraps beside its button rather than under it */}
          {row("rental", <span className="tpl-long">我的出租屋里真的有很多蟑螂，但我认识的粥批真的没有几个</span>)}
        </div>
      )}

      {events.map((e) => (
        <div key={e.id} className="limited-group" role="group" aria-label={`${e.name}限定宣言`}>
          <div className="limited-tag">限定</div>
          {e.lines.map(eventRow)}
        </div>
      ))}

      {row("launch", <>{fmtNodes("{game}，启动！", { game: gameSelect("launch") })}</>)}
      {row(
        "iam",
        <>
          {fmtNodes("我是{character}的{title}", {
            character: characterSelect("iam"),
            title: blank(
              "iam",
              <select value={title} onChange={(e) => setTitle(e.target.value)} aria-label="称呼">
                {titles.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>,
            ),
          })}
        </>,
      )}
      {row("love", <>{fmtNodes("我永远喜欢{character}", { character: characterSelect("love") })}</>)}
      {row("buff", <>{fmtNodes("加强{character}", { character: characterSelect("buff") })}</>)}
      {row(
        "myname",
        <>
          {fmtNodes("我是{name}，我要玩{game}", { name: named ? displayName(profile) : "（你的名字）", game: gameSelect("myname") })}
        </>,
      )}
      {row(
        "welcome",
        <>
          {fmtNodes("欢迎回家，{title}", {
            title: blank(
              "welcome",
              <select value={game} onChange={(e) => setGame(e.target.value as Game)} aria-label="称呼">
                {GAMES.map((g) => (
                  <option key={g} value={g}>
                    {WELCOME_NAMES[g]}
                  </option>
                ))}
              </select>,
            ),
          })}
        </>,
      )}
      {row("canyou", <>{fmtNodes("{character}做得到吗？", { character: characterSelect("canyou") })}</>)}
      {row(
        "eat",
        <>
          {fmtNodes("我想吃{character}的{food}", {
            character: characterSelect("eat"),
            food: blank(
              "eat",
              <select value={food} onChange={(e) => setFood(e.target.value as Food)} aria-label="吃的">
                {FOODS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>,
            ),
          })}
        </>,
      )}
      {row("birthday", <>祝我生日快乐</>)}

      <div className="stay-group" role="group" aria-label="缘缘庄住客的宣言">
        <div className="stay-tag">缘缘庄住客</div>
        {row("sihouse", <>你家还挺大的嘛？</>)}
        {row("simine", <>疯狂新妻祀是我的！</>)}
        {!stayed && <p className="hint stay-note">{STAY_NEEDED}</p>}
      </div>

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
      {template === "birthday" && <p className="hint">这句你所有的触须之交都会收到，不管离多远，而且知道是你发的。</p>}

      <div className="shout">{fmtParts("「{text}」", { text: declarationText(d) })}</div>
      <p className="hint">
        {fmtParts("{km} 公里内有蟑螂（本体或克隆体）的舟P都会收到：开着网页的马上收到，没开的下次打开时收到，同一个人只收到一次。TA 们只知道是 {km} 公里内的某只舟P，可以回应你或者碰你一下。", { km: DECLARATION_RADIUS_KM })}
      </p>
    </Sheet>
  );
}
