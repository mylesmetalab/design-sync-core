import { describe, it, expect } from "vitest";
import { parseTailwindTheme, mergeTailwindThemes, hasTailwindTheme } from "./tailwind-theme.js";
import {
  classifyTailwindUtility,
  classifyTailwindClassList,
  composeTailwindBindings,
  splitVariants,
  isDefaultState,
} from "./tailwind.js";

/**
 * A shadcn-shaped Tailwind v4 theme: `@theme inline` aliases the Tailwind
 * namespace onto the project's real token custom properties, which live in
 * `:root`. This is the exact shape `design-sync-starter/src/index.css` uses.
 */
const SHADCN_CSS = `
@import "tailwindcss";

/* a commented-out decl must not register: --color-ignored: red; */

@theme inline {
  --font-sans: 'Inter Variable', 'Inter', sans-serif;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-hover);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-border-neutral: var(--border-neutral);
  --color-foreground: var(--foreground);
  --color-disabled: var(--disabled);
  --radius-sm: 0.25rem;
  --radius-md: var(--radius);
  --radius-lg: 1rem;
  --leading-tight: 1.1;
  --tracking-wide: 0.02em;
  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.08);
}

:root {
  --primary: #2c2c2c;
  --radius: 0.5rem;
}
`;

const THEME = parseTailwindTheme(SHADCN_CSS);

describe("parseTailwindTheme", () => {
  it("collects @theme custom properties without the leading --", () => {
    expect(THEME["color-primary"]).toBe("var(--primary)");
    expect(THEME["radius-md"]).toBe("var(--radius)");
    expect(THEME["text-base"]).toBe("1rem");
  });

  it("ignores declarations outside @theme blocks", () => {
    // `--primary` lives in `:root`, not `@theme` — Tailwind derives no utility
    // name from it, so it must not become a lookup key.
    expect(THEME["primary"]).toBeUndefined();
    expect(THEME["radius"]).toBeUndefined();
  });

  it("ignores commented-out declarations", () => {
    expect(THEME["color-ignored"]).toBeUndefined();
  });

  it("handles several @theme blocks, later winning, and reports emptiness", () => {
    const merged = parseTailwindTheme(
      `@theme { --color-a: red; } @theme inline { --color-a: blue; --color-b: green; }`,
    );
    expect(merged).toEqual({ "color-a": "blue", "color-b": "green" });
    expect(hasTailwindTheme(merged)).toBe(true);
    expect(hasTailwindTheme(parseTailwindTheme(":root { --x: 1px; }"))).toBe(false);
  });

  it("skips nested rules inside a @theme block", () => {
    const vars = parseTailwindTheme(
      `@theme { --color-a: red; .nested { --color-b: blue; } --color-c: green; }`,
    );
    expect(vars["color-a"]).toBe("red");
    expect(vars["color-c"]).toBe("green");
    expect(vars["color-b"]).toBeUndefined();
  });

  it("merges themes from several stylesheets, later winning", () => {
    expect(
      mergeTailwindThemes({ "color-a": "red" }, { "color-a": "blue", "color-b": "x" }),
    ).toEqual({ "color-a": "blue", "color-b": "x" });
  });

  it("tolerates a truncated block rather than throwing", () => {
    expect(() => parseTailwindTheme("@theme { --color-a: red;")).not.toThrow();
  });
});

describe("splitVariants", () => {
  const cases: Array<[string, string[], string]> = [
    ["bg-primary", [], "bg-primary"],
    ["hover:bg-primary-hover", ["hover"], "bg-primary-hover"],
    ["dark:hover:bg-x", ["dark", "hover"], "bg-x"],
    ["data-disabled:bg-disabled", ["data-disabled"], "bg-disabled"],
    // The colon inside the bracket must NOT split.
    ["supports-[display:grid]:flex", ["supports-[display:grid]"], "flex"],
    ["data-[state=open]:bg-primary", ["data-[state=open]"], "bg-primary"],
    ["[&_svg]:size-4", ["[&_svg]"], "size-4"],
  ];
  for (const [input, variants, utility] of cases) {
    it(`splits ${input}`, () => {
      expect(splitVariants(input)).toEqual({ variants, utility });
    });
  }
});

describe("classifyTailwindUtility — families that resolve", () => {
  // [class, expected properties, expected token, expected themeVar]
  const cases: Array<[string, string[], string, string]> = [
    // colour: the `@theme inline` alias is followed exactly one hop, so the
    // reported token is the project's real token (`primary`), not the
    // Tailwind-namespace alias (`color-primary`).
    ["bg-primary", ["background-color"], "primary", "color-primary"],
    ["bg-secondary", ["background-color"], "secondary", "color-secondary"],
    ["text-foreground", ["color"], "foreground", "color-foreground"],
    ["text-primary-foreground", ["color"], "primary-foreground", "color-primary-foreground"],
    ["border-primary", ["border-color"], "primary", "color-primary"],
    ["border-border-neutral", ["border-color"], "border-neutral", "color-border-neutral"],
    ["border-t-primary", ["border-top-color"], "primary", "color-primary"],
    ["border-b-primary", ["border-bottom-color"], "primary", "color-primary"],
    [
      "border-x-primary",
      ["border-left-color", "border-right-color"],
      "primary",
      "color-primary",
    ],
    [
      "border-y-primary",
      ["border-top-color", "border-bottom-color"],
      "primary",
      "color-primary",
    ],
    // font-size vs colour disambiguation: `--text-base` exists, `--color-base`
    // does not, so `text-base` is a font size.
    ["text-base", ["font-size"], "text-base", "text-base"],
    ["text-sm", ["font-size"], "text-sm", "text-sm"],
    // font-family (`--font-sans`); the value is not a bare var so the theme
    // key itself is the token.
    ["font-sans", ["font-family"], "font-sans", "font-sans"],
    // radius: `--radius-md: var(--radius)` → one hop → `radius`.
    [
      "rounded-md",
      [
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-left-radius",
        "border-bottom-right-radius",
      ],
      "radius",
      "radius-md",
    ],
    [
      "rounded-lg",
      [
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-left-radius",
        "border-bottom-right-radius",
      ],
      "radius-lg",
      "radius-lg",
    ],
    [
      "rounded-t-sm",
      ["border-top-left-radius", "border-top-right-radius"],
      "radius-sm",
      "radius-sm",
    ],
    ["rounded-tl-sm", ["border-top-left-radius"], "radius-sm", "radius-sm"],
    ["rounded-br-sm", ["border-bottom-right-radius"], "radius-sm", "radius-sm"],
    ["leading-tight", ["line-height"], "leading-tight", "leading-tight"],
    ["tracking-wide", ["letter-spacing"], "tracking-wide", "tracking-wide"],
    ["shadow-card", ["box-shadow"], "shadow-card", "shadow-card"],
  ];

  for (const [cls, properties, token, themeVar] of cases) {
    it(`${cls} → ${properties.join(", ")} = ${token}`, () => {
      const b = classifyTailwindUtility(cls, THEME);
      expect(b, `${cls} should resolve`).not.toBeNull();
      expect(b!.properties).toEqual(properties);
      expect(b!.token).toBe(token);
      expect(b!.themeVar).toBe(themeVar);
      expect(b!.variants).toEqual([]);
      expect(isDefaultState(b!)).toBe(true);
    });
  }

  it("expands a padding shorthand to all four longhands when the token exists", () => {
    const theme = { ...THEME, "spacing-3": "0.75rem" };
    const b = classifyTailwindUtility("p-3", theme);
    expect(b!.properties).toEqual([
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
    ]);
    expect(b!.token).toBe("spacing-3");
  });

  it("expands axis spacing utilities to the right longhands", () => {
    const theme = { ...THEME, "spacing-2": "0.5rem" };
    expect(classifyTailwindUtility("px-2", theme)!.properties).toEqual([
      "padding-left",
      "padding-right",
    ]);
    expect(classifyTailwindUtility("py-2", theme)!.properties).toEqual([
      "padding-top",
      "padding-bottom",
    ]);
    expect(classifyTailwindUtility("pt-2", theme)!.properties).toEqual(["padding-top"]);
    expect(classifyTailwindUtility("gap-2", theme)!.properties).toEqual(["gap"]);
    expect(classifyTailwindUtility("gap-x-2", theme)!.properties).toEqual(["column-gap"]);
    expect(classifyTailwindUtility("gap-y-2", theme)!.properties).toEqual(["row-gap"]);
  });

  it("resolves font-weight when the consumer declares the namespace", () => {
    const theme = { ...THEME, "font-weight-normal": "400" };
    const b = classifyTailwindUtility("font-normal", theme);
    expect(b!.properties).toEqual(["font-weight"]);
    expect(b!.token).toBe("font-weight-normal");
  });

  it("keeps the font-size half of text-<size>/<line-height>", () => {
    const b = classifyTailwindUtility("text-base/[1]", THEME);
    expect(b).not.toBeNull();
    expect(b!.properties).toEqual(["font-size"]);
    expect(b!.token).toBe("text-base");
  });

  it("strips a v3 or v4 important marker", () => {
    expect(classifyTailwindUtility("!bg-primary", THEME)!.token).toBe("primary");
    expect(classifyTailwindUtility("bg-primary!", THEME)!.token).toBe("primary");
  });
});

describe("classifyTailwindUtility — must produce NO binding", () => {
  // Each case is a class the mapper must refuse, plus why. A wrong token here
  // becomes an authoritative-looking drift row that is false, which is worse
  // than the row being absent.
  const cases: Array<[string, string]> = [
    ["bg-[#444]", "arbitrary colour — there is no token"],
    ["p-[13px]", "arbitrary length — there is no token"],
    ["rounded-[6px]", "arbitrary radius"],
    ["ring-[3px]", "arbitrary value on an unsupported family"],
    ["bg-(--my-var)", "v4 arbitrary custom-property shorthand"],
    ["text-[16px]/[1]", "arbitrary font size"],
    ["p-3", "numeric spacing under the --spacing multiplier; no --spacing-3 declared"],
    ["gap-2", "same: no --spacing-2 declared"],
    ["px-4", "same"],
    ["font-normal", "no --font-weight-normal in the consumer theme"],
    ["bg-transparent", "no --color-transparent in the consumer theme (Tailwind default)"],
    ["border-transparent", "same"],
    ["text-white", "no --color-white in the consumer theme (Tailwind default)"],
    ["rounded", "bare `rounded` — scale key is version-dependent"],
    ["border", "bare `border` is a literal 1px, not a theme lookup"],
    ["shadow", "bare `shadow`"],
    ["bg-primary/50", "modified colour — the paint is derived, not the token"],
    ["border-primary/20", "same"],
    ["outline-none", "unsupported family"],
    ["inline-flex", "not a token family"],
    ["items-center", "not a token family"],
    ["justify-center", "not a token family"],
    ["whitespace-nowrap", "not a token family"],
    ["transition-colors", "not a token family"],
    ["pointer-events-none", "not a token family"],
    ["size-4", "unsupported family (width/height are not snapshotted)"],
    ["my-custom-utility", "unknown custom utility"],
    ["bg-", "empty scale key"],
    ["", "empty class"],
    ["w-full", "unsupported family"],
    ["m-4", "margin is not snapshotted"],
    ["opacity-50", "no theme namespace for opacity in v4"],
    ["text-left", "keyword utility, not a token"],
  ];

  for (const [cls, why] of cases) {
    it(`${JSON.stringify(cls)} → null (${why})`, () => {
      expect(classifyTailwindUtility(cls, THEME)).toBeNull();
    });
  }

  it("refuses a scale key that resolves in two namespaces at once", () => {
    // A consumer declaring both `--font-weight-bold` and `--font-bold` makes
    // `font-bold` genuinely ambiguous.
    const theme = { "font-weight-bold": "700", "font-bold": "Inter Bold" };
    expect(classifyTailwindUtility("font-bold", theme)).toBeNull();
    // …and `text-x` in both `--text-` and `--color-`.
    const theme2 = { "text-x": "1rem", "color-x": "#fff" };
    expect(classifyTailwindUtility("text-x", theme2)).toBeNull();
  });

  it("produces nothing at all when the consumer has no @theme block", () => {
    expect(classifyTailwindClassList("bg-primary rounded-md text-base", {})).toEqual([]);
  });
});

describe("classifyTailwindUtility — variant modifiers", () => {
  // The decision: a class carrying ANY variant modifier is parsed, but is NOT
  // part of the default-state binding. `hover:bg-primary-hover` is not the
  // resting background, and the drift snapshot reads an un-hovered element.
  const modified: Array<[string, string[]]> = [
    ["hover:bg-primary-hover", ["hover"]],
    ["focus-visible:bg-primary", ["focus-visible"]],
    ["disabled:bg-disabled", ["disabled"]],
    ["data-disabled:bg-disabled", ["data-disabled"]],
    ["data-[state=open]:bg-primary", ["data-[state=open]"]],
    ["dark:bg-secondary", ["dark"]],
    ["sm:rounded-lg", ["sm"]],
    ["dark:hover:bg-primary-hover", ["dark", "hover"]],
  ];

  for (const [cls, variants] of modified) {
    it(`${cls} is classified but is not default state`, () => {
      const b = classifyTailwindUtility(cls, THEME);
      expect(b, `${cls} should still classify`).not.toBeNull();
      expect(b!.variants).toEqual(variants);
      expect(isDefaultState(b!)).toBe(false);
    });
  }

  it("excludes every modified class from a composed default-state binding", () => {
    const set = composeTailwindBindings(
      "bg-primary hover:bg-primary-hover data-disabled:bg-disabled dark:bg-secondary",
      [],
      THEME,
    );
    // Only the unprefixed class contributes.
    expect(set.bindings["background-color"]).toEqual({
      token: "primary",
      className: "bg-primary",
      themeVar: "color-primary",
    });
    expect(set.conflicts).toEqual([]);
  });

  it("leaves a property unbound when only modified classes target it", () => {
    const set = composeTailwindBindings("hover:bg-primary-hover", [], THEME);
    expect(set.bindings).toEqual({});
  });
});

describe("composeTailwindBindings", () => {
  // The starter's Button: cva base + a `variant` axis + a `size` axis.
  const BASE =
    "inline-flex items-center justify-center gap-2 rounded-md border " +
    "font-sans text-base/[1] font-normal whitespace-nowrap transition-colors " +
    "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 " +
    "data-disabled:pointer-events-none data-disabled:bg-disabled " +
    "data-disabled:border-disabled-foreground data-disabled:text-disabled-foreground " +
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";
  const PRIMARY = "bg-primary border-primary text-primary-foreground hover:bg-primary-hover";
  const NEUTRAL = "bg-secondary border-border-neutral text-foreground hover:bg-secondary-hover";
  const SUBTLE = "bg-transparent border-transparent text-foreground hover:border-border";

  it("resolves the primary/medium button to exactly the certain bindings", () => {
    const set = composeTailwindBindings(BASE, [PRIMARY, "p-3"], THEME);
    expect(set.bindings).toEqual({
      "border-top-left-radius": { token: "radius", className: "rounded-md", themeVar: "radius-md" },
      "border-top-right-radius": { token: "radius", className: "rounded-md", themeVar: "radius-md" },
      "border-bottom-left-radius": { token: "radius", className: "rounded-md", themeVar: "radius-md" },
      "border-bottom-right-radius": { token: "radius", className: "rounded-md", themeVar: "radius-md" },
      "font-family": { token: "font-sans", className: "font-sans", themeVar: "font-sans" },
      "font-size": { token: "text-base", className: "text-base/[1]", themeVar: "text-base" },
      "background-color": { token: "primary", className: "bg-primary", themeVar: "color-primary" },
      "border-color": { token: "primary", className: "border-primary", themeVar: "color-primary" },
      color: {
        token: "primary-foreground",
        className: "text-primary-foreground",
        themeVar: "color-primary-foreground",
      },
    });
    // `p-3`, `gap-2`, `border`, `font-normal`, and every `hover:` /
    // `data-disabled:` class contribute nothing — see the no-binding suite.
    expect(set.bindings["padding-top"]).toBeUndefined();
    expect(set.bindings["gap"]).toBeUndefined();
    expect(set.bindings["border-width"]).toBeUndefined();
    expect(set.bindings["font-weight"]).toBeUndefined();
    expect(set.conflicts).toEqual([]);
  });

  it("resolves a different variant to that variant's tokens only", () => {
    const set = composeTailwindBindings(BASE, [NEUTRAL, "p-2"], THEME);
    expect(set.bindings["background-color"]!.token).toBe("secondary");
    expect(set.bindings["border-color"]!.token).toBe("border-neutral");
    expect(set.bindings["color"]!.token).toBe("foreground");
  });

  it("omits properties whose variant class has no token (bg-transparent)", () => {
    const set = composeTailwindBindings(BASE, [SUBTLE, "p-3"], THEME);
    expect(set.bindings["background-color"]).toBeUndefined();
    expect(set.bindings["border-color"]).toBeUndefined();
    expect(set.bindings["color"]!.token).toBe("foreground");
  });

  it("lets a later overlay override the base (cva + tailwind-merge semantics)", () => {
    const set = composeTailwindBindings("rounded-sm", ["rounded-lg"], THEME);
    expect(set.bindings["border-top-left-radius"]!.token).toBe("radius-lg");
    expect(set.conflicts).toEqual([]);
  });

  it("lets a later overlay axis override an earlier one", () => {
    const set = composeTailwindBindings("", ["bg-primary", "bg-secondary"], THEME);
    expect(set.bindings["background-color"]!.token).toBe("secondary");
  });

  it("reports a conflict, and emits nothing, when one class list disagrees with itself", () => {
    const set = composeTailwindBindings("bg-primary bg-secondary", [], THEME);
    expect(set.bindings["background-color"]).toBeUndefined();
    expect(set.conflicts).toEqual(["background-color"]);
  });

  it("keeps a conflict sticky — a later layer cannot un-poison it", () => {
    const set = composeTailwindBindings("bg-primary bg-secondary", ["bg-foreground"], THEME);
    expect(set.bindings["background-color"]).toBeUndefined();
    expect(set.conflicts).toEqual(["background-color"]);
  });

  it("does not treat two classes naming the same token as a conflict", () => {
    const set = composeTailwindBindings("bg-primary bg-primary", [], THEME);
    expect(set.bindings["background-color"]!.token).toBe("primary");
    expect(set.conflicts).toEqual([]);
  });
});
