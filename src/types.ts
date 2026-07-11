/**
 * The shared wire contract for the design-sync system.
 *
 * Front-door tools (the Storybook addon, the Figma plugin) construct `Edit`
 * objects and POST them to the pipeline; the pipeline classifies and routes
 * to a registered engine, which returns an `EditResult`. These shapes travel
 * over HTTP between all three repos — changing them ripples everywhere, so
 * they live here as the single source of truth.
 *
 * Extracted in P1.3 from `design-sync-pipeline/src/types.ts` (the prior
 * canonical copy). The plugin previously carried an untyped, incomplete
 * inline copy; it now imports these. Additive-only reconciliation — no field
 * was removed or renamed, so the wire shape is unchanged.
 */

export type EditKind = "token-binding" | "token-value" | "copy" | "props";
export type EditScope = "code" | "figma";

export interface EditTarget {
  /** Storybook story id, when the edit originates from a story drift row. */
  storyId?: string;
  /** CSS selector identifying the rule to edit (code scope). */
  selector?: string;
  /** Property being edited (CSS prop or Figma binding key). */
  property: string;
  /** Figma node id (figma scope). */
  nodeId?: string;
  /** Figma file key (figma scope). */
  fileKey?: string;
  /** Optional path hint — file that should be edited, when known. */
  path?: string;
}

export interface ModeAwareValue {
  light?: string;
  dark?: string;
}

export interface Edit {
  /** Stable identifier for idempotency / tracking. UUIDv4 recommended. */
  id: string;
  kind: EditKind;
  scope: EditScope;
  target: EditTarget;
  /**
   * The value the edit assumes is currently in place. Engines refuse to
   * apply if the value on disk doesn't match — protects against the
   * source-of-truth having drifted between detection and apply.
   */
  oldValue: string;
  /** The desired new value. */
  newValue: string;
  /** Mode-aware values when the edit is theme-specific. */
  modes?: ModeAwareValue;
  /** Free-form source identifier ("storybook-design-sync", "design-inspector", ...). */
  source: string;
  /** ISO-8601 timestamp from the producer. */
  timestamp: string;
  /**
   * If true, the engine reports what *would* happen (returns a diff) without
   * writing. Required-on for first-contact integration tests.
   */
  dryRun?: boolean;
  /**
   * Inverse of dryRun for engines that default to dry-run (figma-rest-write,
   * figma-plugin). Real writes only happen when `confirm: true`. Producers
   * opt in explicitly per-edit; not a global flag.
   */
  confirm?: boolean;
}

export type EditResultStatus =
  | "applied"
  | "rejected"
  | "needs_review"
  | "error"
  | "no_op";

export interface EditResult {
  /**
   * The id of the `Edit` this result responds to. Required so callers can
   * correlate results when multiple edits are in flight. (The plugin's prior
   * inline copy omitted this — P1.3 reconciled it.)
   */
  id: string;
  status: EditResultStatus;
  /** Engine name that handled (or refused) the edit. */
  engine?: string;
  /** Short human-readable reason. */
  message?: string;
  /** Unified-diff text of what changed (or would change in dry-run). */
  diff?: string;
}
