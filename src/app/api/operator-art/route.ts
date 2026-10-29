import { NextResponse } from "next/server";
import { operatorArtIndex } from "@/lib/server/operatorArt";

/** GET /api/operator-art: which characters have a picture (src/lib/server/operatorArt.ts); empty when switched off. */
export async function GET() {
  return NextResponse.json(await operatorArtIndex(), { headers: { "cache-control": "public, max-age=300" } });
}
