/**
 * Token-name canonicalization helpers, shared across the addon (drift
 * comparison), the pipeline (CSS write engines), and the plugin (Figma
 * variable lookup). Previously duplicated in all three — identical in the
 * addon and plugin, and the `tokenNameToCssVar` direction was even
 * duplicated twice inside the pipeline itself.
 *
 * Zero runtime dependencies by design (see the package README).
 */

/**
 * Collapse the many spellings of a token name to one canonical, comparable
 * form so convention differences never register as drift:
 *
 *   `--radius-xl`, `radius/xl`, `radius.xl`, `Radius/XL`  →  `radius-xl`
 *
 * Strips a leading `--`, converts `/`, `.`, and whitespace (spaces, tabs,
 * newlines — including runs of them) to `-`, collapses runs of `-`, trims
 * leading/trailing `-`, and lowercases. Accepts null/undefined (returns "")
 * so callers don't have to guard.
 *
 * Whitespace joins the SAME separator class as `-`/`/`/`.` rather than being
 * collapsed away entirely (issue #1). Real Figma variable names contain
 * spaces — e.g. `Body/Font Weight Regular` — and the code-side spelling is
 * typically dash-separated (`font-weight-regular`), so treating a space as
 * equivalent to `-` is what makes those match:
 *
 *   `Font Weight Regular` → `font-weight-regular`
 *
 * Collapsing whitespace to nothing instead would make `foo bar` equal
 * `foobar`, which is too aggressive: it would silently match names that
 * merely share letters with no word boundary at all.
 *
 * This intentionally does NOT split camelCase — `fontWeightRegular` was
 * already, before this fix, lowercased into a single smashed-together word
 * (`fontweightregular`) with no separator inserted at the case boundary, and
 * that behavior is unchanged here. Only explicit separator *characters* in
 * the input (`-`, `/`, `.`, whitespace) are canonicalized; an implicit
 * camelCase word boundary is not one, so `fontWeightRegular` still does not
 * match `font-weight-regular`. Keeping camelCase-splitting out of scope
 * avoids inventing a new heuristic in a bug-fix change — it stays a known,
 * pre-existing limitation, not a regression.
 */
export function normalizeTokenName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/^--/, "")
    .replace(/[\/.\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Conventional Figma-token-name → CSS custom property mapping.
 * `radius/xl` → `--radius-xl`. Lowercased; `/` becomes `-`.
 */
export function tokenNameToCssVar(token: string): string {
  return "--" + token.replace(/\//g, "-").toLowerCase();
}
