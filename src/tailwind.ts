/**
 * Tailwind utility class → design-token binding.
 *
 * The problem this solves: a component that expresses its design decisions
 * as utility classes (`bg-primary`, `rounded-md`, `p-3`) declares no
 * `var(--token)` anywhere, so a scanner looking for CSS custom-property
 * references finds nothing and the whole declared-binding dimension comes
 * back empty for shadcn / cva / Tailwind codebases.
 *
 * The mapping is derived, not tabulated. Tailwind v4's theme contract is
 * that every utility family reads a *namespaced* custom property:
 *
 *     bg-primary            → --color-primary
 *     text-primary-foreground → --color-primary-foreground
 *     rounded-md            → --radius-md
 *     text-base             → --text-base
 *     font-sans             → --font-sans
 *     gap-2                 → --spacing-2   (only if declared; see below)
 *
 * So: split the class into family + scale key, look up
 * `--<namespace>-<scaleKey>` in the consumer's parsed `@theme`, and if it is
 * there, that is the binding. There is no hardcoded token list and no
 * hardcoded scale — an unknown consumer token resolves as readily as a
 * shadcn one, and a token this project has never heard of works fine.
 *
 * ---------------------------------------------------------------------------
 * "CORRECT OR ABSENT"
 * ---------------------------------------------------------------------------
 * A confidently wrong binding is worse than no binding: it turns into a drift
 * row that reads as authoritative and is not. So every path that cannot name
 * the token *with certainty* returns `null`, and the caller emits nothing for
 * that property. The cases that deliberately produce NO binding:
 *
 *  1. **Arbitrary values** — `bg-[#444]`, `p-[13px]`, `ring-[3px]`,
 *     `bg-(--my-var)`. There is no token; the value is inline.
 *  2. **Utilities whose theme key the consumer does not declare** — e.g.
 *     `font-normal` when the consumer's `@theme` has no
 *     `--font-weight-normal` (it is coming from Tailwind's built-in default
 *     theme, which is not one of the consumer's tokens).
 *  3. **Numeric spacing utilities under the `--spacing` multiplier** —
 *     `p-3` compiles to `calc(var(--spacing) * 3)`. There is no
 *     `--spacing-3` token to name unless the consumer declared one, so `p-3`
 *     yields nothing. (Declare `--spacing-3` and it starts resolving.)
 *  4. **Bare `rounded` and bare `border`** — the scale key Tailwind uses for
 *     the un-suffixed form is version-dependent (`border` is a literal 1px,
 *     not a theme lookup at all), so naming a token would be a guess.
 *  5. **Modified values** — `bg-primary/50` is a derived colour, not the
 *     token. Only `text-<size>/<line-height>` survives, and only its
 *     font-size half.
 *  6. **Unknown / custom utilities** — anything whose family prefix is not in
 *     the table below, including project plugins and `[&_svg]:size-4`.
 *  7. **Ambiguous namespace collisions** — if a scale key resolves in two
 *     candidate namespaces at once (a consumer declaring both
 *     `--font-weight-bold` and `--font-bold`), which one Tailwind picks is
 *     not something we should guess.
 *
 * ---------------------------------------------------------------------------
 * VARIANT MODIFIERS
 * ---------------------------------------------------------------------------
 * `hover:`, `focus-visible:`, `disabled:`, `data-disabled:`, `dark:`, `sm:`,
 * `[&_svg]:` … are parsed and reported in `variants`, but a class carrying
 * ANY variant is **not** part of the default-state binding:
 * `hover:bg-primary-hover` is not the resting background. Callers building a
 * resting-state snapshot must keep only bindings with
 * `variants.length === 0` — `isDefaultState()` is provided for that. The
 * addon snapshots `getComputedStyle` on an un-hovered, un-forced element, so
 * attributing a `hover:` token to the resting paint would be exactly the kind
 * of technically-true-but-inapplicable claim this module exists to avoid.
 *
 * Zero runtime dependencies.
 */

import { extractBareVarToken, normalizeBindingKey } from "./binding-shape.js";
import type { TailwindThemeVars } from "./tailwind-theme.js";

export interface TailwindUtilityBinding {
  /** The class exactly as authored, variants and all (`hover:bg-primary-hover`). */
  className: string;
  /** The class with variant prefixes and any `!` important marker removed. */
  utility: string;
  /** Variant modifiers in source order: `["dark", "hover"]` for `dark:hover:bg-x`. */
  variants: string[];
  /**
   * CSS longhand properties this utility binds, as physical longhands
   * (`border-top-color`, `padding-left`). Run through `normalizeBindingKey`
   * before comparing against the figma-rest engine's binding keys.
   */
  properties: string[];
  /** Theme custom property the utility reads, without `--` (`color-primary`). */
  themeVar: string;
  /** Raw declared value of `themeVar` in the consumer's `@theme`. */
  themeValue: string;
  /**
   * The token name to report. Equal to `themeVar`, except that a theme entry
   * whose value is a bare `var(--x)` is followed exactly one hop — the
   * `@theme inline` aliasing idiom shadcn uses (`--color-primary:
   * var(--primary)`) exists precisely so `--primary` is the real token, and
   * that is the name the consumer's token manifest and Figma handoff use.
   */
  token: string;
}

/** One (theme namespace → CSS properties) possibility for a utility family. */
interface FamilyCandidate {
  namespace: string;
  properties: string[];
}

const PADDING_ALL = [
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
];

const RADIUS_ALL = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
];

/**
 * Utility family → candidate (namespace, properties) pairs, tried in order.
 *
 * Scope note: only families whose CSS property the drift snapshot actually
 * compares are listed. `outline-*`, `ring-*`, `w-*`, `m-*` etc. resolve fine
 * in principle, but the engine has no Figma side for them, so emitting them
 * would only manufacture `flag-only` rows — noise, not signal.
 */
const FAMILIES: Record<string, FamilyCandidate[]> = {
  // ---- colour ------------------------------------------------------------
  bg: [{ namespace: "color", properties: ["background-color"] }],
  border: [{ namespace: "color", properties: ["border-color"] }],
  "border-t": [{ namespace: "color", properties: ["border-top-color"] }],
  "border-r": [{ namespace: "color", properties: ["border-right-color"] }],
  "border-b": [{ namespace: "color", properties: ["border-bottom-color"] }],
  "border-l": [{ namespace: "color", properties: ["border-left-color"] }],
  "border-x": [
    { namespace: "color", properties: ["border-left-color", "border-right-color"] },
  ],
  "border-y": [
    { namespace: "color", properties: ["border-top-color", "border-bottom-color"] },
  ],
  // `text-` is font-size OR colour, depending on which namespace the scale
  // key lives in. Both are checked; a key in both is ambiguous.
  text: [
    { namespace: "text", properties: ["font-size"] },
    { namespace: "color", properties: ["color"] },
  ],
  // `font-` is weight OR family, same story.
  font: [
    { namespace: "font-weight", properties: ["font-weight"] },
    { namespace: "font", properties: ["font-family"] },
  ],

  // ---- spacing -----------------------------------------------------------
  p: [{ namespace: "spacing", properties: PADDING_ALL }],
  px: [{ namespace: "spacing", properties: ["padding-left", "padding-right"] }],
  py: [{ namespace: "spacing", properties: ["padding-top", "padding-bottom"] }],
  pt: [{ namespace: "spacing", properties: ["padding-top"] }],
  pr: [{ namespace: "spacing", properties: ["padding-right"] }],
  pb: [{ namespace: "spacing", properties: ["padding-bottom"] }],
  pl: [{ namespace: "spacing", properties: ["padding-left"] }],
  gap: [{ namespace: "spacing", properties: ["gap"] }],
  "gap-x": [{ namespace: "spacing", properties: ["column-gap"] }],
  "gap-y": [{ namespace: "spacing", properties: ["row-gap"] }],

  // ---- radius ------------------------------------------------------------
  rounded: [{ namespace: "radius", properties: RADIUS_ALL }],
  "rounded-t": [
    {
      namespace: "radius",
      properties: ["border-top-left-radius", "border-top-right-radius"],
    },
  ],
  "rounded-r": [
    {
      namespace: "radius",
      properties: ["border-top-right-radius", "border-bottom-right-radius"],
    },
  ],
  "rounded-b": [
    {
      namespace: "radius",
      properties: ["border-bottom-left-radius", "border-bottom-right-radius"],
    },
  ],
  "rounded-l": [
    {
      namespace: "radius",
      properties: ["border-top-left-radius", "border-bottom-left-radius"],
    },
  ],
  "rounded-tl": [{ namespace: "radius", properties: ["border-top-left-radius"] }],
  "rounded-tr": [{ namespace: "radius", properties: ["border-top-right-radius"] }],
  "rounded-bl": [{ namespace: "radius", properties: ["border-bottom-left-radius"] }],
  "rounded-br": [{ namespace: "radius", properties: ["border-bottom-right-radius"] }],

  // ---- typography / effects ---------------------------------------------
  leading: [{ namespace: "leading", properties: ["line-height"] }],
  tracking: [{ namespace: "tracking", properties: ["letter-spacing"] }],
  shadow: [{ namespace: "shadow", properties: ["box-shadow"] }],
};

/** Longest family prefix first, so `gap-x-2` beats `gap` and `border-t-x` beats `border`. */
const FAMILY_KEYS = Object.keys(FAMILIES).sort((a, b) => b.length - a.length);

/**
 * Split a class into variant modifiers + bare utility, respecting brackets
 * and parens so `data-[state=open]:bg-x` and `[&_svg]:size-4` split at the
 * right colon and `supports-[display:grid]:flex` does not split inside the
 * bracket.
 */
export function splitVariants(className: string): { variants: string[]; utility: string } {
  const variants: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < className.length; i++) {
    const ch = className.charAt(i);
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ":" && depth === 0) {
      variants.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  return { variants, utility: current };
}

/** Whether a binding applies to the resting/default state (no variant modifiers). */
export function isDefaultState(binding: TailwindUtilityBinding): boolean {
  return binding.variants.length === 0;
}

function stripImportant(utility: string): string {
  let out = utility;
  if (out.startsWith("!")) out = out.slice(1);
  if (out.endsWith("!")) out = out.slice(0, -1);
  return out;
}

/** Arbitrary value (`[...]`) or arbitrary custom property (`(...)`) — never a token. */
function hasArbitraryValue(utility: string): boolean {
  return utility.includes("[") || utility.includes("(");
}

/**
 * Classify one Tailwind class against a consumer theme.
 *
 * Returns `null` — meaning "emit nothing for this class" — for every case
 * listed under "CORRECT OR ABSENT" at the top of this file. A non-null result
 * is a binding the theme can vouch for; the caller still has to decide
 * whether the class's `variants` make it applicable to the state being
 * snapshotted (see `isDefaultState`).
 */
export function classifyTailwindUtility(
  className: string,
  themeVars: TailwindThemeVars,
): TailwindUtilityBinding | null {
  const raw = className.trim();
  if (!raw) return null;

  const { variants, utility: withVariants } = splitVariants(raw);
  const utility = stripImportant(withVariants);
  if (!utility) return null;

  // A `/` modifier changes the value the utility produces. The only case where
  // the *primary* half survives intact is `text-<size>/<line-height>`, where
  // font-size is untouched — handled below via `allowSlash`.
  const slash = utility.indexOf("/");
  const base = slash === -1 ? utility : utility.slice(0, slash);
  const modifier = slash === -1 ? null : utility.slice(slash + 1);

  if (hasArbitraryValue(base)) return null;

  for (const family of FAMILY_KEYS) {
    if (!base.startsWith(family + "-")) continue;
    const scaleKey = base.slice(family.length + 1);
    if (!scaleKey) continue;

    const resolved: Array<{ candidate: FamilyCandidate; themeVar: string; themeValue: string }> = [];
    for (const candidate of FAMILIES[family]!) {
      const themeVar = `${candidate.namespace}-${scaleKey}`;
      const themeValue = themeVars[themeVar];
      if (themeValue !== undefined) resolved.push({ candidate, themeVar, themeValue });
    }
    // Nothing in the consumer's theme → not one of their tokens → absent.
    if (resolved.length === 0) return null;
    // Two namespaces claim the same key → which one Tailwind uses is a guess.
    if (resolved.length > 1) return null;

    const hit = resolved[0]!;
    if (modifier !== null) {
      // Only the font-size half of `text-base/[1]` / `text-sm/6` survives.
      // The modifier's own value (line-height) is not emitted: it may be
      // arbitrary (`[1]`) or a `--leading-*` key, and picking one would
      // re-introduce guessing.
      const isFontSize = hit.candidate.properties[0] === "font-size";
      if (!isFontSize) return null;
    }

    return {
      className: raw,
      utility,
      variants,
      properties: hit.candidate.properties,
      themeVar: hit.themeVar,
      themeValue: hit.themeValue,
      token: extractBareVarToken(hit.themeValue) ?? hit.themeVar,
    };
  }

  // Bare family names (`rounded`, `border`, `shadow`) reach here. Tailwind's
  // un-suffixed forms are either literals (`border` = 1px) or map to a
  // version-dependent scale key, so there is no token we can name honestly.
  return null;
}

/**
 * Classify a whole `class="…"` string. Returns one binding per class that
 * resolves; unresolvable classes are silently dropped (that is the point).
 * Order is preserved so a caller can apply later-wins semantics.
 */
export function classifyTailwindClassList(
  classList: string,
  themeVars: TailwindThemeVars,
): TailwindUtilityBinding[] {
  const out: TailwindUtilityBinding[] = [];
  for (const cls of classList.split(/\s+/)) {
    if (!cls) continue;
    const binding = classifyTailwindUtility(cls, themeVars);
    if (binding) out.push(binding);
  }
  return out;
}

/** One resolved property → token binding, with the class that produced it. */
export interface TailwindPropertyBinding {
  /** Token name (what the drift engine compares against Figma variable names). */
  token: string;
  /** The utility class a fix should change (`bg-primary`). */
  className: string;
  /** Theme custom property the class read, without `--`. */
  themeVar: string;
}

export interface TailwindBindingSet {
  /**
   * Property key → binding. Keys are engine keys (already through
   * `normalizeBindingKey`), so `border-top-color` lands as `border-color`,
   * matching what the figma-rest engine reports.
   */
  bindings: Record<string, TailwindPropertyBinding>;
  /**
   * Properties deliberately left unbound because two applicable classes
   * disagreed about the token. Kept so callers can explain the gap instead
   * of silently showing nothing.
   */
  conflicts: string[];
}

interface LayeredBinding extends TailwindPropertyBinding {
  /** Which class list this came from: 0 = base, 1..n = overlays in order. */
  layer: number;
}

interface Accumulator {
  bindings: Record<string, LayeredBinding>;
  conflicts: Set<string>;
}

/**
 * Record a binding, resolving collisions by layer:
 *
 *  - a *later* layer overrides an earlier one (a cva variant slot overrides the
 *    base, which is what `cn()` / `tailwind-merge` does at runtime);
 *  - two classes in the *same* layer — e.g. two independently-selected variant
 *    axes, or two classes in one class list — that name different tokens for
 *    one property are ambiguous. Emitted order in the generated stylesheet is
 *    not inferable from source order, so neither token is reported and the
 *    property is recorded as a conflict.
 *
 * A conflict is sticky: once a property is ambiguous, no later layer un-poisons
 * it, because we cannot know the dropped class did not also win.
 */
function addBinding(set: Accumulator, key: string, next: LayeredBinding): void {
  if (set.conflicts.has(key)) return;
  const prev = set.bindings[key];
  if (!prev) {
    set.bindings[key] = next;
    return;
  }
  if (prev.token === next.token) return;
  if (next.layer > prev.layer) {
    set.bindings[key] = next;
    return;
  }
  delete set.bindings[key];
  set.conflicts.add(key);
}

/**
 * Compose the resting-state bindings for one rendered element.
 *
 * `base` is the always-applied class list. `overlays` are the class lists that
 * are *also* applied for the state being resolved — for a `cva()` component,
 * one entry per selected variant axis, **in the order the axes are declared in
 * the `variants` object**. That order is not cosmetic: cva concatenates
 * `[base, ...variantSlots]` and shadcn's `cn()` runs the result through
 * `tailwind-merge`, so a later axis genuinely does win. Passing overlays out of
 * order would produce a wrong answer.
 *
 * Classes carrying variant modifiers (`hover:`, `data-disabled:`, `dark:`) are
 * excluded outright — see the VARIANT MODIFIERS note at the top of this file.
 */
export function composeTailwindBindings(
  base: string,
  overlays: string[],
  themeVars: TailwindThemeVars,
): TailwindBindingSet {
  const acc: Accumulator = { bindings: {}, conflicts: new Set<string>() };

  const apply = (classList: string, layer: number): void => {
    for (const binding of classifyTailwindClassList(classList, themeVars)) {
      if (!isDefaultState(binding)) continue;
      for (const prop of binding.properties) {
        addBinding(acc, normalizeBindingKey(prop), {
          token: binding.token,
          className: binding.className,
          themeVar: binding.themeVar,
          layer,
        });
      }
    }
  };

  apply(base, 0);
  overlays.forEach((overlay, index) => apply(overlay, index + 1));

  const bindings: Record<string, TailwindPropertyBinding> = {};
  for (const [key, b] of Object.entries(acc.bindings)) {
    bindings[key] = { token: b.token, className: b.className, themeVar: b.themeVar };
  }
  return { bindings, conflicts: [...acc.conflicts].sort() };
}
