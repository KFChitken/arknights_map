import { describe, expect, it } from "vitest";
import { toGcj } from "./coords";
import { keyTrouble, tencentPlaces, tencentUrl } from "./tencent";

describe("腾讯位置服务's typing suggestions", () => {
  it("asks for eight places and cities as JSONP, near the view's center as Chinese maps draw it", () => {
    const near = { lng: 121.4453, lat: 31.2234 };
    const url = new URL(tencentUrl("静安寺", near, "__zhoupTips1", "test-key"));
    expect(url.origin + url.pathname).toBe("https://apis.map.qq.com/ws/place/v1/suggestion");
    const p = Object.fromEntries(url.searchParams);
    expect(p).toMatchObject({
      keyword: "静安寺",
      key: "test-key",
      get_ad: "1",
      address_format: "short",
      page_size: "8",
      page_index: "1",
      output: "jsonp",
      callback: "__zhoupTips1",
    });
    const [lng, lat] = toGcj(near);
    expect(p.location).toBe(`${lat.toFixed(6)},${lng.toFixed(6)}`);
    expect(new URL(tencentUrl("秋叶原", undefined, "cb", "k")).searchParams.has("location")).toBe(false);
  });

  it("turns its places back from the shifted map, except in Taiwan, where they come as they are", () => {
    const { status, places } = tencentPlaces({
      status: 0,
      count: 4,
      data: [
        { title: "静安寺", address: "南京西路1686号", province: "上海市", city: "上海市", district: "静安区", adcode: 310106, type: 0, location: { lat: 31.22344, lng: 121.4453 } },
        { title: "静安寺[地铁站]", address: "2号线;7号线;14号线", province: "上海市", city: "上海市", district: "静安区", adcode: 310106, type: 2, location: { lat: 31.223351, lng: 121.446679 } },
        { title: "台北101", address: "信义路五段7号", province: "台湾省", city: "台北市", district: "信义区", adcode: 710100, type: 0, location: { lat: 25.033976, lng: 121.564539 } },
        { title: "成都市", adcode: 510100, type: 4, location: { lat: 30.572961, lng: 104.066301 } },
      ],
    });
    expect(status).toBe(0);
    expect(places.map((p) => [p.name, p.detail])).toEqual([
      ["静安寺", "上海市 · 静安区 · 南京西路1686号"],
      ["静安寺[地铁站]", "上海市 · 静安区 · 2号线;7号线;14号线"],
      ["台北101", "台湾省 · 台北市 · 信义区 · 信义路五段7号"],
      ["成都市", ""],
    ]);
    // Chinese maps draw Shanghai about 500 m to the south-east: undone, the spot moves back
    expect(places[0].lng).toBeLessThan(121.4453 - 0.003);
    expect(places[0].lat).toBeGreaterThan(31.22344 + 0.001);
    expect(places[2]).toMatchObject({ lng: 121.564539, lat: 25.033976 });
  });

  it("drops what it cannot place, and reads a refusal or a broken answer as no places", () => {
    expect(
      tencentPlaces({
        status: 0,
        data: [{ title: "", location: { lat: 1, lng: 1 } }, { title: "无处", adcode: 310106 }, { title: "两次", location: { lat: 31, lng: 121 } }, { title: "两次", location: { lat: 31, lng: 121 } }],
      }).places.map((p) => p.name),
    ).toEqual(["两次"]);
    expect(tencentPlaces({ status: 121, message: "此key每日调用量已达到上限" })).toEqual({ status: 121, places: [] });
    expect(tencentPlaces(null)).toEqual({ status: -1, places: [] });
    expect(tencentPlaces({ status: 0, data: "nothing" })).toEqual({ status: 0, places: [] });
  });

  it("leaves Tencent alone only when the key itself is turned away", () => {
    expect([110, 121, 199, 311].every(keyTrouble)).toBe(true);
    // too many this second, nothing found, its own trouble: one ask only
    expect([0, 120, 347, 500].some(keyTrouble)).toBe(false);
  });
});
