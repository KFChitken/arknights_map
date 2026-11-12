import type { AdminHistoryItem, AdminLogEntry, AdminLogKind } from "@/lib/adminConsole";
import { beijingDate, beijingDayWords } from "@/lib/beijing";
import { GAME_NAMES } from "@/lib/games";
import { BLOCKS_WINDOW_DAYS, SUSPEND_DAYS, YELLOW_DAYS, YELLOWS_TO_WORRY } from "@/lib/rules";
import { isRuleCode, RULES, type AdminAction, type AdminCase, type AdminPerson, type ReporterInfo } from "@/lib/safety";
import type { RoachColor } from "@/lib/types";
import { ago } from "../app/InboxSheet";

/** The 管理台's words for what was done, what it gives back, and how people and their reports are shown */

/** What was done, as lists say it */
export const ACTION_WORDS: Record<AdminAction | "unsuspend", string> = {
  dismiss: "没问题",
  clearName: "清掉名字",
  clearUid: "清掉 UID",
  clearBoth: "名字和 UID 都清掉",
  warn: "警告（一张黄牌）",
  suspend: `暂停互动 ${SUSPEND_DAYS} 天`,
  ageCheck: "请 TA 确认年龄",
  removeRoach: "收回蟑螂（一张黄牌）",
  ban: "封号",
  unsuspend: "解除暂停",
};

/** The bar at the bottom while a step is held: 「已警告」 */
export const HELD_WORDS: Record<Exclude<AdminAction, "ban">, string> = {
  dismiss: "已标成没问题",
  clearName: "已清掉名字",
  clearUid: "已清掉 UID",
  clearBoth: "已清掉名字和 UID",
  warn: "已警告",
  suspend: `已暂停互动 ${SUSPEND_DAYS} 天`,
  ageCheck: "已请 TA 确认年龄",
  removeRoach: "已收回这只",
};

/** What 撤销 gives back, by what was done */
export const UNDO_WORDS: Partial<Record<AdminAction, string>> = {
  warn: "这张黄牌不算了",
  removeRoach: "这张黄牌不算了（蟑螂不会自己回去，TA 可以重新放）",
  suspend: "还在暂停的话，马上恢复互动",
  clearName: "TA 可以再用原来的名字（要自己重新填）",
  clearUid: "TA 可以再填原来的 UID（要自己重新填）",
  clearBoth: "TA 可以再用原来的名字和 UID（要自己重新填）",
  ageCheck: "不用 TA 再确认年龄了",
};

export const ruleWords = (rule: string | null) => (isRuleCode(rule) ? RULES[rule] : rule || "没记原因（以前封的）");

/** A name as others see it, 「匿名」 when they do not */
export const shownName = (p: Pick<AdminPerson, "name" | "anonymous" | "drPrefix">) =>
  p.name && !p.anonymous ? `${p.drPrefix ? "Dr. " : ""}${p.name}` : "匿名";

/** The name as saved, or that there is none */
export const savedName = (p: Pick<AdminPerson, "name" | "drPrefix">) => (p.name ? `${p.drPrefix ? "Dr. " : ""}${p.name}` : "（没有名字）");

/** A case's line in the list: the player, or the roach and whose */
export const caseTitle = (c: AdminCase) => (c.kind === "roach" ? `${c.roach?.main ? "本体" : "克隆体"} · 主人 ${shownName(c)}` : shownName(c));

/** The round mark beside a name: its first character, on the colour of the player's roach */
const COLOR_HEX: Record<RoachColor, string> = {
  cyan: "#0E7490",
  pink: "#BE185D",
  gold: "#B54708",
  green: "#1E6B34",
  purple: "#6D4AFF",
  orange: "#C2410C",
  red: "#B42318",
  white: "#475467",
};
export const markOf = (name: string, color?: RoachColor) => ({ initial: [...(name.trim() || "匿")][0], color: (color && COLOR_HEX[color]) || "#475467" });

/** How a reporter's reports went before, never who they are */
export function reporterWords(r: ReporterInfo | null) {
  if (!r) return "举报人已注销";
  const before = r.upheld + r.dismissed;
  const record = before ? `以前举报 ${before} 次，${r.dismissed === 0 ? "都成立" : r.upheld === 0 ? "都判了没问题" : `成立 ${r.upheld} 次`}` : "以前没举报过";
  return `举报人注册 ${r.days} 天，${record}${r.reliable ? "" : " · 不算进自动处理"}`;
}

/** 「关掉过 3 次，警告过 1 次……」 */
export function settledWords(s: AdminPerson["settled"]) {
  const parts = [
    s.dismissed && `关掉过 ${s.dismissed} 次`,
    s.warned && `警告过 ${s.warned} 次`,
    s.suspended && `暂停过 ${s.suspended} 次`,
    s.nameCleared && `清过名字 ${s.nameCleared} 次`,
    s.uidCleared && `清过 UID ${s.uidCleared} 次`,
    s.ageChecks && `请 TA 确认过 ${s.ageChecks} 次年龄`,
    s.roachesRemoved && `收回过 ${s.roachesRemoved} 只蟑螂`,
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "没有";
}

/** The marks beside a player in 待处理 */
export function personTags(p: AdminPerson, brigade = false) {
  return [
    p.heldAt ? "名字和 UID 先藏起来了" : null,
    p.suspendedAuto ? "自动暂停中" : p.suspendedUntil ? "暂停中" : null,
    brigade ? "可能是一起来刷的" : null,
    p.ageCheckAt ? "等 TA 确认年龄" : null,
  ].filter((t): t is string => Boolean(t));
}

export type Fact = { k: string; v: string; warn?: boolean };

/**
 * What the 管理台 shows of a player, a line each, in the order of the design: what they wrote about themselves
 * and what was done about them. Never where their roaches are or when they came by.
 */
export function personFacts(p: AdminPerson, opts: { declarations?: boolean; support?: boolean } = {}): Fact[] {
  const facts: Fact[] = [];
  const name = savedName(p);
  facts.push({
    k: "名字",
    v: !p.name ? name : p.heldAt ? `${name}（先藏起来了，别人现在看到「匿名」）` : p.anonymous ? `${name}（自己选了匿名，别人看到「匿名」）` : name,
  });
  if (!p.games.length) facts.push({ k: "游戏", v: "没填" });
  for (const g of p.games) {
    const uid = g.uid ? `UID ${g.uid}${g.server ? `（${g.server}）` : ""}` : "UID 没填";
    facts.push({ k: GAME_NAMES[g.game], v: g.favourites.length ? `${uid} · 喜欢 ${g.favourites.join("、")}` : uid });
  }
  if (p.games.some((g) => g.uid)) facts.push({ k: "UID 给谁看", v: `${p.shareUid ? "大胆碰过的人" : "只有自己"}${p.heldAt && p.shareUid ? "（现在先藏起来了）" : ""}` });
  if (opts.support || p.support.length) facts.push({ k: "我的助战", v: p.support.length ? p.support.join("、") : "没填" });
  if (opts.declarations && p.declarations.length) {
    const d = p.declarations[0];
    facts.push({ k: "最近的宣言", v: `「${d.text}」· ${ago(d.at)}` });
  }
  facts.push({ k: "称号", v: p.badges.length ? `${p.badges.length} 个${p.worn ? `，戴着「${p.worn}」` : ""}` : "没有" });
  facts.push({ k: "蟑螂", v: `${p.roaches.main ? "放了本体" : "没放本体"}${p.roaches.clones ? `${p.roaches.main ? "和" : "，"} ${p.roaches.clones} 只克隆体` : ""}` });
  facts.push({ k: "触须之交", v: `${p.friends} 个` });
  facts.push({
    k: "被拉黑",
    v: p.blockedBy ? `一共 ${p.blockedBy} 个人${p.blockedRecently ? `，${BLOCKS_WINDOW_DAYS} 天内 ${p.blockedRecently} 个` : ""}` : "没有",
    warn: p.blockedRecently > 0,
  });
  facts.push({
    k: "黄牌",
    v: p.yellow >= YELLOWS_TO_WORRY ? `${YELLOW_DAYS} 天内 ${p.yellow} 张，可以考虑封号` : `${YELLOW_DAYS} 天内 ${p.yellow} 张`,
    warn: p.yellow > 0,
  });
  if (p.suspendedUntil) {
    facts.push({ k: "暂停互动", v: `到 ${beijingDayWords(p.suspendedUntil)}${p.suspendedAuto ? "（是举报自动暂停的，处理时会先解除）" : ""}` });
  }
  facts.push({
    k: "年龄",
    v: p.ageCheckAt
      ? `等 TA 确认年龄（${ago(p.ageCheckAt)}请的）`
      : p.ageConfirmedAt
        ? `${ago(p.ageConfirmedAt)}确认过满 18 岁`
        : "注册时点了「我已满 18 岁」",
  });
  facts.push({ k: "以前的处理", v: settledWords(p.settled) });
  return facts;
}

/** 「11/2 注册（9 天）」 */
export function joinedWords(t: number, now = Date.now()) {
  const [, m, d] = beijingDate(t).split("-");
  return `${Number(m)}/${Number(d)} 注册（${Math.max(0, Math.floor((now - t) / 86_400_000))} 天）`;
}

/** How long something has waited, in the list's few words: 「40 分钟」「2 小时」「3 天」 */
export function waitWords(ms: number) {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时`;
  return `${Math.floor(minutes / (24 * 60))} 天`;
}

/** 处理记录: what was done, and how it stands now */
export function historyWords(h: AdminHistoryItem) {
  const what =
    h.action === "removeRoach" ? (h.main ? "收回本体（克隆体也一起收回了）" : "收回一只克隆体") : (ACTION_WORDS[h.action] ?? h.action);
  const detail =
    h.action === "unsuspend"
      ? "马上恢复互动"
      : `${h.rule ? `按「${RULES[h.rule]}」` : ""}${h.action === "suspend" && h.until ? `${h.rule ? "，" : ""}到 ${beijingDayWords(h.until)}` : ""}`;
  const status = h.undoneAt
    ? `${ago(h.undoneAt)}撤销了，TA 在消息里看到了`
    : h.appeal
      ? h.appeal.result === "kept"
        ? `TA 申诉了：「${h.appeal.text}」，维持了`
        : h.appeal.result === "reverted"
          ? `TA 申诉了：「${h.appeal.text}」，撤销了`
          : `TA 申诉了：「${h.appeal.text}」，等回复`
      : h.action === "unsuspend" || h.action === "dismiss"
        ? ""
        : "没申诉";
  return { what, detail, status };
}

/** The log's kinds as its tags say them, and their colours */
export const LOG_KIND: Record<AdminLogKind | "alert", { name: string; bg: string; fg: string }> = {
  act: { name: "处理", bg: "#E8EEFC", fg: "#1E3A8A" },
  view: { name: "查看", bg: "#EEF0F3", fg: "#3D4450" },
  search: { name: "搜索", bg: "#EEF0F3", fg: "#3D4450" },
  gate: { name: "验证", bg: "#E6F4EA", fg: "#14532D" },
  alert: { name: "要留意", bg: "#FDECEC", fg: "#A61B1B" },
  admin: { name: "管理员", bg: "#F3E8FF", fg: "#5B21B6" },
};

/** Lines of the log that want a second look */
export const isAlert = (e: AdminLogEntry) => e.what === "gate.fail" || e.what === "gate.pause" || e.what === "gate.backup" || e.what === "admin.reset";

const SETTLED: Record<string, string> = {
  "act.clearName": "清掉名字",
  "act.clearUid": "清掉 UID",
  "act.clearBoth": "名字和 UID 都清掉",
  "act.warn": "警告（一张黄牌）",
  "act.suspend": `暂停互动 ${SUSPEND_DAYS} 天`,
  "act.ageCheck": "请 TA 确认年龄",
  "act.removeRoach": "收回蟑螂（一张黄牌）",
  "act.ban": "封号",
};

/** A line of the 操作记录 in words: what was done, looked at or searched, without the account (shown beside it) */
/** The step a line of the 操作记录 took, without the rule or the detail after it: for 「撤销了…」 */
export const stepWords = (e: AdminLogEntry) => SETTLED[e.what] ?? logText(e);

export function logText(e: AdminLogEntry) {
  const d = e.detail ?? "";
  if (SETTLED[e.what]) return d ? `${SETTLED[e.what]}，${d}` : SETTLED[e.what];
  switch (e.what) {
    case "act.dismiss":
      return d || "没问题";
    case "act.appealKept":
    case "act.appealReverted":
      return `回复申诉：${d}`;
    case "view.cases":
      return `看了待处理${d ? `：${d}` : ""}`;
    case "view.account":
      return "打开了账号";
    case "view.map":
      return `在地图上看${d ? `：${d}` : ""}`;
    case "gate.unlock":
      return "输验证码，进了管理台";
    case "gate.fail":
      return `输错了：${d}`;
    case "gate.lock":
      return "锁上了这台设备";
    case "gate.setup":
      return "绑好了验证器，存了备用码";
    default:
      return d || e.what;
  }
}
