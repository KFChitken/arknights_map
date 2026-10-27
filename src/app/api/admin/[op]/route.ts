import { NextResponse } from "next/server";
import type { AdminAction } from "@/lib/safety";
import { isAdmin, openCases, resolveCase, retentionStats, setBadge } from "@/lib/server/admin";
import { currentUser } from "@/lib/server/auth";
import { HttpError, readJson, route } from "@/lib/server/http";

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
    default:
      throw new HttpError(404, "没有这个功能。");
  }
  return NextResponse.json({ result: result ?? null });
});
