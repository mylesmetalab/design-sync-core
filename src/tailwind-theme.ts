/**
 * Tailwind v4 theme reader.
 *
 * Tailwind v4 is CSS-first: the design scale lives in one or more `@theme`
 * blocks as custom properties, and every utility name is derived from a
 * *namespaced* custom property (`bg-primary` ← `--color-primary`,
 * `rounded-md` ← `--radius-md`, `text-base` ← `--text-base`). That naming
 * contract is what lets `tailwind.ts` go from a class name back to a token
 * without evaluating the consumer's build.
 *
 * We deliberately read ONLY what the consumer's own CSS declares. Tailwind's
 * built-in default theme (`@import "tailwindcss"`) is not inlined here, so a
 * utility that resolves against a Tailwind default rather than a
 * consumer-declared token produces NO binding. That is the intended
 * behaviour: the addon's job is to report which *design token* a property is
 * wired to, and a framework default is not one of the consumer's tokens.
 * "Correct or absent" — see `tailwind.ts`.
 *
 * Zero runtime dependencies, so this is a small hand-rolled scanner rather
 * than a PostCSS pass. It only has to find `@theme` blocks and the
 * `--name: value;` declarations inside them, which is a brace/semicolon
 * walk — no selector or value grammar required.
 */

/**
 * Custom properties declared inside `@theme` blocks, keyed WITHOUT the
 * leading `--` (so `--color-primary` is stored as `color-primary`). Values
 * are the raw declaration text, trimmed.
 */
export type TailwindThemeVars = Record<string, string>;

/** Strip `/* … *\/` comments so a commented-out declaration never registers. */
function stripComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    out += css.charAt(i);
    i++;
  }
  return out;
}

/**
 * Find the `{ … }` body that starts at or after `from`, returning the body
 * text and the index just past its closing brace. Returns null if there is
 * no balanced body (truncated/invalid CSS).
 */
function readBlock(css: string, from: number): { body: string; end: number } | null {
  const open = css.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css.charAt(i);
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { body: css.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/**
 * Pull `--name: value;` declarations out of a block body. Only top-level
 * declarations count — a nested rule's declarations belong to that rule's
 * selector, not to the theme namespace. Values may contain `;`-free nested
 * parens (`var(--x, 1px)`), which the depth walk handles.
 */
function collectCustomProps(body: string, into: TailwindThemeVars): void {
  let i = 0;
  let depth = 0;
  let decl = "";
  while (i < body.length) {
    const ch = body.charAt(i);
    if (ch === "{") {
      depth++;
      decl = "";
      i++;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      decl = "";
      i++;
      continue;
    }
    if (ch === ";" && depth === 0) {
      recordDecl(decl, into);
      decl = "";
      i++;
      continue;
    }
    if (depth === 0) decl += ch;
    i++;
  }
  // Trailing declaration with no closing `;`.
  recordDecl(decl, into);
}

function recordDecl(decl: string, into: TailwindThemeVars): void {
  const trimmed = decl.trim();
  if (!trimmed.startsWith("--")) return;
  const colon = trimmed.indexOf(":");
  if (colon === -1) return;
  const name = trimmed.slice(2, colon).trim();
  const value = trimmed.slice(colon + 1).trim();
  if (!name || !value) return;
  into[name] = value;
}

/**
 * `@theme`, `@theme inline`, `@theme static`, `@theme inline reference`, … —
 * any at-rule whose name is exactly `theme`, with optional space-separated
 * modifiers before the block. Modifiers change how Tailwind *emits* the
 * variables, not what the utility names are, so we treat them all alike.
 */
const THEME_AT_RULE = /@theme\b/g;

/**
 * Parse all `@theme` blocks in one stylesheet. Blocks merge in source order
 * (a later declaration of the same name wins, matching CSS).
 */
export function parseTailwindTheme(css: string): TailwindThemeVars {
  const clean = stripComments(css);
  const vars: TailwindThemeVars = {};
  THEME_AT_RULE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = THEME_AT_RULE.exec(clean)) !== null) {
    const block = readBlock(clean, match.index);
    if (!block) break;
    collectCustomProps(block.body, vars);
    THEME_AT_RULE.lastIndex = block.end;
  }
  return vars;
}

/**
 * Merge theme maps from several stylesheets, later sources winning. Used by
 * the addon, which scans a glob of `cssEntries` and needs one lookup table.
 */
export function mergeTailwindThemes(...themes: TailwindThemeVars[]): TailwindThemeVars {
  const out: TailwindThemeVars = {};
  for (const theme of themes) Object.assign(out, theme);
  return out;
}

/** True when the stylesheet declares at least one `@theme` custom property. */
export function hasTailwindTheme(vars: TailwindThemeVars): boolean {
  return Object.keys(vars).length > 0;
}
