/**
 * @metalab/design-sync-core
 *
 * Shared wire contract + tiny string helpers for the three design-sync
 * repos (storybook-sync-addon, design-sync-pipeline, design-sync-figma-plugin).
 * Types + pure functions only — zero runtime dependencies.
 */

export type {
  EditKind,
  EditScope,
  EditTarget,
  ModeAwareValue,
  Edit,
  EditResultStatus,
  EditResult,
} from "./types.js";

export { normalizeTokenName, tokenNameToCssVar } from "./token-names.js";
export { deriveSelectorChain, stripOneLayer, isSingleValue } from "./selectors.js";

// Binding shape — which shorthand expands to which longhands, which key a
// binding is filed under. Moved here from the addon in v0.0.2 so the Tailwind
// mapper below and the addon's three scanners share one definition.
export {
  SHORTHAND_EXPANSIONS,
  INLINE_BINDING_KEY,
  expandDecl,
  normalizeBindingKey,
  compositeBorderTokens,
  extractBareVarToken,
} from "./binding-shape.js";

// Tailwind v4 theme reader + utility → token mapper (v0.0.2).
export type { TailwindThemeVars } from "./tailwind-theme.js";
export {
  parseTailwindTheme,
  mergeTailwindThemes,
  hasTailwindTheme,
} from "./tailwind-theme.js";
export type {
  TailwindUtilityBinding,
  TailwindPropertyBinding,
  TailwindBindingSet,
  TailwindStateContext,
  ModifierApplicability,
} from "./tailwind.js";
export {
  classifyTailwindUtility,
  classifyTailwindClassList,
  composeTailwindBindings,
  modifierApplicability,
  splitVariants,
  isDefaultState,
} from "./tailwind.js";
