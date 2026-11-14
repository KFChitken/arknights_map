import { NextResponse } from "next/server";
import { passArtList } from "@/lib/server/passArt";

/** GET /api/pass-art: which characters' passes have a picture, and its colour (src/lib/passArt.ts); empty when switched off */
export async function GET() {
  return NextResponse.json(await passArtList(), { headers: { "cache-control": "public, max-age=300" } });
}
