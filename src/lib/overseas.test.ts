import { describe, expect, it, vi } from "vitest";
import { overseasStyle } from "./overseas";

// the style only, without a browser: MapLibre's map-file reader is not needed to build it
vi.mock("maplibre-gl", () => ({ default: { addProtocol: () => {} } }));
vi.mock("pmtiles", () => ({ Protocol: class { tile = () => {} } }));

const MILITARY = /military|naval_base|airfield/;

describe("our own map's style", () => {
  it("draws no military areas and names none, and still draws the parks", () => {
    const style = overseasStyle("https://zhoupmap.com");
    const park = style.layers.find((l) => l.id === "landuse_park");
    const parkFilter = park && "filter" in park ? park.filter : null;
    expect(JSON.stringify(parkFilter)).not.toMatch(MILITARY);
    expect(parkFilter).toEqual(expect.arrayContaining(["park", "forest"]));
    const pois = style.layers.find((l) => l.id === "pois");
    expect(pois && "filter" in pois ? pois.filter : null).toEqual([
      "all",
      expect.anything(),
      ["!", ["in", ["get", "kind"], ["literal", ["military", "naval_base", "airfield"]]]],
    ]);
    for (const l of style.layers) {
      if (l.id !== "pois") expect(JSON.stringify("filter" in l ? l.filter : null)).not.toMatch(MILITARY);
    }
  });

  it("still shows no borders and no country names", () => {
    const ids = overseasStyle("https://zhoupmap.com").layers.map((l) => l.id);
    expect(ids).not.toContain("boundaries_country");
    expect(ids).not.toContain("places_country");
  });
});
