/**
 * CSS selector / value helpers shared by the addon's scanner and the
 * pipeline's CSS write engine.
 *
 * P1.3 reconciliation note: the addon previously carried a shallow
 * `selectorFallbackChain` that walked ONE level; the pipeline's
 * `deriveSelectorChain` walks up to FOUR. Per the P1.3 decision, the
 * pipeline's deeper, cascade-accurate version is canonical and the addon
 * now consumes it. Behavioral effect on the addon: bindings can resolve on
 * deeper ancestor selectors than before (generally catching more real
 * drift, never less). Verify golden-path drift output when adopting.
 */

/**
 * Fallback chain from most-specific to least, for resolving a token binding
 * declared on an ancestor selector:
 *
 *  - `.icon-button--accent`  → `.icon-button`         (strip BEM modifier)
 *  - `.tab.active`           → `.tab`                 (strip trailing class)
 *  - `.foo`                  → no further fallback
 *
 * Bounded loop guards against pathological inputs (we cap at 4 levels —
 * deeper than any real BEM chain).
 */
export function deriveSelectorChain(selector: string): string[] {
  const chain: string[] = [selector];
  let current = selector;
  for (let i = 0; i < 4; i++) {
    const next = stripOneLayer(current);
    if (!next || next === current) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

/**
 * Strip a single BEM modifier or trailing chained class from a selector.
 * Returns null when nothing more can be stripped.
 */
export function stripOneLayer(selector: string): string | null {
  // Trailing chained class: `.foo.bar` → `.foo` (only when the head also
  // contains a `.`, so we don't try to strip the only class on the selector).
  const chained = selector.match(/^(.+)(\.[A-Za-z_][\w-]*)$/);
  const chainedHead = chained?.[1];
  const chainedTail = chained?.[2];
  if (chainedHead && chainedTail && chainedHead.includes(".") && !chainedTail.includes("--")) {
    return chainedHead;
  }
  // BEM modifier: `.foo--x` → `.foo`.
  const bem = selector.match(/^(.*?)(--[\w-]+)$/);
  const bemHead = bem?.[1];
  if (bemHead) return bemHead;
  return null;
}

/**
 * "Single value" = walk the string, track parenthesis depth, return false if
 * we see top-level whitespace. Covers all the cases we care about (var(...),
 * hex/rgb, bare ident, number+unit) without enumerating CSS value grammars.
 * Used by write engines to refuse multi-slot shorthands like
 * `border: 1px solid red`.
 */
export function isSingleValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  let depth = 0;
  for (let k = 0; k < trimmed.length; k++) {
    const ch = trimmed.charAt(k);
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(ch)) return false;
  }
  return true;
}
