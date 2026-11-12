import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import { addMaplibreSi, setMaplibreSi } from "./siMap";
import type { SiMapData } from "./types";

// no DOM here: canvases as wide and high as asked, each picture of an ink roach counted as it is made
const { canvas, inkCanvas } = vi.hoisted(() => {
  const canvas = (w: number, h = w) => ({
    width: w,
    height: h,
    getContext: () => ({ getImageData: (_x: number, _y: number, cw: number, ch: number) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }) }),
  });
  return { canvas, inkCanvas: vi.fn(async (_look: string, _variant: string, px: number) => canvas(px)) };
});

vi.mock("./inkArt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inkArt")>()),
  inkCanvas,
  treeCanvas: (px: number) => canvas(px),
  signCanvas: (_text: string, h: number) => canvas(h * 2, h),
  butterflyCanvas: (_frame: number, px: number) => canvas(px),
  scrollCanvas: async (_tier: number, h: number) => canvas(h),
  rolledCanvas: async (w: number) => canvas(w, w / 4),
}));

/** Just what of MapLibre's map 缘缘庄 uses, its pictures by name */
function fakeMap() {
  const images = new Map<string, { width: number; height: number }>();
  const handlers = new Map<string, ((e: { id: string }) => void)[]>();
  const sources = new Map<string, { setData: () => void }>();
  const map = {
    images,
    hasImage: (id: string) => images.has(id),
    addImage: (id: string, img: { width: number; height: number }) => {
      if (images.has(id)) throw new Error(`${id} added twice`);
      images.set(id, { width: img.width, height: img.height });
    },
    updateImage: vi.fn((id: string, img: { width: number; height: number }) => {
      const was = images.get(id);
      if (!was || was.width !== img.width || was.height !== img.height) throw new Error(`${id} is not that size`);
    }),
    addSource: (id: string) => void sources.set(id, { setData: () => {} }),
    getSource: (id: string) => sources.get(id),
    addLayer: () => {},
    getLayer: () => undefined,
    getStyle: () => ({}),
    on: (type: string, fn: (e: { id: string }) => void) => void handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    /** MapLibre asking for a picture it lacks, as it lays out a tile */
    missing: (id: string) => handlers.get("styleimagemissing")?.forEach((fn) => fn({ id })),
  };
  return map;
}
const asMap = (m: ReturnType<typeof fakeMap>) => m as unknown as MaplibreMap;
const settle = () => new Promise((r) => setTimeout(r, 0));

const mine: NonNullable<SiMapData["mine"]> = { at: { lng: 117.9841, lat: 30.0041 }, look: "gugu", variant: "standL", color: "pink", size: 1, tilt: 0, ink: 1, brushFrom: null };
const si: SiMapData = { inn: null, inks: [], mine, tier: 0, innKey: "", inksKey: 0, mineKey: "" };
const ink = (name: string) => name.startsWith("si-ink-");

describe("缘缘庄's pictures on MapLibre", () => {
  beforeEach(() => inkCanvas.mockClear());

  it("downloads no ink roach as the map is made, your own neither", async () => {
    const map = fakeMap();
    addMaplibreSi(asMap(map), si);
    await settle();
    expect(inkCanvas).not.toHaveBeenCalled();
    expect([...map.images.keys()].filter((k) => ink(k) || k === "si-mine")).toEqual([]);
    // what is drawn without a download is there
    expect(map.hasImage("si-tree")).toBe(true);
  });

  it("makes every ink roach once the map first lays one out, a clear one of the same size standing in", async () => {
    const map = fakeMap();
    addMaplibreSi(asMap(map), si);
    map.missing("si-ink-hood-standR");
    expect(map.images.get("si-ink-hood-standR")).toEqual({ width: 64, height: 64 });
    map.missing("si-ink-imp-lieL");
    // five looks each four ways, asked for once however many are missing
    expect(inkCanvas).toHaveBeenCalledTimes(20);
    await settle();
    expect([...map.images.keys()].filter(ink)).toHaveLength(20);
    expect(map.updateImage.mock.calls.map(([id]) => id).sort()).toEqual(["si-ink-hood-standR", "si-ink-imp-lieL"]);
  });

  it("draws your own when the map asks for it, and again at once when it changes", async () => {
    const map = fakeMap();
    addMaplibreSi(asMap(map), si);
    map.missing("si-mine");
    expect(map.images.get("si-mine")).toEqual({ width: 64, height: 64 });
    expect(inkCanvas).toHaveBeenCalledWith("gugu", "standL", 64, "pink");
    await settle();
    expect(map.updateImage).toHaveBeenCalledWith("si-mine", expect.anything());
    setMaplibreSi(asMap(map), { ...si, mine: { ...mine, variant: "lieR" } }, { mine: true });
    expect(inkCanvas).toHaveBeenLastCalledWith("gugu", "lieR", 64, "pink");
  });

  it("leaves other missing pictures alone, and asks once a map however often its style is made", async () => {
    const map = fakeMap();
    addMaplibreSi(asMap(map), si);
    map.missing("someone-else");
    expect(map.hasImage("someone-else")).toBe(false);
    // a new style without her pictures
    map.images.clear();
    addMaplibreSi(asMap(map), si);
    map.missing("si-ink-doctor-standL");
    expect(inkCanvas).toHaveBeenCalledTimes(20);
    await settle();
  });
});
