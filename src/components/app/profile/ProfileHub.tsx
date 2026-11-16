"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { fmt, fmtParts, localPath, T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { logoutOthers } from "@/lib/authClient";
import { AWAY_DAYS, badgeById, BADGES } from "@/lib/badges";
import { GAME_NAMES, GAMES, SERVERS, type Game } from "@/lib/games";
import { REAL_LOOK_OFFERED } from "@/lib/look";
import { CHARACTERS } from "@/lib/operators";
import { CATALOG_SIZE } from "@/lib/passCatalog";
import { setLeanArt, useLeanArt } from "@/lib/passLean";
import { displayName, type Profile } from "@/lib/profile";
import type { RecordsLite } from "@/lib/records";
import { GLOW } from "@/lib/roachSvg";
import { MAX_FAVOURITES, NAME_MAX, siteName, UID_MAX } from "@/lib/rules";
import { MAX_SUPPORT } from "@/lib/support";
import { ROACH_AVATARS, ROACH_COLORS, SPONSOR_AVATARS, type RoachAvatar } from "@/lib/types";
import { publicProfileOf } from "@/lib/world/logic";
import type { BlockedPlayer, FriendEvent, Me } from "@/lib/world/types";
import RoachIcon from "../../RoachIcon";
import { BadgePill } from "../Badges";
import HomeScreenRow, { LoginCodeBox } from "../HomeScreen";
import { eventText, ProfileCard } from "../InboxSheet";
import { OnlyMainsRow } from "../OnlyMainsSheet";
import PasswordBox, { type PasswordForm } from "../PasswordBox";
import { AVATAR_NAMES, CharacterPicker, COLOR_NAMES } from "../ProfileSheet";
// 「我的记录」 only downloaded once opened
const RecordsSheet = dynamic(() => import("../records/RecordsSheet"), { ssr: false });
import { clockOf, dateOf, deviceOffset } from "../records/parts";
import Sheet from "../Sheet";
import { WornPassLine, WornPassMini } from "../WornPass";
import "./profile.css";

/**
 * The new 「我的资料」 (PROFILE2, Me.profile2): a first page of what others see of the player, their records and a
 * list of the rest, each opening its own page with ‹ back here and × closing. Only arranged anew: every setting
 * means and keeps what it did on the old one (src/components/app/ProfileSheet.tsx), which stays for everyone else.
 */
export type HubPage = "home" | "edit" | "looks" | "settings" | "account" | "records" | "seen";

type Props = {
  me: Me;
  /** Where it opens: the first page, or one coming back to it (the password, after confirming by code) */
  start?: HubPage;
  /** 编辑名片's unsaved changes, kept while another sheet was open */
  draft?: Profile;
  /** The looks they may pick (鸭爵 only for some); everyone's when not given */
  looks?: readonly RoachAvatar[];
  blocked: BlockedPlayer[];
  /** 听歌 is open to them: 让触须之交看到我在听什么 shows */
  listen: boolean;
  passwordForm?: PasswordForm;
  onSave: (p: Profile) => Promise<boolean>;
  onPerlicaTimer: (on: boolean) => Promise<boolean>;
  onPassOnMap: (on: boolean) => Promise<boolean>;
  onOpenBadges: (draft: Profile) => void;
  onOpenOnlyMains: (draft: Profile) => void;
  onOpenPasses: () => void;
  onOpenSponsor?: (draft: Profile) => void;
  onConfirmByCode: (email: string, form: PasswordForm, draft: Profile) => void;
  onPasswordSet: () => void;
  onUnblock: (blockId: string) => void;
  onSignOut: () => void;
  onDelete: () => void;
  onToast: (text: string) => void;
  onClose: () => void;
};

export default function ProfileHub(props: Props) {
  const { me, onClose } = props;
  const [page, setPage] = useState<HubPage>(props.start ?? "home");
  const [edit, setEdit] = useState<Profile>(props.draft ?? me.profile);
  const [lite, setLite] = useState<RecordsLite | null>(null);
  const [offset] = useState(deviceOffset);

  // 我的记录's card, and what 触须之交 see, once on opening: about 2 kB
  useEffect(() => {
    if (!me.records) return;
    let live = true;
    apiFetch(`/api/records/summary?offset=${offset}&lite=1`, { cache: "no-store" })
      .then(async (res) => res.ok && live && setLite((await res.json()) as RecordsLite))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [me.records, offset]);

  const home = () => setPage("home");
  if (page === "edit") return <EditPage {...props} edit={edit} setEdit={setEdit} onUp={home} />;
  if (page === "looks") return <LooksPage {...props} onUp={home} />;
  if (page === "settings") return <SettingsPage {...props} draft={edit} onUp={home} />;
  if (page === "account") return <AccountPage {...props} draft={edit} onUp={home} />;
  if (page === "records") {
    return <RecordsSheet me={me} passesOpen={Boolean(me.passes)} onUp={home} onBack={home} onClose={onClose} onOpenBadges={() => props.onOpenBadges(edit)} />;
  }
  if (page === "seen") {
    return (
      <Sheet title={T.records.overview.seen} onUp={home} onClose={onClose}>
        <p className="hint">{T.profile2.seenNote}</p>
        <FriendTop me={me} lite={lite} />
        <h4 className="p2-lbl">{T.profile2.history}</h4>
        <History events={lite?.seen ?? []} offset={offset} limit={30} />
      </Sheet>
    );
  }
  return <HomePage {...props} edit={edit} lite={lite} offset={offset} onPage={setPage} />;
}

// ---- the first page ----

function HomePage({
  me,
  edit,
  lite,
  offset,
  onPage,
  onOpenBadges,
  onOpenPasses,
  onOpenSponsor,
  onClose,
}: Props & { edit: Profile; lite: RecordsLite | null; offset: number; onPage: (p: HubPage) => void }) {
  const t = T.profile2;
  const [seg, setSeg] = useState<"stranger" | "bold" | "friend">("stranger");
  const worn = me.badges.find((b) => b.id === me.wornBadge);
  const pass = me.passes?.worn ?? null;
  return (
    <Sheet title={t.title} onClose={onClose}>
      <h4 className="p2-lbl first">{t.others}</h4>
      <div className="seg p2-seg" role="group" aria-label={t.others}>
        {(["stranger", "bold", "friend"] as const).map((s) => (
          <button key={s} className={seg === s ? "on" : ""} aria-pressed={seg === s} onClick={() => setSeg(s)}>
            {t.segs[s]}
          </button>
        ))}
      </div>
      <div className="p2-card">
        <span className="p2-corner">{t.corner[seg]}</span>
        {seg === "stranger" ? <Stranger me={me} /> : seg === "bold" ? <Bold me={me} /> : <FriendPreview me={me} lite={lite} offset={offset} onAll={() => onPage("seen")} />}
      </div>
      <div className="p2-edit">
        <button className="pill" onClick={() => onPage("edit")}>
          {t.edit}
        </button>
      </div>

      {me.records && <RecordsCard lite={lite} onOpen={() => onPage("records")} />}

      <div className="p2-rows">
        <Row
          title={t.rows.looks}
          hint={me.profile.avatar === "hood" ? `${AVATAR_NAMES[me.profile.avatar]} · ${COLOR_NAMES[me.profile.color]}` : AVATAR_NAMES[me.profile.avatar]}
          side={<RoachIcon color={me.profile.color} size={28} avatar={me.profile.avatar} />}
          onClick={() => onPage("looks")}
        />
        <Row
          title={t.rows.badges}
          hint={
            worn
              ? fmt(t.rows.badgesWorn, { n: me.badges.length, all: BADGES.length, name: badgeById(worn.id)?.name ?? "" })
              : fmt(t.rows.badgesHint, { n: me.badges.length, all: BADGES.length })
          }
          side={worn ? <BadgePill badge={worn} /> : undefined}
          onClick={() => onOpenBadges(edit)}
        />
        {me.passes && (
          <Row
            title={t.rows.passes}
            hint={
              lite?.passChars === 0 && !pass
                ? t.rows.passesNone
                : pass
                  ? lite?.passChars !== undefined
                    ? fmt(t.rows.passesWorn, { n: lite.passChars, all: CATALOG_SIZE, name: pass.name })
                    : pass.name
                  : lite?.passChars !== undefined
                    ? fmt(t.rows.passesHint, { n: lite.passChars, all: CATALOG_SIZE })
                    : ""
            }
            side={pass ? <WornPassMini pass={pass} holder={displayName(me.profile)} /> : undefined}
            onClick={onOpenPasses}
          />
        )}
        <HomeScreenRow />
        <Row title={t.rows.settings} hint={t.rows.settingsHint} onClick={() => onPage("settings")} />
        <Row title={t.rows.account} hint={t.rows.accountHint} onClick={() => onPage("account")} />
        {onOpenSponsor && <Row title={fmt(T.profile.sponsor, { site: siteName() })} onClick={() => onOpenSponsor(edit)} />}
      </div>
      <div className="p2-foot">
        <a href={localPath("/privacy")} target="_blank" rel="noreferrer">
          {T.common.privacy}
        </a>
      </div>
    </Sheet>
  );
}

function Row({ title, hint, side, onClick }: { title: string; hint?: string; side?: ReactNode; onClick: () => void }) {
  return (
    <button className="link-row p2-row" onClick={onClick}>
      <span>
        {title}
        {hint && <small className="link-row-hint">{hint}</small>}
      </span>
      <span className="link-row-end">
        {side}
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </span>
    </button>
  );
}

/** 路人看到的: the map's card of the main roach, nobody named, and the two ways to touch it (only drawn here) */
function Stranger({ me }: { me: Me }) {
  const t = T.profile2;
  const pass = me.passes?.onMap ? (me.passes.worn ?? null) : null;
  return (
    <>
      <div className="p2-stranger">
        <RoachIcon color={me.profile.color} size={52} avatar={me.profile.avatar} />
        <div>
          <strong>{T.common.anonymousOne}</strong>
          <div className="hint">{t.strangerSub}</div>
          {pass && <span className="p2-ptag">{fmt(t.passTag, { name: pass.name })}</span>}
        </div>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        {t.touchAsk}
      </div>
      <div className="p2-two" aria-hidden="true">
        <span>{T.common.reachSneaky}</span>
        <span className="dark">{T.common.reachBold}</span>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        {t.strangerNote}
        {pass ? t.strangerPass : ""}
      </p>
    </>
  );
}

/** 被你大胆碰过的人看到的: the profile card, as an inbox shows it */
function Bold({ me }: { me: Me }) {
  const profile = {
    ...publicProfileOf(me.profile),
    badges: [...me.badges].sort((a, b) => Number(b.id === me.wornBadge) - Number(a.id === me.wornBadge)),
    worn: me.wornBadge,
    ...(me.passes?.worn ? { pass: me.passes.worn } : {}),
  };
  return (
    <>
      <ProfileCard profile={profile} />
      <p className="hint" style={{ marginTop: 8 }}>
        {T.inbox.profile.why}
      </p>
    </>
  );
}

function FriendTop({ me, lite }: { me: Me; lite: RecordsLite | null }) {
  const t = T.profile2;
  const clones = me.roaches.filter((r) => r.slot > 0).length;
  const declared = lite?.seen.filter((e) => e.kind === "declared").length;
  return (
    <>
      <div className="who-card">
        <RoachIcon color={me.profile.color} size={52} avatar={me.profile.avatar} />
        <div>
          <strong>{fmt(t.friendTitle, { name: displayName(me.profile) })}</strong>
          <div className="hint">{t.friendSince}</div>
        </div>
        {me.passes?.worn && <WornPassMini pass={me.passes.worn} holder={displayName(me.profile)} />}
      </div>
      {me.passes?.worn && <WornPassLine pass={me.passes.worn} />}
      {declared !== undefined && (
        <div className="hint" style={{ marginTop: 8 }}>
          {fmt(t.friendRoaches, { roaches: clones ? fmt(t.roachesClones, { n: clones }) : t.roachesMain, n: declared })}
        </div>
      )}
    </>
  );
}

function History({ events, offset, limit }: { events: FriendEvent[]; offset: number; limit: number }) {
  if (!events.length) return <p className="hint">{T.inbox.history.empty}</p>;
  return (
    <div className="p2-hist">
      {events.slice(0, limit).map((e, i) => (
        <div className="event" key={i}>
          <span>{eventText(e)}</span>
          <span className="muted">
            {dateOf(e.at, offset)} {clockOf(e.at, offset)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 触须之交看到的: their page of the player, from one who was in none of it */
function FriendPreview({ me, lite, offset, onAll }: { me: Me; lite: RecordsLite | null; offset: number; onAll: () => void }) {
  return (
    <>
      <FriendTop me={me} lite={lite} />
      {lite && (
        <>
          <h4 className="p2-lbl">{T.profile2.history}</h4>
          <History events={lite.seen} offset={offset} limit={3} />
          <div className="p2-edit">
            <button className="pill" onClick={onAll}>
              {T.profile2.seeAll}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** 我的记录's dark card: the last 7 days, with a bar for each day */
function RecordsCard({ lite, onOpen }: { lite: RecordsLite | null; onOpen: () => void }) {
  const t = T.profile2.records;
  const sum = (xs: number[] | undefined) => (xs ? xs.reduce((a, b) => a + b, 0) : null);
  const nums: [number | null, string][] = [
    [sum(lite?.out), T.records.overview.tiles.tout],
    [sum(lite?.in), T.records.overview.tiles.tin],
    [sum(lite?.declared), T.records.overview.tiles.decl],
  ];
  // oldest first: today on the right
  const days = lite ? lite.out.map((n, i) => n + lite.in[i] + lite.declared[i]).reverse() : [];
  const max = Math.max(1, ...days);
  const weekday = (back: number) => {
    if (back === 0) return t.today;
    const d = new Date((lite!.today - back) * 86_400_000);
    return fmt(t.weekday, { w: T.records.weekdays[d.getUTCDay()] });
  };
  return (
    <button className="p2-rec" onClick={onOpen}>
      <span className="top">
        <b>{T.records.title}</b>
        <span>{t.see}</span>
      </span>
      <span className="sub">{t.sub}</span>
      <span className="nums">
        {nums.map(([n, label]) => (
          <span key={label}>
            <b>{n ?? t.wait}</b>
            <span>{label}</span>
          </span>
        ))}
      </span>
      {lite && (
        <svg viewBox="0 0 300 48" aria-hidden="true">
          {days.map((v, i) => {
            const h = Math.max(2, (v / max) * 34);
            return (
              <g key={i}>
                <rect x={i * (300 / 7) + 3} y={34 - h} width={300 / 7 - 6} height={h} rx="3" fill={i === 6 ? "#ffd23f" : "#6b6230"} />
                <text x={i * (300 / 7) + 300 / 14} y="46" textAnchor="middle" fontSize="10" fill="#9aa0aa">
                  {weekday(6 - i)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </button>
  );
}

// ---- 编辑名片 ----

function EditPage({ me, edit, setEdit, onSave, onUp, onClose }: Props & { edit: Profile; setEdit: (p: Profile) => void; onUp: () => void }) {
  const p = edit;
  const held = me.profileHeld;
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Profile>) => setEdit({ ...p, ...patch });
  const toggleGame = (g: Game) => set({ games: p.games.includes(g) ? p.games.filter((x) => x !== g) : GAMES.filter((x) => x === g || p.games.includes(x)) });
  const hasUid = p.games.some((g) => p.uid[g].trim());
  const worn = me.badges.find((b) => b.id === me.wornBadge);
  // only the card's own fields: the look and the switches are kept as last saved
  const save = async () => {
    setSaving(true);
    const ok = await onSave({
      ...me.profile,
      anonymous: p.anonymous,
      name: p.name,
      drPrefix: p.drPrefix,
      games: p.games,
      favourites: p.favourites,
      support: p.support,
      uid: p.uid,
      uidServer: p.uidServer,
      shareUid: p.shareUid,
    });
    setSaving(false);
    // the map says 资料存好了 itself
    if (ok) onUp();
  };
  return (
    <Sheet
      title={T.profile2.editTitle}
      onUp={onUp}
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={save} disabled={saving}>
          {saving ? T.common.saving : T.profile.save}
        </button>
      }
    >
      <div className="p2-sticky">
        <div className="who-card">
          <RoachIcon color={me.profile.color} size={40} avatar={me.profile.avatar} />
          <div>
            <strong>{displayName(p)}</strong>
            {worn && (
              <div>
                <BadgePill badge={worn} />
              </div>
            )}
          </div>
          <span className="hint" style={{ marginLeft: "auto", alignSelf: "flex-start" }}>
            {T.profile2.preview}
          </span>
        </div>
      </div>
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
              <input type="text" value={p.name} maxLength={NAME_MAX} placeholder={T.profile.namePlaceholder} disabled={held} onChange={(e) => set({ name: e.target.value })} />
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
          <CharacterPicker game={g} value={p.favourites[g]} onChange={(v) => set({ favourites: { ...p.favourites, [g]: v } })} names={CHARACTERS[g]} />
          {g === "arknights" && (
            <>
              <div className="hint" style={{ marginTop: 12 }}>
                {fmtParts(T.profile.supportMax, { max: MAX_SUPPORT })}
              </div>
              <CharacterPicker game="arknights" value={p.support} max={MAX_SUPPORT} addLabel={T.common.pickOperator} onChange={(support) => set({ support })} />
            </>
          )}
          <div className="uid-row">
            <label className="field">
              {T.profile.server}
              <select value={p.uidServer[g]} disabled={held} onChange={(e) => set({ uidServer: { ...p.uidServer, [g]: e.target.value } })}>
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
        </fieldset>
      ))}
      {hasUid && (
        <fieldset>
          <legend>{T.profile.uidShare.title}</legend>
          <label className="check">
            <input type="checkbox" checked={p.shareUid} disabled={held} onChange={(e) => set({ shareUid: e.target.checked })} />
            {T.profile.uidShare.label}
          </label>
          <p className="hint">{T.profile.uidShare.note}</p>
        </fieldset>
      )}
    </Sheet>
  );
}

// ---- 蟑螂形象 ----

function LooksPage({ me, looks = ROACH_AVATARS.filter((a) => !SPONSOR_AVATARS.includes(a)), onSave, onUp, onClose }: Props & { onUp: () => void }) {
  const [avatar, setAvatar] = useState(me.profile.avatar);
  const [color, setColor] = useState(me.profile.color);
  const [saving, setSaving] = useState(false);
  const clones = Math.max(1, me.roaches.filter((r) => r.slot > 0).length);
  const save = async () => {
    setSaving(true);
    // only the look, on the card as last saved
    const ok = await onSave({ ...me.profile, avatar, color });
    setSaving(false);
    if (ok) onUp();
  };
  return (
    <Sheet
      title={T.profile2.rows.looks}
      onUp={onUp}
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={save} disabled={saving}>
          {saving ? T.common.saving : T.profile.save}
        </button>
      }
    >
      <div className="p2-stage" aria-label={T.profile2.preview}>
        <span className="main">
          <RoachIcon color={color} size={84} avatar={avatar} />
        </span>
        {Array.from({ length: Math.min(3, clones) }, (_, i) => (
          <span key={i} className={`clone c${i}`}>
            <RoachIcon color={color} size={44 - i * 3} avatar={avatar} />
          </span>
        ))}
        <span className="label">{fmt(T.profile2.stage, { n: Math.min(3, clones) })}</span>
      </div>
      <fieldset>
        <legend>{T.profile.avatarTitle}</legend>
        <div className="avatars" role="radiogroup" aria-label={T.profile.avatarTitle}>
          {looks.map((a) => (
            <button key={a} role="radio" aria-checked={avatar === a} className={avatar === a ? "on" : ""} onClick={() => setAvatar(a)}>
              <RoachIcon color={color} size={48} avatar={a} />
              <span>{AVATAR_NAMES[a]}</span>
            </button>
          ))}
        </div>
        {REAL_LOOK_OFFERED && <p className="hint">{T.profile.avatarReal}</p>}
      </fieldset>
      {avatar === "hood" && (
        <fieldset>
          <legend>{T.profile.colorTitle}</legend>
          <div className="colors" role="radiogroup" aria-label={T.profile.colorTitle}>
            {ROACH_COLORS.map((c) => (
              <button key={c} role="radio" aria-checked={color === c} aria-label={COLOR_NAMES[c]} className={color === c ? "on" : ""} style={{ background: GLOW[c] }} onClick={() => setColor(c)} />
            ))}
          </div>
          <p className="hint">{T.profile.colorNote}</p>
        </fieldset>
      )}
    </Sheet>
  );
}

// ---- 设置 ----

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return <button className="p2-sw" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

function SetRow({ title, note, on, onChange }: { title: string; note: ReactNode; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="p2-set">
      <span>
        <b>{title}</b>
        <small>{note}</small>
      </span>
      <Switch on={on} label={title} onChange={onChange} />
    </div>
  );
}

function SettingsPage({ me, draft, listen, onSave, onPerlicaTimer, onPassOnMap, onOpenOnlyMains, onToast, onUp, onClose }: Props & { draft: Profile; onUp: () => void }) {
  const t = T.profile2.settings;
  const [shown, setShown] = useState({
    flipWhenAway: me.profile.flipWhenAway,
    welcomeGuests: me.profile.welcomeGuests,
    showListening: me.profile.showListening,
    timer: me.perlica.timer === "on",
    onMap: me.passes?.onMap ?? true,
  });
  const lean = useLeanArt();
  /**
   * Switched: shown at once, kept, and switched back if keeping it failed (the map says why). said: the map says
   * 资料存好了 itself; the others say 已保存 here
   */
  const flip = async (key: keyof typeof shown, on: boolean, keep: () => Promise<boolean>, said = false) => {
    setShown((s) => ({ ...s, [key]: on }));
    let ok = false;
    try {
      ok = await keep();
    } catch {
      ok = false;
    }
    if (!ok) return setShown((s) => ({ ...s, [key]: !on }));
    if (!said) onToast(t.saved);
  };
  // the card as last saved, this one switch changed: never 编辑名片's unsaved changes
  const profileSwitch = (key: "flipWhenAway" | "welcomeGuests" | "showListening") => (on: boolean) =>
    void flip(key, on, () => onSave({ ...me.profile, [key]: on }), true);
  return (
    <Sheet title={T.profile2.rows.settings} onUp={onUp} onClose={onClose}>
      <p className="hint" style={{ marginTop: 2 }}>
        {t.note}
      </p>
      <h4 className="p2-grp">{t.groups.map}</h4>
      <OnlyMainsRow onlyMains={me.onlyMains} onOpen={() => onOpenOnlyMains(draft)} />
      <SetRow title={T.profile.bellyUp.label} note={fmtParts(T.profile.bellyUp.note, { days: AWAY_DAYS })} on={shown.flipWhenAway} onChange={profileSwitch("flipWhenAway")} />
      <h4 className="p2-grp">{t.groups.friends}</h4>
      <SetRow title={T.profile.visits.label} note={T.profile.visits.note} on={shown.welcomeGuests} onChange={profileSwitch("welcomeGuests")} />
      {listen && <SetRow title={T.profile.hearing.label} note={T.profile.hearing.note} on={shown.showListening} onChange={profileSwitch("showListening")} />}
      {me.perlica.timer !== undefined && (
        <>
          <h4 className="p2-grp">{t.groups.perlica}</h4>
          <SetRow title={T.profile.timer.label} note={T.profile.timer.note} on={shown.timer} onChange={(on) => void flip("timer", on, () => onPerlicaTimer(on))} />
        </>
      )}
      {me.passes && (
        <>
          <h4 className="p2-grp">{t.groups.passes}</h4>
          <SetRow title={T.passes.onMap.label} note={T.passes.onMap.hint} on={shown.onMap} onChange={(on) => void flip("onMap", on, () => onPassOnMap(on))} />
        </>
      )}
      <h4 className="p2-grp">{t.groups.device}</h4>
      {me.passes && <SetRow title={T.passes.lean.label} note={T.passes.lean.hint} on={lean} onChange={(on) => setLeanArt(on)} />}
      <HomeScreenRow />
    </Sheet>
  );
}

// ---- 账号与安全 ----

function AccountPage({ draft, blocked, passwordForm, onConfirmByCode, onPasswordSet, onUnblock, onSignOut, onDelete, onUp, onClose }: Props & { draft: Profile; onUp: () => void }) {
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
  return (
    <Sheet title={T.profile2.rows.account} onUp={onUp} onClose={onClose}>
      <fieldset>
        <legend>{T.profile.passwordTitle}</legend>
        <PasswordBox startOpen={passwordForm} onConfirmByCode={(email, form) => onConfirmByCode(email, form, draft)} onSet={onPasswordSet} />
      </fieldset>
      <fieldset>
        <legend>{T.profile.otherDevice.title}</legend>
        <p className="hint">{T.profile.otherDevice.note}</p>
        <LoginCodeBox signedIn />
      </fieldset>
      <fieldset>
        <legend>{T.profile.signOutOthers}</legend>
        <button className="pill" onClick={signOutOthers}>
          {T.profile.signOutOthers}
        </button>
        {othersOut && <p className="hint">{othersOut}</p>}
      </fieldset>
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
      <div className="p2-leave">
        <a className="pill" href={localPath("/privacy")} target="_blank" rel="noreferrer">
          {T.common.privacy}
        </a>
        <button className="pill" onClick={onSignOut}>
          {T.profile.signOut}
        </button>
        <button className="pill danger-pill" onClick={onDelete}>
          {T.profile.deleteAccount}
        </button>
      </div>
    </Sheet>
  );
}
