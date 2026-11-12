import { NextResponse } from "next/server";
import { parseNameWords } from "@/lib/nameRules";
import { isRuleCode, type AdminAction, type CaseQuery } from "@/lib/safety";
import {
  account,
  accountNotes,
  actOnAccount,
  addNote,
  adminLogPage,
  answerAppeal,
  banInfo,
  clearBlockedNames,
  findAccounts,
  maskedLookup,
  openAppeals,
  openCases,
  reportedPlaces,
  reportedRoaches,
  retentionStats,
  roachesNear,
  searchWords,
  setBadge,
  settleCase,
  settleCases,
  takeBackRoaches,
  undoAction,
  unsuspendAccount,
  wordsDetail,
} from "@/lib/server/admin";
import {
  actorOf,
  enter,
  gateState,
  lockAllDevices,
  lockDevice,
  logAdmin,
  lookedLately,
  renewBackupCodes,
  requireFresh,
  resetAdminTotp,
  setupConfirm,
  setupStart,
  unlock,
} from "@/lib/server/admins";
import { appCountDays } from "@/lib/server/appCounts";
import { HttpError, readJson, route } from "@/lib/server/http";
import { addNameWords, listNameWords, namesHit, removeNameWord, removeNameWords, testName } from "@/lib/server/nameWords";
import { ackIncident, siteStatus } from "@/lib/server/watchReport";

/** No answer of the 管理台 is kept by a browser or anything between */
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

const objectOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * The 管理台's endpoints (src/components/admin). Everyone comes through the door first (src/lib/server/admins.ts
 * enter): anyone it does not let in gets the same 404 as a missing page. The heaviest steps want a fresh code
 * (requireFresh), sent along as body.fresh. What is done, looked at or searched goes into the 操作记录.
 */
export const POST = route(
  async (req, { params }: { params: Promise<{ op: string }> }) => {
    const { op } = await params;
    const body = await readJson(req);
    const args = Array.isArray(body.args) ? body.args : [];
    const now = Date.now();
    const ctx = await enter(op, now);
    const actor = actorOf(ctx.admin);
    const by = actor;

    let result: unknown;
    switch (op) {
      // ---- the door ----
      case "gate":
        result = await gateState(ctx, now);
        break;
      case "unlock":
        result = await unlock(ctx, args[0], now);
        break;
      case "lock":
        await lockDevice(ctx);
        await logAdmin(actor, "gate", "gate.lock", {}, now);
        break;
      case "lockAll":
        result = await lockAllDevices(ctx);
        await logAdmin(actor, "gate", "gate.lockAll", { detail: `锁上了 ${result} 台设备` }, now);
        break;
      case "setupStart":
        result = await setupStart(ctx, now);
        break;
      case "setupConfirm":
        result = await setupConfirm(ctx, args[0], now);
        break;
      case "newBackupCodes":
        await requireFresh(ctx, body.fresh, now);
        result = await renewBackupCodes(ctx, now);
        break;
      case "resetAdminTotp":
        await requireFresh(ctx, body.fresh, now);
        await resetAdminTotp(ctx, args[0], now);
        break;

      // ---- 待处理 ----
      // a page of the queue: args[0] { page, level, reason, nameOnly, caseId, auto } (auto: the page refreshing itself, not logged)
      case "cases": {
        const q = objectOf(args[0]);
        const query: CaseQuery = {
          page: Number(q.page) || 1,
          level: String(q.level ?? "all") as CaseQuery["level"],
          reason: String(q.reason ?? "all") as CaseQuery["reason"],
          nameOnly: q.nameOnly === true,
          ...(typeof q.caseId === "string" ? { caseId: q.caseId } : {}),
        };
        const page = await openCases(query, now);
        result = page;
        if (q.auto !== true) {
          const what = query.caseId ? "一件" : `第 ${page.page} 页，${page.cases.length} 件`;
          await logAdmin(actor, "view", "view.cases", { detail: what }, now);
        }
        break;
      }
      case "resolve": {
        // args[0]: the case (a player's id, or roach:/report: for a roach's); args[2]: the community rule picked, or the one picked ahead
        const action = String(args[1]) as AdminAction;
        if (action === "ban") await requireFresh(ctx, body.fresh, now);
        await settleCase(String(args[0]), action, { rule: args[2], by }, now);
        break;
      }
      case "resolveMany":
        result = await settleCases(args[0], String(args[1]) as AdminAction, by);
        break;
      case "appeals":
        result = await openAppeals(now);
        break;
      case "answerAppeal":
        await answerAppeal(args[0], args[1] === true, now, by);
        break;

      // ---- 搜索账号 ----
      case "findPlayers": {
        const found = await findAccounts(args[0], now);
        result = { players: found.players, total: found.total };
        await logAdmin(actor, "search", "search", { detail: `搜「${searchWords(args[0], found.plainSearch)}」，找到 ${found.total} 个` }, now);
        break;
      }
      case "account": {
        result = await account(args[0], now);
        if (!(await lookedLately(actor, String(args[0]), now))) await logAdmin(actor, "view", "view.account", { targetId: String(args[0]) }, now);
        break;
      }
      // 搜到以后直接处理: args[0] { id, action, rule }; a ban wants a fresh code
      case "act": {
        const q = objectOf(args[0]);
        if (!isRuleCode(q.rule)) throw new HttpError(400, "先选一条 TA 违反的规则。");
        if (q.action === "ban") await requireFresh(ctx, body.fresh, now);
        result = await actOnAccount(q.id, q.action, q.rule, by, now);
        break;
      }
      case "unsuspend":
        result = await unsuspendAccount(args[0], by, now);
        break;
      case "undo":
        result = await undoAction(args[0], by, now);
        break;
      case "notes":
        result = await accountNotes(args[0]);
        break;
      case "addNote":
        result = await addNote(args[0], args[1], by, now);
        break;
      case "log":
        result = await adminLogPage(args[0], now);
        break;

      // ---- 网站和工具 ----
      case "status":
        result = await siteStatus();
        break;
      case "ack":
        await ackIncident(String(args[0]));
        await logAdmin(actor, "act", "act.ack", { detail: "网站状态：知道了" }, now);
        break;
      case "banInfo": {
        result = await banInfo(args[0]);
        await logAdmin(actor, "search", "search", { detail: `查邮箱 ${maskedLookup(args[0])}` }, now);
        break;
      }
      case "giveBadge":
      case "takeBadge":
        await setBadge(String(args[0]), String(args[1]), op === "giveBadge", by);
        break;
      case "retention":
        result = await retentionStats(now);
        break;
      // 存到桌面's counts, the last 14 days
      case "appCounts":
        result = await appCountDays();
        break;
      case "nameWords":
        result = await listNameWords(String(args[0] ?? ""));
        break;
      // every named player is read for this, so only when the page asks, not on each search
      case "nameHits":
        result = await namesHit();
        break;
      case "testName":
        result = await testName(args[0]);
        break;
      case "addNameWords": {
        const text = String(args[0] ?? "");
        result = await addNameWords(text);
        const words = parseNameWords(text).map((w) => w.word);
        if (words.length) await logAdmin(actor, "act", "act.nameWords", { detail: wordsDetail("加了", words) }, now);
        break;
      }
      case "removeNameWords": {
        const text = String(args[0] ?? "");
        result = await removeNameWords(text);
        const words = parseNameWords(text).map((w) => w.word);
        if (result) await logAdmin(actor, "act", "act.nameWords", { detail: wordsDetail("删了", words) }, now);
        break;
      }
      case "removeNameWord":
        await removeNameWord(String(args[0]));
        await logAdmin(actor, "act", "act.nameWords", { detail: wordsDetail("删了", [String(args[0])]) }, now);
        break;
      // names the list blocks, cleared with a 站长通知 each (and a line each in the 操作记录): args[0] the accounts' ids
      case "clearNames":
        result = await clearBlockedNames(args[0], now, by);
        break;

      // ---- the map: 站长清理 and 看被举报的蟑螂 ----
      case "roachesNear": {
        const near = await roachesNear(ctx.admin.userId, args[0], args[1], args[2]);
        result = near;
        await logAdmin(actor, "view", "view.map", { detail: `看了一处附近 ${Math.round(Number(args[2]) || 0)} 米内的 ${near.length} 只蟑螂` }, now);
        break;
      }
      case "takeBackRoaches":
        result = await takeBackRoaches(ctx.admin.userId, args[0], args[1], now, by);
        break;
      // args[0] { view: "place" (default) | "all" }: the roach cases open for where a roach was put, or every roach of a player with open reports
      case "reportedRoaches": {
        const all = objectOf(args[0]).view === "all";
        if (all) {
          const roaches = await reportedRoaches();
          result = { view: "all", roaches };
          await logAdmin(actor, "view", "view.map", { detail: `被举报的人的全部蟑螂 ${roaches.length} 只` }, now);
        } else {
          const places = await reportedPlaces(now);
          result = { view: "place", places };
          await logAdmin(actor, "view", "view.map", { detail: `位置被举报 ${places.length} 件` }, now);
        }
        break;
      }
      default:
        throw new HttpError(404, "没有这个功能。");
    }
    return NextResponse.json({ result: result ?? null });
  },
  { headers: NO_STORE },
);
