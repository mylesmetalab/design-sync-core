import { describe, expect, it } from "vitest";

import {
  isModernColorNotation,
  oklabToRgba,
  oklchToRgba,
  parseHex,
  parseModernColor,
} from "./color.js";

/**
 * This module arrived by merging two forks that a differential test had already
 * proved identical (22 parse inputs, a 2,376-point OKLCh grid). So the job of
 * these tests is not to re-establish that — it is to stop the merged copy from
 * drifting away from the behaviour both consumers already ship.
 *
 * Two kinds of assertion below, and the difference matters:
 *
 *   - **Anchors** are verifiable by reasoning about the colour space (black is
 *     black, hue is periodic, out-of-gamut clamps). These are real assertions.
 *   - **Regression pins** are values captured from this implementation. They are
 *     NOT independent verification of the maths — they pin what two shipped
 *     products currently agree on, so a future edit cannot change it silently.
 *     Labelled as such rather than dressed up as ground truth.
 */

describe("anchors — true by construction of the colour space", () => {
  it("maps OKLCh lightness extremes to black and white", () => {
    expect(oklchToRgba(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(oklchToRgba(1, 0, 0)).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it("treats hue as periodic — 400° is 40°", () => {
    expect(oklchToRgba(0.6, 0.1, 400)).toEqual(oklchToRgba(0.6, 0.1, 40));
  });

  it("is achromatic at zero chroma, whatever the hue", () => {
    const grey = oklchToRgba(0.5, 0, 0);
    expect(grey.r).toBe(grey.g);
    expect(grey.g).toBe(grey.b);
    for (const h of [90, 180, 270]) expect(oklchToRgba(0.5, 0, h)).toEqual(grey);
  });

  it("clamps out-of-gamut colours per channel rather than throwing", () => {
    // OKLCh addresses colours sRGB cannot represent; C=0.4 at this hue is well
    // outside it. Lossy on purpose — documented in the module.
    const c = oklchToRgba(0.5, 0.4, 0);
    for (const ch of [c.r, c.g, c.b]) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(255);
      expect(Number.isInteger(ch)).toBe(true);
    }
  });

  it("agrees with itself through the polar/rectangular relationship", () => {
    // oklch(L C H) is oklab(L, C·cos H, C·sin H) — the same colour by definition.
    const L = 0.7;
    const C = 0.12;
    const H = 250;
    const rad = (H * Math.PI) / 180;
    expect(oklchToRgba(L, C, H)).toEqual(
      oklabToRgba(L, C * Math.cos(rad), C * Math.sin(rad)),
    );
  });

  it("carries alpha through untouched", () => {
    expect(oklchToRgba(0.5, 0.1, 30, 0.25).a).toBe(0.25);
  });
});

describe("parsing", () => {
  it("expands 3- and 4-digit hex the same way as 6- and 8-digit", () => {
    expect(parseHex("#abc")).toEqual(parseHex("#aabbcc"));
    expect(parseHex("#abcd")).toEqual(parseHex("#aabbccdd"));
  });

  it("reads hex alpha as 0-1", () => {
    expect(parseHex("#00000080")?.a).toBeCloseTo(0.502, 3);
    expect(parseHex("#000000ff")?.a).toBe(1);
  });

  /**
   * A value this module cannot parse must return `null`, never a coerced
   * best-effort colour — a consumer's fallback path depends on that being
   * distinguishable from a real reading.
   */
  it.each([
    "rgb(1 2 3)",
    "hsl(120 50% 50%)",
    "transparent",
    "notacolor",
    "",
    "oklch(0.7 0.15)",
    "color(rec2020 1 0 0)",
    "oklch(0.7 0.15 250",
  ])("returns null for %o", (input) => {
    expect(parseModernColor(input)).toBeNull();
  });

  it("accepts percentages on lightness and the chroma axes", () => {
    // CSS Color 4: 100% chroma means 0.4 on oklch/oklab's C and a/b axes.
    expect(parseModernColor("oklch(50% 25% 30)")).toEqual(parseModernColor("oklch(0.5 0.1 30)"));
  });

  it("accepts a `deg` suffix and a bare number as the same hue", () => {
    expect(parseModernColor("oklch(0.6 0.2 145deg)")).toEqual(
      parseModernColor("oklch(0.6 0.2 145)"),
    );
  });

  it("reads `none` as zero, per CSS Color 4 missing components", () => {
    expect(parseModernColor("oklch(0.85 none 0)")).toEqual(parseModernColor("oklch(0.85 0 0)"));
  });

  it("accepts both slash and percentage alpha", () => {
    expect(parseModernColor("oklab(0.5 0.1 -0.1 / 50%)")?.a).toBeCloseTo(0.5, 3);
    expect(parseModernColor("oklab(0.5 0.1 -0.1 / 0.5)")?.a).toBeCloseTo(0.5, 3);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(parseModernColor("  OKLCH( 0.7  0.15  250 )  ")).toEqual(
      parseModernColor("oklch(0.7 0.15 250)"),
    );
  });
});

describe("isModernColorNotation", () => {
  it.each(["oklch(0 0 0)", "oklab(0 0 0)", "color(display-p3 0 0 0)", "  OKLCH(0 0 0)"])(
    "recognises %o",
    (v) => expect(isModernColorNotation(v)).toBe(true),
  );

  /**
   * It is a *shape* test, deliberately — it must not imply parseability. A
   * caller that treats `true` as "this will parse" would mis-handle
   * `color(rec2020 …)`, which has the shape and returns null.
   */
  it("says true for a colour space it cannot actually convert", () => {
    expect(isModernColorNotation("color(rec2020 1 0 0)")).toBe(true);
    expect(parseModernColor("color(rec2020 1 0 0)")).toBeNull();
  });

  it.each(["rgb(0 0 0)", "#fff", "transparent", "colorful(1)", ""])("says false for %o", (v) =>
    expect(isModernColorNotation(v)).toBe(false),
  );
});

/**
 * Regression pins — captured from this implementation, which is the behaviour
 * two shipped products already agree on. NOT independent verification of the
 * conversion maths; the anchors above are the assertions that stand on their own.
 */
describe("regression pins (captured, not independently derived)", () => {
  it.each([
    ["oklch(0.7 0.15 250)", { r: 75, g: 163, b: 247, a: 1 }],
    ["oklch(50% 0.1 30 / 0.5)", { r: 148, g: 75, b: 64, a: 0.5 }],
    ["oklab(0.7 -0.1 0.05)", { r: 99, g: 179, b: 125, a: 1 }],
    ["color(display-p3 1 0 0)", { r: 255, g: 0, b: 0, a: 1 }],
    ["color(display-p3 0.2 0.5 0.9 / 0.3)", { r: 0, g: 130, b: 237, a: 0.3 }],
    ["oklch(0.6 0.2 145deg)", { r: 0, g: 157, b: 30, a: 1 }],
    ["oklch(.5 .4 400)", { r: 251, g: 0, b: 0, a: 1 }],
  ])("%o", (input, expected) => {
    expect(parseModernColor(input as string)).toEqual(expected);
  });

  it("converts display-p3 red to sRGB red exactly", () => {
    // Worth its own case: p3 red is *outside* sRGB, so this is the clamp
    // landing on the boundary rather than a coincidence.
    expect(parseModernColor("color(display-p3 1 0 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });
});
