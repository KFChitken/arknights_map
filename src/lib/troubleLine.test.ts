import { describe, expect, it } from "vitest";
import { troubleLine } from "./troubleLine";

describe("a line of what went wrong on a page, as fit to keep", () => {
  it("keeps what the browser said of the code", () => {
    expect(troubleLine("TypeError: Cannot read properties of null (reading 'getSource')")).toBe(
      "TypeError: Cannot read properties of null (reading 'getSource')",
    );
    expect(troubleLine("Error: Minified React error #418")).toBe("Error: Minified React error #418");
  });

  it("drops what could be the visitor's: quoted values, addresses, places, long numbers and Chinese", () => {
    expect(troubleLine(`SyntaxError: Unexpected token 'B', "Breeze's 资料 {" is not valid JSON`)).toBe(
      "SyntaxError: Unexpected token 'B' is not valid JSON",
    );
    expect(troubleLine("Failed to fetch https://zhoupmap.com/api/me?email=me@example.com now")).toBe("Failed to fetch now");
    expect(troubleLine("bad me@example.com here")).toBe("bad here");
    expect(troubleLine("Error: 不能这样回应 阿米娅")).toBe("Error:");
    expect(troubleLine("at 121.4737, 31.2304 id 1234567 of 3")).toBe("at N N id N of 3");
    expect(troubleLine(`no '${"a".repeat(50)}' and \`x = 1\``)).toBe("no '' and");
  });

  it("has nothing a mail app would make a link of, is short, and is the same made twice", () => {
    expect(troubleLine("e.getSource is not a function at zhoupmap.com/x")).toBe("e getSource is not a function at zhoupmap com x");
    const long = troubleLine(`TypeError: ${"word ".repeat(80)}`);
    expect(long.length).toBeLessThanOrEqual(100);
    for (const s of ["TypeError: Cannot read properties of null (reading 'getSource')", `x "y" https://a.b/c d@e.f 1.5 123456 中`, long]) {
      expect(troubleLine(troubleLine(s))).toBe(troubleLine(s));
      expect(troubleLine(s)).not.toMatch(/[.@/"]/);
    }
  });
});
