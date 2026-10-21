"use client";

import { useMemo, useState } from "react";
import { GAME_NAMES, GAMES, type Game } from "@/lib/games";
import { OPERATORS } from "@/lib/operators";
import { displayName, type Profile } from "@/lib/profile";
import { GLOW } from "@/lib/roachSvg";
import { MAX_FAVOURITES, NAME_MAX, UID_MAX } from "@/lib/rules";
import { ROACH_AVATARS, ROACH_COLORS, type RoachAvatar, type RoachColor } from "@/lib/types";
import Sheet from "./Sheet";
import RoachIcon from "../RoachIcon";

const AVATAR_NAMES: Record<RoachAvatar, string> = {
  hood: "兜帽",
  doctor: "博士",
  endmin: "管理员",
  imp: "小恶魔",
};

const COLOR_NAMES: Record<RoachColor, string> = {
  cyan: "青色",
  pink: "粉色",
  gold: "金色",
  green: "绿色",
  purple: "紫色",
  orange: "橙色",
  red: "红色",
  white: "白色",
};

export default function ProfileSheet({
  profile,
  onSave,
  onSignOut,
  onDelete,
  onClose,
}: {
  profile: Profile;
  onSave: (p: Profile) => Promise<boolean>;
  onSignOut: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [p, setP] = useState<Profile>(profile);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Profile>) => setP((old) => ({ ...old, ...patch }));
  const toggleGame = (g: Game) =>
    set({ games: p.games.includes(g) ? p.games.filter((x) => x !== g) : GAMES.filter((x) => x === g || p.games.includes(x)) });
  const hasUid = p.games.some((g) => p.uid[g].trim());

  const save = async () => {
    setSaving(true);
    const ok = await onSave(p);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      title="我的资料"
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      }
    >
      <div className="who-card">
        <RoachIcon color={p.color} size={52} avatar={p.avatar} />
        <div>
          <strong>{displayName(p)}</strong>
          <p className="hint">只有你大胆伸出触须时，对方才看得到这里的资料。位置永远不会给别人看。</p>
        </div>
      </div>

      <fieldset>
        <legend>名字</legend>
        <div className="seg" role="group" aria-label="名字">
          <button className={p.anonymous ? "on" : ""} onClick={() => set({ anonymous: true })}>
            保持匿名
          </button>
          <button className={p.anonymous ? "" : "on"} onClick={() => set({ anonymous: false })}>
            显示名字
          </button>
        </div>
        {!p.anonymous && (
          <>
            <label className="field">
              名字
              <input
                type="text"
                value={p.name}
                maxLength={NAME_MAX}
                placeholder="别人看到的名字"
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={p.drPrefix} onChange={(e) => set({ drPrefix: e.target.checked })} />
              加上 Dr. 前缀
            </label>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>我玩的游戏</legend>
        <div className="chips">
          {GAMES.map((g) => (
            <button key={g} className={`chip ${p.games.includes(g) ? "on" : ""}`} onClick={() => toggleGame(g)}>
              {GAME_NAMES[g]}
            </button>
          ))}
        </div>
      </fieldset>

      {p.games.map((g) => (
        <fieldset key={g}>
          <legend>{GAME_NAMES[g]}</legend>
          <div className="hint">厨力角色（最多 {MAX_FAVOURITES} 个）</div>
          <CharacterPicker
            game={g}
            value={p.favourites[g]}
            onChange={(v) => set({ favourites: { ...p.favourites, [g]: v } })}
          />
          <label className="field">
            {GAME_NAMES[g]} UID（可选）
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              value={p.uid[g]}
              maxLength={UID_MAX}
              placeholder="不填也可以"
              onChange={(e) => set({ uid: { ...p.uid, [g]: e.target.value } })}
            />
          </label>
        </fieldset>
      ))}

      {hasUid && (
        <fieldset>
          <legend>UID 给谁看</legend>
          <label className="check">
            <input type="checkbox" checked={p.shareUid} onChange={(e) => set({ shareUid: e.target.checked })} />
            我大胆伸出触须时，把 UID 一起给对方看
          </label>
          <p className="hint">
            默认谁都看不到。UID 能让人在游戏里直接加你，也可能被拿去别处搜到你的游戏账号，只建议给想认识的人看。
          </p>
        </fieldset>
      )}

      <fieldset>
        <legend>蟑螂形象</legend>
        <div className="avatars" role="radiogroup" aria-label="蟑螂形象">
          {ROACH_AVATARS.map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={p.avatar === a}
              className={p.avatar === a ? "on" : ""}
              onClick={() => set({ avatar: a })}
            >
              <RoachIcon color={p.color} size={56} avatar={a} />
              <span>{AVATAR_NAMES[a]}</span>
            </button>
          ))}
        </div>
        <p className="hint">地图切到写实版时，大家都是一样的真蟑螂。</p>
      </fieldset>

      <fieldset>
        <legend>蟑螂颜色</legend>
        <div className="colors" role="radiogroup" aria-label="蟑螂颜色">
          {ROACH_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={p.color === c}
              aria-label={COLOR_NAMES[c]}
              className={p.color === c ? "on" : ""}
              style={{ background: GLOW[c] }}
              onClick={() => set({ color: c })}
            />
          ))}
        </div>
        <p className="hint">颜色只改兜帽形象两边的灯；博士、管理员和小恶魔用的是原画，颜色不变。</p>
      </fieldset>
      <div className="account-actions">
        <button className="pill" onClick={onSignOut}>
          退出登录
        </button>
        <button className="pill" onClick={onDelete}>
          注销账号
        </button>
        <a className="pill" href="/privacy" target="_blank" rel="noreferrer">
          隐私说明
        </a>
      </div>
    </Sheet>
  );
}

function CharacterPicker({ game, value, onChange }: { game: Game; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const full = value.length >= MAX_FAVOURITES;
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return OPERATORS[game].filter((n) => !value.includes(n) && (!needle || n.toLowerCase().includes(needle)));
  }, [game, value, q]);

  const add = (n: string) => {
    onChange([...value, n]);
    setQ("");
    if (value.length + 1 >= MAX_FAVOURITES) setOpen(false);
  };

  return (
    <div>
      <div className="chips" style={{ marginTop: 6 }}>
        {value.map((n) => (
          <span key={n} className="chip on">
            {n}
            <button className="x" aria-label={`去掉${n}`} onClick={() => onChange(value.filter((x) => x !== n))}>
              ×
            </button>
          </span>
        ))}
        {!full && (
          <button className="chip add" onClick={() => setOpen((o) => !o)}>
            {open ? "收起" : "＋ 选角色"}
          </button>
        )}
      </div>
      {open && !full && (
        <div className="picker">
          <input type="search" placeholder="搜角色名" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="picker-list">
            {options.map((n) => (
              <button key={n} className="chip" onClick={() => add(n)}>
                {n}
              </button>
            ))}
            {options.length === 0 && <span className="hint">没有找到这个角色</span>}
          </div>
        </div>
      )}
    </div>
  );
}
