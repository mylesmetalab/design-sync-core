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
