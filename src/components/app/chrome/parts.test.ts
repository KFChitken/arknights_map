import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { T } from "@/i18n";
import type { ListenTrack } from "@/lib/listen";
import { ListenIcon, listenLabel, listenWord, type ListenEntry } from "./parts";

// 听歌's entry on the map (each layout's button, from useListenEntry): what it says and how its bars stand

const TRACK = { id: "s1", name: "火与尘" } as ListenTrack;
const entry = (e: Partial<ListenEntry>): ListenEntry => ({
  on: false,
  buffering: false,
  lit: false,
  together: null,
  track: null,
  fresh: false,
  asks: 0,
  ...e,
});

describe("听歌's entry", () => {
  it("says 缓冲中 while the song is asked for or waits for more of it, 在听 once it sounds", () => {
    expect(listenWord(entry({ on: true, buffering: true, track: TRACK }))).toBe(T.map.bar.listenBuffering);
    expect(listenLabel(entry({ on: true, buffering: true, track: TRACK }))).toBe("听歌，正在缓冲《火与尘》");
    expect(listenWord(entry({ on: true, track: TRACK }))).toBe(T.map.bar.listenNow);
    expect(listenLabel(entry({ on: true, track: TRACK }))).toBe("听歌，正在听《火与尘》");
    expect(listenWord(entry({ track: TRACK }))).toBe(T.map.bar.listen);
  });

  it("says how many are in the room while in one, buffering or not", () => {
    expect(listenWord(entry({ on: true, buffering: true, together: 3, track: TRACK }))).toBe("一起 3 人");
    expect(listenLabel(entry({ on: true, buffering: true, together: 3, track: TRACK }))).toBe("听歌，一起听 3 人");
  });

  it("stands its bars still while the song does not sound yet, and keeps the note while nothing plays", () => {
    const bars = (still: boolean) => renderToStaticMarkup(createElement(ListenIcon, { on: true, still, size: 20 }));
    expect(bars(true)).toContain('class="listen-bars still"');
    expect(bars(false)).toContain('class="listen-bars"');
    expect(renderToStaticMarkup(createElement(ListenIcon, { on: false, still: true, size: 20 }))).not.toContain("listen-bars");
  });
});
