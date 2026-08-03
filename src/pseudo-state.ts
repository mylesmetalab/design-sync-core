/**
 * Pseudo-state forcing — the pure half.
 *
 * ## What this is for
 *
 * A rendered element cannot be put into `:hover` from page JavaScript. Measured
 * 2026-08-03 in headless Chromium: dispatching `pointerover` / `mouseover` /
 * `mouseenter` / `mousemove` moves nothing, and `el.matches(":hover")` stays
 * false. Only the browser's own input pipeline or CDP's `CSS.forcePseudoState`
 * flips the real pseudo-class.
 *
 * What *does* work everywhere is rewriting the stylesheet: for every rule whose
 * selector names a pseudo-state, append parallel selectors that use a class
 * instead, then toggle that class.
 *
 *     .button:hover { … }
 *  → .button:hover, .button.pseudo-hover, .pseudo-hover .button { … }
 *
 * The declarations are the rule's own, so the forced rendering is the real one.
 * Measured on the reference Button (`hover:bg-primary-hover`): the class form, a
 * real pointer, and CDP `CSS.forcePseudoState` all produce
 * `rgb(30, 30, 30)` against a `rgb(44, 44, 44)` rest state — identical.
 *
 * Because it is pure DOM/CSS it behaves the same in a panel and in headless
 * Chromium, which is why both surfaces use it rather than the panel
 * approximating while the headless path uses CDP. Two mechanisms that can
 * silently disagree is the failure class this project keeps closing.
 *
 * ## Adapted from storybook-addon-pseudo-states
 *
 * `rewriteSelector` follows the approach of
 * `storybook-addon-pseudo-states`'s `src/preview/rewriteStyleSheet.ts` (MIT,
 * https://github.com/storybookjs/storybook-addon-pseudo-states), and
 * deliberately uses the **same `pseudo-<state>` class names** so the two are
 * idempotent against each other and either toolbar flips the same rules.
 *
 * NOTE FOR MAINTAINERS: this package declares MIT in `package.json` but ships
 * no LICENSE file, and the upstream copyright notice is not vendored here. That
 * should be fixed before relying on this package's licensing — it needs the
 * upstream notice text, which is not reproduced from memory.
 *
 * ## Why this half lives in core
 *
 * This package is types and pure functions with no DOM (`lib: ["ES2022"]`), and
 * that boundary is the useful one: the selector logic below is where the bugs
 * live — regex state, selector-list splitting, `:not()` producing invalid CSS —
 * while walking `document.styleSheets` and toggling a class is thin, obvious,
 * environment-specific plumbing that each consumer keeps.
 */

/**
 * Pseudo-states the rewriter can express as a class.
 *
 * Ordered so `focus-visible` is tried before `focus`: a prefix match on the
 * shorter name first would rewrite `:focus-visible` into `.pseudo-focus-visible`
 * via the wrong branch.
 *
 * This is the *rewriting* vocabulary — every pseudo-class that can be expressed
 * as a class. It is deliberately wider than the set a consumer should let
 * someone *bind* a design node to: `:visited` rewrites fine but its computed
 * styles are unreadable by design, so comparing it could only ever report a
 * false match. Consumers narrow this; core does not decide policy.
 */
export const REWRITABLE_PSEUDO_STATES = [
  "focus-visible",
  "focus-within",
  "hover",
  "active",
  "focus",
  "visited",
  "link",
  "target",
  "disabled",
] as const;

export type RewritablePseudoState = (typeof REWRITABLE_PSEUDO_STATES)[number];

/** The class that forces `state` — `hover` → `pseudo-hover`. */
export function pseudoStateClass(state: string): string {
  return `pseudo-${state}`;
}

export function isRewritablePseudoState(value: string): value is RewritablePseudoState {
  return (REWRITABLE_PSEUDO_STATES as readonly string[]).includes(value);
}

/**
 * Matches `:state` when it is a real pseudo-class occurrence:
 *
 *   - not preceded by `:`, so `::-webkit-something` is left alone
 *   - not followed by `(`, so functional pseudos like `:not(...)` aren't split
 *
 * Built fresh per call by `matcherFor` rather than shared: a global regex
 * carries `lastIndex`, and sharing one between `test`, `exec` and `replace` is
 * exactly how the upstream-derived version once froze the page (see
 * `rewriteSelector`).
 */
function matcherFor(): RegExp {
  return new RegExp(`(?<!:):(${REWRITABLE_PSEUDO_STATES.join("|")})(?!\\()`, "g");
}

/** Adding a class to these makes no sense. */
const EXCLUDED_PSEUDO_ELEMENT_RE = /::(-webkit-|-moz-|-ms-|part\(|slotted\()/;

/**
 * Split a selector list on top-level commas only, so `:is(.a, .b)` and
 * `[data-x="a, b"]` survive intact.
 */
export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]!;
    if (quote !== null) {
      // A backslash escapes the next character, including a closing quote.
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts;
}

/**
 * Append class-based parallel selectors for every pseudo-state in `selector`.
 *
 * Returns the selector unchanged when there is nothing to rewrite, so callers
 * can compare by identity to decide whether to write back.
 *
 * Two forms are emitted per state, matching upstream's semantics closely enough
 * for the cases that matter:
 *
 *   - `<selector with :state → .pseudo-state>` — the class on the element itself
 *   - `.pseudo-state <selector with :state removed>` — the class on an ancestor,
 *     so forcing a state on a root also forces descendants that key off it
 *
 * The ancestor form is skipped when removing the pseudo would leave `:not()`,
 * which is invalid CSS and would make a browser reject the **entire** selector
 * list — taking the original, working rule down with it. The element form
 * already covers forcing in that case.
 */
export function rewriteSelector(selector: string): string {
  const probe = matcherFor();
  if (!probe.test(selector)) return selector;

  const out: string[] = [];

  for (const part of splitSelectorList(selector)) {
    out.push(part);
    if (EXCLUDED_PSEUDO_ELEMENT_RE.test(part)) continue;

    // Collect the states present up front. Deliberately NOT `while (exec())`
    // interleaved with `replace`: a global regex's `lastIndex` is reset by
    // `String#replace`, so the loop matched position 0 forever and hung the
    // page. Separate regex objects for scanning and replacing.
    const states: string[] = [];
    const scanner = matcherFor();
    let m: RegExpExecArray | null;
    while ((m = scanner.exec(part)) !== null) states.push(m[1]!);

    const seen = new Set<string>([part]);
    for (const state of states) {
      const cls = `.${pseudoStateClass(state)}`;

      // Replace every occurrence of every state, mirroring upstream: a rule
      // written `.a:hover:focus` is forced by one class pair, not two.
      const elementForm = part.replace(matcherFor(), (_full, s: string) =>
        `.${pseudoStateClass(s)}`,
      );
      if (!seen.has(elementForm)) {
        seen.add(elementForm);
        out.push(elementForm);
      }

      // Strip only *this* state; other pseudos keep needing their own trigger.
      const stripped = part.replace(matcherFor(), (_full, s: string) =>
        s === state ? "" : `:${s}`,
      );
      const ancestorForm = `${cls} ${stripped}`.trim();
      if (
        ancestorForm.length > cls.length &&
        !/:not\(\s*\)/.test(ancestorForm) &&
        !seen.has(ancestorForm)
      ) {
        seen.add(ancestorForm);
        out.push(ancestorForm);
      }
    }
  }

  return out.join(", ");
}

/**
 * Which of `states` a selector already responds to, by pseudo-class or by the
 * rewritten class form. Lets a consumer tell "this rule is about hover" without
 * re-deriving the regex.
 */
export function pseudoStatesInSelector(selector: string): RewritablePseudoState[] {
  const found = new Set<RewritablePseudoState>();
  const scanner = matcherFor();
  let m: RegExpExecArray | null;
  while ((m = scanner.exec(selector)) !== null) {
    found.add(m[1] as RewritablePseudoState);
  }
  for (const state of REWRITABLE_PSEUDO_STATES) {
    if (selector.includes(`.${pseudoStateClass(state)}`)) found.add(state);
  }
  // Vocabulary order, so callers get a stable list.
  return REWRITABLE_PSEUDO_STATES.filter((s) => found.has(s));
}
