import { wordsFile, wordsScript } from "@/i18n/server";

/**
 * /i18n/<lang>-<hash>.js: a page's words (src/i18n), loaded before the app starts. The
 * hash changes with the words, so the browser keeps a file for a year. A page from another
 * version (a process not yet restarted after a deploy) still gets this version's words, but
 * not to keep.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = wordsFile((await params).file);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(wordsScript(file.lang).body, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": file.current ? "public, max-age=31536000, immutable" : "no-store",
    },
  });
}
