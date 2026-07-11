import { describe, it, expect } from "vitest";
import {
  normalizeTokenName,
  tokenNameToCssVar,
  deriveSelectorChain,
  stripOneLayer,
  isSingleValue,
} from "./index.js";

describe("normalizeTokenName", () => {
  it("collapses all spellings to one canonical form", () => {
    const forms = ["--radius-xl", "radius/xl", "radius.xl", "Radius/XL", "radius--xl"];
    const canon = forms.map(normalizeTokenName);
    expect(new Set(canon).size).toBe(1);
    expect(canon[0]).toBe("radius-xl");
  });
  it("accepts null/undefined", () => {
    expect(normalizeTokenName(null)).toBe("");
    expect(normalizeTokenName(undefined)).toBe("");
    expect(normalizeTokenName("")).toBe("");
  });
});

describe("tokenNameToCssVar", () => {
  it("maps Figma slash names to CSS custom properties", () => {
    expect(tokenNameToCssVar("radius/xl")).toBe("--radius-xl");
    expect(tokenNameToCssVar("color/bg/primary")).toBe("--color-bg-primary");
  });
});

describe("deriveSelectorChain", () => {
  it("walks BEM modifiers and chained classes, most-specific first", () => {
    expect(deriveSelectorChain(".icon-button--accent")).toEqual([
      ".icon-button--accent",
      ".icon-button",
    ]);
    expect(deriveSelectorChain(".tab.active")).toEqual([".tab.active", ".tab"]);
  });
  it("stops at a bare single class", () => {
    expect(deriveSelectorChain(".foo")).toEqual([".foo"]);
  });
  it("is bounded at 4 fallback levels", () => {
    // A deeply chained selector should never produce an unbounded chain.
    const chain = deriveSelectorChain(".a--b--c--d--e--f");
    expect(chain.length).toBeLessThanOrEqual(5);
  });
});

describe("stripOneLayer", () => {
  it("returns null when nothing more can be stripped", () => {
    expect(stripOneLayer(".foo")).toBeNull();
  });
});

describe("isSingleValue", () => {
  it("accepts single tokens including nested parens", () => {
    expect(isSingleValue("var(--space-8)")).toBe(true);
    expect(isSingleValue("#fff")).toBe(true);
    expect(isSingleValue("rgb(0, 0, 0)")).toBe(true); // whitespace inside parens is fine
  });
  it("rejects multi-slot values and empties", () => {
    expect(isSingleValue("1px solid red")).toBe(false);
    expect(isSingleValue("  ")).toBe(false);
  });
});
