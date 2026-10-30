"use client";

import { useMemo, useState } from "react";
import { AWAY_DAYS, type EarnedBadge } from "@/lib/badges";
import { GAME_NAMES, GAMES, SERVERS, type Game } from "@/lib/games";
import { matchesSearch, OPERATORS } from "@/lib/operators";
import { displayName, type Profile } from "@/lib/profile";
import { GLOW } from "@/lib/roachSvg";
import { MAX_FAVOURITES, NAME_MAX, UID_MAX } from "@/lib/rules";
import { MAX_SUPPORT } from "@/lib/support";
import { ROACH_AVATARS, ROACH_COLORS, type RoachAvatar, type RoachColor } from "@/lib/types";
import type { BlockedPlayer } from "@/lib/world/types";
import { MyBadgesRow } from "./Badges";
import { OperatorPic, useOperatorArt } from "./OperatorNames";
import HomeScreenRow from "./HomeScreen";
import Sheet from "./Sheet";
import RoachIcon from "../RoachIcon";

const AVATAR_NAMES: Record<RoachAvatar, string> = {
  hood: "初始",
  doctor: "博士",
  endmin: "管理员",
  imp: "绝对主角",
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
  draft,
  badges,
  wornBadge,
  blocked,
  tutorial,
  onOpenBadges,
  onUnblock,
  onSave,
  onSignOut,
  onDelete,
  onClose,
}: {
  profile: Profile;
  /** Unsaved changes kept while 我的称号 was open */
  draft?: Profile;
  badges: EarnedBadge[];
  wornBadge: string | null;
  blocked: BlockedPlayer[];
  /** The tutorial's first card: only the basics, and a way to stay anonymous for now */
  tutorial?: { onLater: () => void };
  onOpenBadges?: (draft: Profile) => void;
  onUnblock: (blockId: string) => void;
  onSave: (p: Profile) => Promise<boolean>;
  onSignOut: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [p, setP] = useState<Profile>(draft ?? profile);
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
      title={tutorial ? "给你的蟑螂做张名片吧" : "我的资料"}
      onClose={tutorial?.onLater ?? onClose}
      footer={
        <>
          <button className="primary wide" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
          {tutorial && (
            <button className="pill wide" style={{ marginTop: 8 }} onClick={tutorial.onLater}>
              先匿名，以后再说
            </button>
          )}
        </>
      }
    >
      <div className="who-card">
        <RoachIcon color={p.color} size={52} avatar={p.avatar} />
        <div>
          <strong>{displayName(p)}</strong>
          <p className="hint">
            {tutorial
              ? "地图上没人知道哪只是你。只有你大胆碰过的人和触须之交能看到名片，他们也可能凭形象和颜色在地图上认出你的本体。"
              : "只有你大胆伸出触须时，对方才看得到这里的资料。地图上的本体和这里长得一样，所以看过资料的人可能认出你的本体在哪。"}
          </p>
        </div>
      </div>
      {!tutorial && onOpenBadges && <MyBadgesRow badges={badges} worn={wornBadge} onOpen={() => onOpenBadges(p)} />}
      {!tutorial && <HomeScreenRow />}

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
          {g === "arknights" && !tutorial && (
            <>
              <div className="hint" style={{ marginTop: 12 }}>
                我的助战（最多 {MAX_SUPPORT} 位）
              </div>
              <CharacterPicker
                game="arknights"
                value={p.support}
                max={MAX_SUPPORT}
                addLabel="＋ 选干员"
                onChange={(support) => set({ support })}
              />
            </>
          )}
          {!tutorial && (
            <div className="uid-row">
              <label className="field">
                服务器
                <select value={p.uidServer[g]} onChange={(e) => set({ uidServer: { ...p.uidServer, [g]: e.target.value } })}>
                  <option value="">选服务器</option>
                  {SERVERS[g].map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
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
            </div>
          )}
        </fieldset>
      ))}

      {hasUid && !tutorial && (
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
        <legend>翻肚皮</legend>
        <label className="check">
          <input type="checkbox" checked={p.flipWhenAway} onChange={(e) => set({ flipWhenAway: e.target.checked })} />
          好久没来时，蟑螂翻肚皮睡觉
        </label>
        <p className="hint">
          超过 {AWAY_DAYS} 天没来，大家会看到它翻过来睡觉。关掉的话，好久没来它也照样站着。自己点「摄入酒精」不受这个开关影响。
        </p>
      </fieldset>

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
        <p className="hint">颜色只改初始形象两边的灯；博士、管理员和绝对主角用的是原画，颜色不变。</p>
      </fieldset>
      {!tutorial && (
        <>
          <fieldset>
            <legend>拉黑名单</legend>
            {blocked.length === 0 && <p className="hint">还没有拉黑任何人。在消息里点「拉黑/举报」就能拉黑。</p>}
            {blocked.map((b) => (
              <div className="list-row" key={b.id}>
                <div>
                  <strong>{b.name ?? "一只匿名舟P"}</strong>
                  <p className="muted">{new Date(b.at).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}拉黑</p>
                </div>
                <div className="row-actions">
                  <button className="pill" onClick={() => onUnblock(b.id)}>
                    解除
                  </button>
                </div>
              </div>
            ))}
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
        </>
      )}
    </Sheet>
  );
}

/** Search a game's characters by name and pick one. */
function OperatorSearch({ game, taken, onPick }: { game: Game; taken: string[]; onPick: (name: string) => void }) {
  const art = useOperatorArt();
  const [q, setQ] = useState("");
  const options = useMemo(() => OPERATORS[game].filter((n) => !taken.includes(n) && matchesSearch(n, q)), [game, taken, q]);
  return (
    <div className="picker">
      <input type="search" placeholder="搜角色名" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker-list">
        {options.map((n) => (
          <button
            key={n}
            className="chip with-pic"
            onClick={() => {
              onPick(n);
              setQ("");
            }}
          >
            <OperatorPic game={game} name={n} art={art} />
            {n}
          </button>
        ))}
        {options.length === 0 && <span className="hint">没有找到这个角色</span>}
      </div>
    </div>
  );
}

function CharacterPicker({
  game,
  value,
  max = MAX_FAVOURITES,
  addLabel = "＋ 选角色",
  onChange,
}: {
  game: Game;
  value: string[];
  max?: number;
  addLabel?: string;
  onChange: (v: string[]) => void;
}) {
  const art = useOperatorArt();
  const [open, setOpen] = useState(false);
  const full = value.length >= max;

  const add = (n: string) => {
    onChange([...value, n]);
    if (value.length + 1 >= max) setOpen(false);
  };

  return (
    <div>
      <div className="chips" style={{ marginTop: 6 }}>
        {value.map((n) => (
          <span key={n} className="chip on with-pic">
            <OperatorPic game={game} name={n} art={art} />
            {n}
            <button className="x" aria-label={`去掉${n}`} onClick={() => onChange(value.filter((x) => x !== n))}>
              ×
            </button>
          </span>
        ))}
        {!full && (
          <button className="chip add" onClick={() => setOpen((o) => !o)}>
            {open ? "收起" : addLabel}
          </button>
        )}
      </div>
      {open && !full && <OperatorSearch game={game} taken={value} onPick={add} />}
    </div>
  );
}
