import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Sheet from "./Sheet";

/** The sheet's own props but its body, given as its child */
type Props = Omit<ComponentProps<typeof Sheet>, "children">;
const sheet = (props: Props, body: string | ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(Sheet, props as ComponentProps<typeof Sheet>, body));

describe("a sheet", () => {
  it("draws what opens over it (over) after its foot, out of its scrolling body", () => {
    const html = sheet(
      { title: "t", onClose: () => {}, footer: createElement("b", null, "foot"), over: createElement("div", { className: "ask" }, "ask") },
      createElement("p", null, "body"),
    );
    expect(html).toContain('<div class="sheet-body"><p>body</p></div><footer class="sheet-foot"><b>foot</b></footer><div class="ask">ask</div></section>');
    // nothing over it: as it was
    expect(sheet({ title: "t", onClose: () => {} }, "body")).toContain('<div class="sheet-body">body</div></section>');
  });
});
