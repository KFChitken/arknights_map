import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fmt, T } from "@/i18n";
import { EMPTY_PROFILE } from "@/lib/profile";
import { siteName } from "@/lib/rules";
import type { Me } from "@/lib/world/types";
import ProfileHub, { type HubPage } from "./ProfileHub";

const me = (more: Partial<Me> = {}) =>
  ({
    id: "me",
    profile: { ...EMPTY_PROFILE, anonymous: false, name: "罗德岛摸鱼部", flipWhenAway: true, welcomeGuests: false },
    roaches: [{ id: "r0", slot: 0, lng: 121.47, lat: 31.23, publicId: "p0" }],
    badges: [],
    wornBadge: null,
    counts: new Proxy({}, { get: () => 0 }),
    perlica: { friend: false, timer: "on" },
    onlyMains: false,
    records: false,
    profileHeld: false,
    joinedAt: Date.parse("2026-10-22T20:30:00+08:00"),
    ...more,
  }) as unknown as Me;

const noop = () => {};
const yes = async () => true;
const hub = (m: Me, start: HubPage = "home", more: { sponsor?: boolean; listen?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(ProfileHub, {
      me: m,
      start,
      blocked: [],
      listen: more.listen ?? false,
      onSave: yes,
      onPerlicaTimer: yes,
      onPassOnMap: yes,
      onOpenBadges: noop,
      onOpenOnlyMains: noop,
      onOpenPasses: noop,
      onOpenSponsor: more.sponsor ? noop : undefined,
      onConfirmByCode: noop,
      onPasswordSet: noop,
      onUnblock: noop,
      onSignOut: noop,
      onDelete: noop,
      onToast: noop,
      onClose: noop,
    }),
  );

describe("the new 我的资料", () => {
  it("opens on what others see of the player, with a row for each of the rest", () => {
    const html = hub(me());
    expect(html).toContain(T.profile2.others);
    expect(html).toContain(T.common.anonymousOne);
    for (const row of [T.profile2.rows.looks, T.profile2.rows.badges, T.profile2.rows.settings, T.profile2.rows.account]) expect(html).toContain(row);
    expect(html).toContain(T.common.privacy);
  });

  it("shows 我的记录, 我的通行证 and 支持舟P地图 only to those who have them", () => {
    const plain = hub(me());
    expect(plain).not.toContain(T.profile2.records.sub);
    expect(plain).not.toContain(T.profile2.rows.passes);
    expect(plain).not.toContain(fmt(T.profile.sponsor, { site: siteName() }));
    const all = hub(me({ records: true, passes: { tickets: 3, dot: false, worn: null, onMap: true } }), "home", { sponsor: true });
    expect(all).toContain(T.profile2.records.sub);
    expect(all).toContain(T.profile2.rows.passes);
    expect(all).toContain(fmt(T.profile.sponsor, { site: siteName() }));
  });

  it("switches each setting as last saved, 听歌's only where it is open, 寻访's only with passes", () => {
    const html = hub(me(), "settings");
    const sw = (label: string) => new RegExp(`role="switch" aria-checked="(true|false)" aria-label="${label}"`).exec(html)?.[1];
    expect(sw(T.profile.bellyUp.label)).toBe("true");
    expect(sw(T.profile.visits.label)).toBe("false");
    expect(sw(T.profile.timer.label)).toBe("true");
    expect(html).not.toContain(T.profile.hearing.label);
    expect(html).not.toContain(T.passes.onMap.label);
    expect(hub(me(), "settings", { listen: true })).toContain(T.profile.hearing.label);
  });

  it("keeps the ways out of the account last, 注销 the very last", () => {
    const html = hub(me(), "account");
    expect(html.lastIndexOf(T.profile.deleteAccount)).toBeGreaterThan(html.lastIndexOf(T.profile.signOut));
    expect(html).toContain(T.profile.blocked.empty);
  });
});
