import { NextResponse } from "next/server";
import type { AdminAction } from "@/lib/safety";
import { allPlayers, isAdmin, openCases, resolveCase, retentionStats, setBadge } from "@/lib/server/admin";
import { currentUser } from "@/lib/server/auth";
import { HttpError, readJson, route } from "@/lib/server/http";
import { addNameWords, blockedWords, namesHit, removeNameWord } from "@/lib/server/nameWords";
import { clearName } from "@/lib/server/safety";

/** The admin page's endpoints (src/components/AdminApp.tsx). Anyone else gets the same 404 as a missing page. */
export const POST = route(async (req, { params }: { params: Promise<{ op: string }> }) => {
  const { op } = await params;
  const body = await readJson(req);
  const args = Array.isArray(body.args) ? body.args : [];
  if (!isAdmin(await currentUser())) throw new HttpError(404, "没有这个功能。");

  let result: unknown;
  switch (op) {
    case "cases":
      result = await openCases();
      break;
    case "resolve":
      await resolveCase(String(args[0]), String(args[1]) as AdminAction);
      break;
    case "giveBadge":
    case "takeBadge":
      await setBadge(String(args[0]), String(args[1]), op === "giveBadge");
      break;
    case "retention":
      result = await retentionStats();
      break;
    case "players":
      result = await allPlayers();
      break;
    case "nameWords":
      result = { words: await blockedWords(), hits: await namesHit() };
      break;
    case "addNameWords":
      result = await addNameWords(String(args[0] ?? ""));
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
