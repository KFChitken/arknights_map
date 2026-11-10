import { NextResponse } from "next/server";
import type { AdminAction, CaseQuery } from "@/lib/safety";
import {
  answerAppeal,
  banInfo,
  findPlayers,
  isAdmin,
  openAppeals,
  openCases,
  retentionStats,
  setBadge,
  settleCase,
  settleCases,
} from "@/lib/server/admin";
import { currentUser } from "@/lib/server/auth";
import { HttpError, readJson, route } from "@/lib/server/http";
import { addNameWords, listNameWords, namesHit, removeNameWord, removeNameWords } from "@/lib/server/nameWords";
import { clearName } from "@/lib/server/safety";
import { ackIncident, siteStatus } from "@/lib/server/watchReport";

/** The admin page's endpoints (src/components/AdminApp.tsx). Anyone else gets the same 404 as a missing page. */
export const POST = route(async (req, { params }: { params: Promise<{ op: string }> }) => {
  const { op } = await params;
  const body = await readJson(req);
  const args = Array.isArray(body.args) ? body.args : [];
  if (!isAdmin(await currentUser())) throw new HttpError(404, "没有这个功能。");

  let result: unknown;
  switch (op) {
    case "status":
      result = await siteStatus();
      break;
    case "ack":
      await ackIncident(String(args[0]));
      break;
    // a page of the queue: args[0] { page, level, reason, nameOnly }
    case "cases": {
      const q = (args[0] && typeof args[0] === "object" ? args[0] : {}) as Record<string, unknown>;
      result = await openCases({
        page: Number(q.page) || 1,
        level: String(q.level ?? "all") as CaseQuery["level"],
        reason: String(q.reason ?? "all") as CaseQuery["reason"],
        nameOnly: q.nameOnly === true,
      });
      break;
    }
    case "resolve":
      // args[0]: the case (a player's id, or roach:/report: for a roach's); args[2]: the community rule the admin picked, or the one picked ahead
      await settleCase(String(args[0]), String(args[1]) as AdminAction, { rule: args[2] });
      break;
    case "appeals":
      result = await openAppeals();
      break;
    case "answerAppeal":
      await answerAppeal(args[0], args[1] === true);
      break;
    case "findPlayers":
      result = await findPlayers(args[0]);
      break;
    case "banInfo":
      result = await banInfo(args[0]);
      break;
    case "resolveMany":
      result = await settleCases(args[0], String(args[1]) as AdminAction);
      break;
    case "giveBadge":
    case "takeBadge":
      await setBadge(String(args[0]), String(args[1]), op === "giveBadge");
      break;
    case "retention":
      result = await retentionStats();
      break;
    case "nameWords":
      result = { ...(await listNameWords(String(args[0] ?? ""))), hits: await namesHit() };
      break;
    case "addNameWords":
      result = await addNameWords(String(args[0] ?? ""));
      break;
    case "removeNameWords":
      result = await removeNameWords(String(args[0] ?? ""));
      break;
    case "removeNameWord":
      await removeNameWord(String(args[0]));
      break;
    case "clearName": {
      const id = String(args[0]);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "没有这个账号。");
      await clearName(id);
      break;
    }
    default:
      throw new HttpError(404, "没有这个功能。");
  }
  return NextResponse.json({ result: result ?? null });
});
