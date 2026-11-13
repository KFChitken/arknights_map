"use client";

import { useMemo, useState } from "react";
import { fmt, fmtParts, T } from "@/i18n";
import { AWAY_DAYS, type EarnedBadge } from "@/lib/badges";
import { GAME_NAMES, GAMES, SERVERS, type Game } from "@/lib/games";
import { REAL_LOOK_OFFERED } from "@/lib/look";
import { CHARACTERS, matchesSearch, OPERATORS } from "@/lib/operators";
import { logoutOthers } from "@/lib/authClient";
import { displayName, type Profile } from "@/lib/profile";
import { GLOW } from "@/lib/roachSvg";
import { MAX_FAVOURITES, NAME_MAX, UID_MAX } from "@/lib/rules";
import { MAX_SUPPORT } from "@/lib/support";
import { ROACH_AVATARS, ROACH_COLORS, type RoachAvatar, type RoachColor } from "@/lib/types";
import type { BlockedPlayer } from "@/lib/world/types";
import { MyBadgesRow } from "./Badges";
import { OnlyMainsRow } from "./OnlyMainsSheet";
import { OperatorPic, useOperatorArt } from "./OperatorNames";
import HomeScreenRow, { LoginCodeBox } from "./HomeScreen";
import PasswordBox, { type PasswordForm } from "./PasswordBox";
import Sheet from "./Sheet";
import RoachIcon from "../RoachIcon";

const AVATAR_NAMES: Record<RoachAvatar, string> = {
  get hood() {
    return T.profile.avatar.hood;
  },
  get doctor() {
    return T.profile.avatar.doctor;
  },
  get endmin() {
    return T.profile.avatar.endmin;
  },
  get imp() {
    return T.profile.avatar.imp;
  },
  get gugu() {
    return T.profile.avatar.gugu;
  },
};

const COLOR_NAMES: Record<RoachColor, string> = {
  get cyan() {
    return T.profile.color.cyan;
  },
  get pink() {
    return T.profile.color.pink;
  },
  get gold() {
    return T.profile.color.gold;
  },
  get green() {
    return T.profile.color.green;
  },
  get purple() {
    return T.profile.color.purple;
  },
  get orange() {
    return T.profile.color.orange;
  },
  get red() {
    return T.profile.color.red;
  },
  get white() {
    return T.profile.color.white;
  },
};

export default function ProfileSheet({
  profile,
  draft,
  badges,
  wornBadge,
  blocked,
  held = false,
  tutorial,
  perlicaTimer,
  onlyMains,
  onOpenOnlyMains,
  onOpenBadges,
  onUnblock,
  onSave,
  onPerlicaTimer,
  passwordForm,
  onConfirmByCode,
  onPasswordSet,
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
  /** Reports held the name and UIDs until the admin looks: they show greyed out, and cannot change */
  held?: boolean;
  /** The tutorial's first card: only the basics, and a way to stay anonymous for now */
  tutorial?: { onLater: () => void };
  /** 佩丽卡监督's 离开计时 (null: she has not asked yet); left out while the tutorial runs */
  perlicaTimer?: "on" | "off" | null;
  /** 地图上看哪些蟑螂 (只看本体): what is picked, and opening its sheet with the unsaved changes kept */
  onlyMains?: boolean;
  onOpenOnlyMains?: (draft: Profile) => void;
  onOpenBadges?: (draft: Profile) => void;
  onUnblock: (blockId: string) => void;
  onSave: (p: Profile) => Promise<boolean>;
  /** Switch her timer; only called when the box was changed and the rest saved */
  onPerlicaTimer?: (on: boolean) => Promise<boolean>;
  /** Back from confirming it is the player by code: what they were doing with their password; or "set", from the map's 去设密码 */
  passwordForm?: PasswordForm;
  /** A sign-in by code to confirm it is the player, for their password; the unsaved changes are kept */
  onConfirmByCode?: (email: string, form: PasswordForm, draft: Profile) => void;
  /** The player has a password now, set or changed here */
  onPasswordSet?: () => void;
  onSignOut: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [p, setP] = useState<Profile>(draft ?? profile);
  const [saving, setSaving] = useState(false);
  // not asked yet shows unticked, and stays not asked unless the box is ticked
  const [timerOn, setTimerOn] = useState(perlicaTimer === "on");
  // 退出其他设备: what happened, once asked
  const [othersOut, setOthersOut] = useState<string | null>(null);
  const signOutOthers = async () => {
    if (!window.confirm(T.profile.signOutOthersAsk)) return;
    try {
      const r = await logoutOthers();
      setOthersOut(r.ended > 0 ? fmt(T.profile.signedOutOthers, { n: r.ended }) : T.profile.noOthers);
    } catch (e) {
      setOthersOut(e instanceof Error ? e.message : String(e));
    }
  };
  const set = (patch: Partial<Profile>) => setP((old) => ({ ...old, ...patch }));
  const toggleGame = (g: Game) =>
    set({ games: p.games.includes(g) ? p.games.filter((x) => x !== g) : GAMES.filter((x) => x === g || p.games.includes(x)) });
  const hasUid = p.games.some((g) => p.uid[g].trim());

  const save = async () => {
    setSaving(true);
    let ok = await onSave(p);
    if (ok && perlicaTimer !== undefined && timerOn !== (perlicaTimer === "on")) ok = Boolean(await onPerlicaTimer?.(timerOn));
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      title={tutorial ? T.profile.makeCard : T.profile.title}
      onClose={tutorial?.onLater ?? onClose}
      footer={
        <>
          <button className="primary wide" onClick={save} disabled={saving}>
            {saving ? T.common.saving : T.profile.save}
          </button>
          {tutorial && (
            <button className="pill wide" style={{ marginTop: 8 }} onClick={tutorial.onLater}>
              {T.profile.anonymousForNow}
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
              ? T.profile.introNew
              : T.profile.intro}
          </p>
        </div>
      </div>
      {!tutorial && onOpenBadges && <MyBadgesRow badges={badges} worn={wornBadge} onOpen={() => onOpenBadges(p)} />}
      {!tutorial && <HomeScreenRow />}

      {held && <p className="held-note">{T.profile.hidden}</p>}
      <fieldset>
        <legend>{T.profile.name}</legend>
        <div className="seg" role="group" aria-label={T.profile.name}>
          <button className={p.anonymous ? "on" : ""} disabled={held} onClick={() => set({ anonymous: true })}>
            {T.profile.stayAnonymous}
          </button>
          <button className={p.anonymous ? "" : "on"} disabled={held} onClick={() => set({ anonymous: false })}>
            {T.profile.showName}
          </button>
        </div>
        {!p.anonymous && (
          <>
            <label className="field">
              {T.profile.name}
              <input
                type="text"
                value={p.name}
                maxLength={NAME_MAX}
                placeholder={T.profile.namePlaceholder}
                disabled={held}
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
            <p className="hint">{T.profile.nameRule}</p>
            <label className="check">
              <input type="checkbox" checked={p.drPrefix} disabled={held} onChange={(e) => set({ drPrefix: e.target.checked })} />
              {T.profile.drPrefix}
            </label>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>{T.profile.games}</legend>
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
          <div className="hint">{fmtParts(T.profile.favouritesMax, { max: MAX_FAVOURITES })}</div>
          <CharacterPicker
            game={g}
            value={p.favourites[g]}
            onChange={(v) => set({ favourites: { ...p.favourites, [g]: v } })}
            names={CHARACTERS[g]}
          />
          {g === "arknights" && !tutorial && (
            <>
              <div className="hint" style={{ marginTop: 12 }}>
                {fmtParts(T.profile.supportMax, { max: MAX_SUPPORT })}
              </div>
              <CharacterPicker
                game="arknights"
                value={p.support}
                max={MAX_SUPPORT}
                addLabel={T.common.pickOperator}
                onChange={(support) => set({ support })}
              />
            </>
          )}
          {!tutorial && (
            <div className="uid-row">
              <label className="field">
                {T.profile.server}
                <select
                  value={p.uidServer[g]}
                  disabled={held}
                  onChange={(e) => set({ uidServer: { ...p.uidServer, [g]: e.target.value } })}
                >
                  <option value="">{T.profile.pickServer}</option>
                  {SERVERS[g].map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {fmtParts(T.profile.uidLabel, { game: GAME_NAMES[g] })}
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  value={p.uid[g]}
                  maxLength={UID_MAX}
                  placeholder={T.profile.uidPlaceholder}
                  disabled={held}
                  onChange={(e) => set({ uid: { ...p.uid, [g]: e.target.value } })}
                />
              </label>
            </div>
          )}
        </fieldset>
      ))}

      {hasUid && !tutorial && (
        <fieldset>
          <legend>{T.profile.uidShare.title}</legend>
          <label className="check">
            <input type="checkbox" checked={p.shareUid} disabled={held} onChange={(e) => set({ shareUid: e.target.checked })} />
            {T.profile.uidShare.label}
          </label>
          <p className="hint">
            {T.profile.uidShare.note}
          </p>
        </fieldset>
      )}

      <fieldset>
        <legend>{T.profile.bellyUp.title}</legend>
        <label className="check">
          <input type="checkbox" checked={p.flipWhenAway} onChange={(e) => set({ flipWhenAway: e.target.checked })} />
          {T.profile.bellyUp.label}
        </label>
        <p className="hint">
          {fmtParts(T.profile.bellyUp.note, { days: AWAY_DAYS })}
        </p>
      </fieldset>

      <fieldset>
        <legend>{T.profile.visits.title}</legend>
        <label className="check">
          <input type="checkbox" checked={p.welcomeGuests} onChange={(e) => set({ welcomeGuests: e.target.checked })} />
          {T.profile.visits.label}
        </label>
        <p className="hint">{T.profile.visits.note}</p>
      </fieldset>
      {!tutorial && onOpenOnlyMains && <OnlyMainsRow onlyMains={Boolean(onlyMains)} onOpen={() => onOpenOnlyMains(p)} />}

      {perlicaTimer !== undefined && (
        <fieldset>
          <legend>{T.profile.timer.title}</legend>
          <label className="check">
            <input type="checkbox" checked={timerOn} onChange={(e) => setTimerOn(e.target.checked)} />
            {T.profile.timer.label}
          </label>
          <p className="hint">
            {T.profile.timer.note}
          </p>
        </fieldset>
      )}

      <fieldset>
        <legend>{T.profile.avatarTitle}</legend>
        <div className="avatars" role="radiogroup" aria-label={T.profile.avatarTitle}>
          {ROACH_AVATARS.map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={p.avatar === a}
              className={p.avatar === a ? "on" : ""}
              onClick={() => set({ avatar: a })}
            >
              <RoachIcon color={p.color} size={48} avatar={a} />
              <span>{AVATAR_NAMES[a]}</span>
            </button>
          ))}
        </div>
        {REAL_LOOK_OFFERED && <p className="hint">{T.profile.avatarReal}</p>}
      </fieldset>

      <fieldset>
        <legend>{T.profile.colorTitle}</legend>
        <div className="colors" role="radiogroup" aria-label={T.profile.colorTitle}>
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
        <p className="hint">{T.profile.colorNote}</p>
      </fieldset>
      {!tutorial && (
        <>
          <fieldset>
            <legend>{T.profile.blocked.title}</legend>
            {blocked.length === 0 && <p className="hint">{T.profile.blocked.empty}</p>}
            {blocked.map((b) => (
              <div className="list-row" key={b.id}>
                <div>
                  <strong>{b.name ?? T.common.anonymousOne}</strong>
                  <p className="muted">{fmtParts(T.profile.blocked.on, { date: new Date(b.at).toLocaleDateString("zh-CN", { month: "long", day: "numeric" }) })}</p>
                </div>
                <div className="row-actions">
                  <button className="pill" onClick={() => onUnblock(b.id)}>
                    {T.profile.blocked.unblock}
                  </button>
                </div>
              </div>
            ))}
          </fieldset>

          {onConfirmByCode && (
            <fieldset>
              <legend>{T.profile.passwordTitle}</legend>
              <PasswordBox
                startOpen={passwordForm}
                onConfirmByCode={(email, form) => onConfirmByCode(email, form, p)}
                onSet={onPasswordSet}
              />
            </fieldset>
          )}

          <fieldset>
            <legend>{T.profile.otherDevice.title}</legend>
            <p className="hint">{T.profile.otherDevice.note}</p>
            <LoginCodeBox signedIn />
          </fieldset>

          <div className="account-actions">
            <button className="pill" onClick={onSignOut}>
              {T.profile.signOut}
            </button>
            <button className="pill" onClick={signOutOthers}>
              {T.profile.signOutOthers}
            </button>
            <button className="pill" onClick={onDelete}>
              {T.profile.deleteAccount}
            </button>
            <a className="pill" href="/privacy" target="_blank" rel="noreferrer">
              {T.common.privacy}
            </a>
          </div>
          {othersOut && <p className="hint">{othersOut}</p>}
        </>
      )}
    </Sheet>
  );
}

/** Search some of a game's characters by name and pick one. */
function OperatorSearch({ game, names, taken, onPick }: { game: Game; names: string[]; taken: string[]; onPick: (name: string) => void }) {
  const art = useOperatorArt();
  const [q, setQ] = useState("");
  const options = useMemo(() => names.filter((n) => !taken.includes(n) && matchesSearch(n, q)), [names, taken, q]);
  return (
    <div className="picker">
      <input type="search" placeholder={T.profile.search.placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
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
        {options.length === 0 && <span className="hint">{T.profile.search.none}</span>}
      </div>
    </div>
  );
}

/** Pick up to max of a game's characters: the playable ones unless names says whom (厨力 may hold characters of the story too). */
export function CharacterPicker({
  game,
  value,
  max = MAX_FAVOURITES,
  addLabel = T.profile.pickCharacter,
  onChange,
  names = OPERATORS[game],
}: {
  game: Game;
  value: string[];
  max?: number;
  addLabel?: string;
  onChange: (v: string[]) => void;
  names?: string[];
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
            <button className="x" aria-label={fmt(T.profile.removeOne, { name: n })} onClick={() => onChange(value.filter((x) => x !== n))}>
              ×
            </button>
          </span>
        ))}
        {!full && (
          <button className="chip add" onClick={() => setOpen((o) => !o)}>
            {open ? T.common.collapse : addLabel}
          </button>
        )}
      </div>
      {open && !full && <OperatorSearch game={game} names={names} taken={value} onPick={add} />}
    </div>
  );
}
