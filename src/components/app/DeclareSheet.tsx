"use client";

import { useState, type ReactNode } from "react";
import { fmt, fmtParts, T } from "@/i18n";
import { characterName, foodName, spouseName, titleName } from "@/i18n/names";
import { fmtNodes } from "@/i18n/nodes";
import {
  declarationText,
  FOODS,
  isStayTemplate,
  SPOUSES,
  stayNeeded,
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
import { INK_FROM } from "@/lib/si";
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
  ink = false,
  initialFrom,
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
  /** Their ink roach is on the map at 缘缘庄: it goes out from there too, as INK_FROM, when picked */
  ink?: boolean;
  /** Picked to begin with (墨小强's card opens this with it) */
  initialFrom?: string[];
  onSend: (d: Declaration, from: string[]) => Promise<boolean>;
  onEditProfile: () => void;
  onClose: () => void;
}) {
  const main = roaches.find((r) => r.slot === 0);
  const clones = roaches.filter((r) => r.slot > 0);
  const all = [...roaches.map((r) => r.id), ...(ink ? [INK_FROM] : [])];
  // nothing picked to begin with, but what the card opened it with: you choose which of your roaches it goes out from each time
  const [from, setFrom] = useState<string[]>(() => (initialFrom ?? []).filter((id) => all.includes(id)));
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
      <select value={game} onChange={(e) => setGame(e.target.value as Game)} aria-label={T.declare.gameLabel}>
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
      <select value={character} onChange={(e) => setCharacter(e.target.value)} aria-label={T.declare.characterLabel}>
        {favourites.map((f) => (
          <option key={`${f.game}-${f.name}`} value={f.name}>
            {characterName(f.name)}
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
      title={T.declare.title}
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={send} disabled={!canSend || sending}>
          {!main ? T.declare.placeFirst : from.length ? T.declare.send : T.declare.pickRoach}
        </button>
      }
    >
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        {clones.length || ink
          ? fmt(T.declare.introMany, { km: DECLARATION_RADIUS_KM })
          : fmt(T.declare.introMain, { km: DECLARATION_RADIUS_KM })}
      </p>

      {main && (
        <div className="chips" style={{ marginBottom: 12 }} role="group" aria-label={T.declare.from}>
          <button className={`chip ${from.includes(main.id) ? "on" : ""}`} onClick={() => toggle(main.id)}>
            {T.common.main}
          </button>
          {clones.map((c, i) => (
            <button key={c.id} className={`chip ${from.includes(c.id) ? "on" : ""}`} onClick={() => toggle(c.id)}>
              {fmtParts(T.common.cloneN, { n: i + 1 })}
            </button>
          ))}
          {ink && (
            <button className={`chip ${from.includes(INK_FROM) ? "on" : ""}`} onClick={() => toggle(INK_FROM)}>
              {T.common.ink}
            </button>
          )}
          {(clones.length > 0 || ink) && (
            <button className={`chip ${allOn ? "on" : ""}`} onClick={() => setFrom(allOn ? [] : all)}>
              {T.declare.all}
            </button>
          )}
        </div>
      )}

      {drunk && (
        <div className="drunk-group" role="group" aria-label={T.declare.drunk.title}>
          <div className="drunk-tag">{T.declare.drunk.tag}</div>
          {row("water", <>{T.declare.line.water}</>)}
          {row("drunklove", <>{fmtNodes(T.declare.line.drunklove, { character: characterSelect("drunklove") })}</>)}
          {row(
            "kr168",
            <>
              {fmtNodes(T.declare.line.kr168, {
                character: characterSelect("kr168"),
                spouse: blank(
                  "kr168",
                  <select value={spouse} onChange={(e) => setSpouse(e.target.value as Spouse)} aria-label={T.declare.spouseLabel}>
                    {SPOUSES.map((x) => (
                      <option key={x} value={x}>
                        {spouseName(x)}
                      </option>
                    ))}
                  </select>,
                ),
              })}
            </>,
          )}
          {row("radar", <>{T.declare.line.radar}</>)}
          {row("roguelike", <>{T.declare.line.roguelike}</>)}
          {row("xianshu", <>{T.declare.line.cup}</>)}
          {/* one span, so the long line wraps beside its button rather than under it */}
          {row("rental", <span className="tpl-long">{T.declare.line.roaches}</span>)}
        </div>
      )}

      {events.map((e) => (
        <div key={e.id} className="limited-group" role="group" aria-label={fmt(T.declare.limitedTitle, { event: e.name })}>
          <div className="limited-tag">{T.map.declare.limited}</div>
          {e.lines.map(eventRow)}
        </div>
      ))}

      {row("launch", <>{fmtNodes(T.declare.line.launch, { game: gameSelect("launch") })}</>)}
      {row(
        "iam",
        <>
          {fmtNodes(T.declare.line.iam, {
            character: characterSelect("iam"),
            title: blank(
              "iam",
              <select value={title} onChange={(e) => setTitle(e.target.value)} aria-label={T.declare.titleLabel}>
                {titles.map((x) => (
                  <option key={x} value={x}>
                    {titleName(x)}
                  </option>
                ))}
              </select>,
            ),
          })}
        </>,
      )}
      {row("love", <>{fmtNodes(T.declare.line.love, { character: characterSelect("love") })}</>)}
      {row("buff", <>{fmtNodes(T.declare.line.buff, { character: characterSelect("buff") })}</>)}
      {row(
        "myname",
        <>
          {fmtNodes(T.declare.line.myname, { name: named ? displayName(profile) : T.declare.yourName, game: gameSelect("myname") })}
        </>,
      )}
      {row(
        "welcome",
        <>
          {fmtNodes(T.declare.line.welcome, {
            title: blank(
              "welcome",
              <select value={game} onChange={(e) => setGame(e.target.value as Game)} aria-label={T.declare.titleLabel}>
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
      {row("canyou", <>{fmtNodes(T.declare.line.canyou, { character: characterSelect("canyou") })}</>)}
      {row(
        "eat",
        <>
          {fmtNodes(T.declare.line.eat, {
            character: characterSelect("eat"),
            food: blank(
              "eat",
              <select value={food} onChange={(e) => setFood(e.target.value as Food)} aria-label={T.declare.foodLabel}>
                {FOODS.map((f) => (
                  <option key={f} value={f}>
                    {foodName(f)}
                  </option>
                ))}
              </select>,
            ),
          })}
        </>,
      )}
      {row("birthday", <>{T.declare.line.birthday}</>)}

      <div className="stay-group" role="group" aria-label={T.declare.inn.title}>
        <div className="stay-tag">{T.declare.inn.tag}</div>
        {row("sihouse", <>{T.declare.line.innBig}</>)}
        {row("simine", <>{T.declare.line.innSi}</>)}
        {!stayed && <p className="hint stay-note">{stayNeeded()}</p>}
      </div>

      {(!favourites.length || !named) && (
        <p className="hint" style={{ marginTop: -2, marginBottom: 8 }}>
          {!favourites.length && T.declare.needsCharacter}
          {!named && T.declare.needsName}
          <button className="pill" style={{ marginLeft: 6 }} onClick={onEditProfile}>
            {T.declare.toProfile}
          </button>
        </p>
      )}
      {template === "myname" && <p className="hint">{T.declare.showsName}</p>}
      {template === "birthday" && <p className="hint">{T.declare.toFriends}</p>}

      <div className="shout">{fmtParts(T.common.quoted, { text: declarationText(d) })}</div>
      <p className="hint">
        {fmtParts(T.declare.reach, { km: DECLARATION_RADIUS_KM })}
      </p>
    </Sheet>
  );
}
