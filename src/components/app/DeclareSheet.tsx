"use client";

import { useState } from "react";
import { declarationText, type Declaration, type Template } from "@/lib/declarations";
import { GAME_NAMES, GAMES, type Game } from "@/lib/games";
import type { Profile } from "@/lib/profile";
import { DECLARATION_RADIUS_KM } from "@/lib/rules";
import { titlesFor } from "@/lib/titles";
import Sheet from "./Sheet";

export default function DeclareSheet({
  profile,
  hasMain,
  onSend,
  onEditProfile,
  onClose,
}: {
  profile: Profile;
  hasMain: boolean;
  onSend: (d: Declaration) => Promise<boolean>;
  onEditProfile: () => void;
  onClose: () => void;
}) {
  const favourites = profile.games.flatMap((g) => profile.favourites[g].map((name) => ({ name, game: g })));
  const [template, setTemplate] = useState<Template>("launch");
  const [game, setGame] = useState<Game>(profile.games[0] ?? "arknights");
  const [character, setCharacter] = useState(favourites[0]?.name ?? "");
  const characterGame = favourites.find((f) => f.name === character)?.game ?? "arknights";
  const titles = titlesFor(characterGame);
  const [pickedTitle, setTitle] = useState(titles[0]);
  // 博士 only fits Arknights characters and 管理员 Endfield ones
  const title = titles.includes(pickedTitle) ? pickedTitle : titles[0];
  const [sending, setSending] = useState(false);

  const d: Declaration = template === "iam" ? { template, character, title } : { template, game };
  const canSend = hasMain && (template !== "iam" || Boolean(character));

  const gameSelect = (
    <select value={game} onChange={(e) => setGame(e.target.value as Game)} aria-label="游戏">
      {GAMES.map((g) => (
        <option key={g} value={g}>
          {GAME_NAMES[g]}
        </option>
      ))}
    </select>
  );

  const send = async () => {
    setSending(true);
    const ok = await onSend(d);
    setSending(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      title="独立宣言"
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={send} disabled={!canSend || sending}>
          {hasMain ? "发表宣言" : "先放下蟑螂本体才能发表"}
        </button>
      }
    >
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        向你的蟑螂本体 {DECLARATION_RADIUS_KM} 公里内的所有舟p喊一句话。
      </p>

      <label className={`tpl ${template === "launch" ? "on" : ""}`}>
        <input type="radio" name="tpl" checked={template === "launch"} onChange={() => setTemplate("launch")} />
        {template === "launch" ? gameSelect : GAME_NAMES[game]}，启动！
      </label>

      <label className={`tpl ${template === "iam" ? "on" : ""} ${favourites.length ? "" : "off"}`}>
        <input
          type="radio"
          name="tpl"
          checked={template === "iam"}
          disabled={!favourites.length}
          onChange={() => setTemplate("iam")}
        />
        我是
        <select
          value={character}
          onChange={(e) => setCharacter(e.target.value)}
          onFocus={() => setTemplate("iam")}
          disabled={!favourites.length}
          aria-label="厨力角色"
        >
          {favourites.length ? (
            favourites.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))
          ) : (
            <option value="">厨力角色</option>
          )}
        </select>
        的
        <select
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => favourites.length && setTemplate("iam")}
          aria-label="称呼"
        >
          {titles.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {!favourites.length && (
        <p className="hint" style={{ marginTop: -2, marginBottom: 8 }}>
          这句要先在资料里选厨力角色。
          <button className="pill" style={{ marginLeft: 6 }} onClick={onEditProfile}>
            去选
          </button>
        </p>
      )}

      <label className={`tpl ${template === "alsoplay" ? "on" : ""}`}>
        <input type="radio" name="tpl" checked={template === "alsoplay"} onChange={() => setTemplate("alsoplay")} />
        原来，你也玩{template === "alsoplay" ? gameSelect : GAME_NAMES[game]}
      </label>

      <div className="shout">「{declarationText(d)}」</div>
      <p className="hint">
        {DECLARATION_RADIUS_KM} 公里内有蟑螂（本体或克隆体）的舟p，下次打开地图时会收到。TA 们只知道是 {DECLARATION_RADIUS_KM}{" "}
        公里内的某只舟p，不知道你是谁、在哪，可以碰你一下回应。
      </p>
    </Sheet>
  );
}
