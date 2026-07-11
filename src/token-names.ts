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
 * Strips a leading `--`, converts `/` and `.` to `-`, collapses runs of `-`,
 * and lowercases. Accepts null/undefined (returns "") so callers don't have
 * to guard.
 */
export function normalizeTokenName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/^--/, "")
    .replace(/[\/.]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/**
 * Conventional Figma-token-name → CSS custom property mapping.
 * `radius/xl` → `--radius-xl`. Lowercased; `/` becomes `-`.
 */
export function tokenNameToCssVar(token: string): string {
  return "--" + token.replace(/\//g, "-").toLowerCase();
}
