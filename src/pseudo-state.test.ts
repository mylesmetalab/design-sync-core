import { describe, expect, it } from "vitest";

import {
  REWRITABLE_PSEUDO_STATES,
  isRewritablePseudoState,
  pseudoStateClass,
  pseudoStatesInSelector,
  rewriteSelector,
  splitSelectorList,
} from "./pseudo-state.js";

describe("pseudoStateClass", () => {
  it("uses the upstream addon's naming so the two rewrites are idempotent", () => {
    // Changing this breaks cohabitation with storybook-addon-pseudo-states.
    expect(pseudoStateClass("hover")).toBe("pseudo-hover");
    expect(pseudoStateClass("focus-visible")).toBe("pseudo-focus-visible");
  });
});

describe("REWRITABLE_PSEUDO_STATES", () => {
  it("lists focus-visible and focus-within before focus", () => {
    // The alternation is tried in order; `focus` first would match the prefix of
    // `:focus-visible` and rewrite it through the wrong branch.
    const list = [...REWRITABLE_PSEUDO_STATES];
    expect(list.indexOf("focus-visible")).toBeLessThan(list.indexOf("focus"));
    expect(list.indexOf("focus-within")).toBeLessThan(list.indexOf("focus"));
  });

  it("accepts its own members and nothing else", () => {
    for (const s of REWRITABLE_PSEUDO_STATES) expect(isRewritablePseudoState(s)).toBe(true);
    for (const s of ["error", "open", "Hover", ""]) {
      expect(isRewritablePseudoState(s)).toBe(false);
    }
  });
});

describe("splitSelectorList", () => {
  it("splits on top-level commas", () => {
    expect(splitSelectorList(".a, .b , .c")).toEqual([".a", ".b", ".c"]);
  });

  it("does not split inside functional pseudos or attribute values", () => {
    expect(splitSelectorList(":is(.a, .b) .c")).toEqual([":is(.a, .b) .c"]);
    expect(splitSelectorList('[data-x="a, b"], .c')).toEqual(['[data-x="a, b"]', ".c"]);
  });

  it("does not split inside a quoted string containing a bracket", () => {
    expect(splitSelectorList('[title="a ] b, c"], .d')).toEqual(['[title="a ] b, c"]', ".d"]);
  });

  it("respects a backslash-escaped quote", () => {
    expect(splitSelectorList('[title="a\\" , b"], .c')).toEqual(['[title="a\\" , b"]', ".c"]);
  });
});

describe("rewriteSelector", () => {
  it("returns the selector unchanged when there is nothing to rewrite", () => {
    for (const sel of [".button", ".a > .b", "::before", '[data-state="open"]']) {
      expect(rewriteSelector(sel)).toBe(sel);
    }
  });

  it("emits the element form and the ancestor form", () => {
    const out = rewriteSelector(".button:hover");
    const parts = out.split(", ");
    expect(parts).toContain(".button:hover");
    expect(parts).toContain(".button.pseudo-hover");
    expect(parts).toContain(".pseudo-hover .button");
  });

  it("keeps the original selector first, so specificity order is unchanged", () => {
    expect(rewriteSelector(".button:hover").split(", ")[0]).toBe(".button:hover");
  });

  it("rewrites a Tailwind escaped-colon utility", () => {
    // This is the real shape: `hover:bg-primary-hover` escapes to `.hover\:…`.
    const out = rewriteSelector(".hover\\:bg-primary-hover:hover");
    expect(out).toContain(".hover\\:bg-primary-hover.pseudo-hover");
    expect(out).toContain(".pseudo-hover .hover\\:bg-primary-hover");
  });

  it("leaves vendor pseudo-elements alone", () => {
    const sel = "input::-webkit-slider-thumb:hover";
    expect(rewriteSelector(sel)).toBe(sel);
  });

  it("does not treat a double-colon pseudo-element as a pseudo-class", () => {
    // `(?<!:)` is what stops `::link`-alikes being rewritten.
    expect(rewriteSelector(".a::target-text")).toBe(".a::target-text");
  });

  it("does not rewrite a functional pseudo of the same name", () => {
    // `:not(...)` is followed by "(" so the `(?!\()` guard skips it; the inner
    // `:hover` is still a real occurrence and is rewritten.
    const out = rewriteSelector(".a:not(.b):hover");
    expect(out).toContain(".a:not(.b).pseudo-hover");
  });

  it("skips the ancestor form when stripping would leave an invalid :not()", () => {
    // `.a:not(:hover)` → stripping gives `.a:not()`, which is invalid CSS and
    // would make the browser reject the WHOLE list, killing the working rule.
    const out = rewriteSelector(".a:not(:hover)");
    expect(out).not.toMatch(/:not\(\s*\)/);
  });

  it("handles each state in a multi-state selector without duplicating", () => {
    const out = rewriteSelector(".a:hover:focus");
    const parts = out.split(", ");
    expect(new Set(parts).size).toBe(parts.length);
    // Upstream replaces all at once: one class pair covers the rule.
    expect(parts).toContain(".a.pseudo-hover.pseudo-focus");
  });

  it("rewrites every part of a selector list independently", () => {
    const out = rewriteSelector(".a:hover, .b:focus");
    expect(out).toContain(".a.pseudo-hover");
    expect(out).toContain(".b.pseudo-focus");
  });

  it("distinguishes focus-visible from focus", () => {
    const out = rewriteSelector(".a:focus-visible");
    expect(out).toContain(".a.pseudo-focus-visible");
    // The bug this guards: matching `focus` first yields `.pseudo-focus-visible`
    // only if ordering is right; a wrong order gives `.pseudo-focus-visible`
    // spelled as `.pseudo-focus` + leftover text.
    expect(out).not.toContain(".pseudo-focus-visible-visible");
    expect(out).not.toMatch(/\.pseudo-focus(?!-visible)/);
  });

  it("terminates on a selector with many occurrences", () => {
    // Regression: sharing one global regex between exec and replace reset
    // lastIndex and looped forever. If this ever hangs, that is back.
    const sel = Array.from({ length: 40 }, (_, i) => `.c${i}:hover`).join(", ");
    const out = rewriteSelector(sel);
    expect(out).toContain(".c39.pseudo-hover");
  });

  it("is stable: rewriting an already-rewritten selector adds nothing new", () => {
    // Cohabitation with the upstream addon depends on this being a no-op.
    const once = rewriteSelector(".button:hover");
    const twice = rewriteSelector(once);
    expect(new Set(twice.split(", "))).toEqual(new Set(once.split(", ")));
  });
});

describe("pseudoStatesInSelector", () => {
  it("finds pseudo-class occurrences", () => {
    expect(pseudoStatesInSelector(".a:hover")).toEqual(["hover"]);
    expect(pseudoStatesInSelector(".a:focus-visible")).toEqual(["focus-visible"]);
  });

  it("finds the rewritten class form too", () => {
    expect(pseudoStatesInSelector(".a.pseudo-hover")).toEqual(["hover"]);
  });

  it("returns vocabulary order, not occurrence order", () => {
    expect(pseudoStatesInSelector(".a:active:hover")).toEqual(["hover", "active"]);
  });

  it("de-duplicates across the two forms", () => {
    expect(pseudoStatesInSelector(".a:hover, .a.pseudo-hover")).toEqual(["hover"]);
  });

  it("returns nothing for a stateless selector", () => {
    expect(pseudoStatesInSelector(".a > .b")).toEqual([]);
  });
});
