# @metalab/design-sync-core

Shared foundation for the design-sync system. **Types + pure string helpers only — zero runtime dependencies.**

Consumed by the three sibling repos so they stop forking conventions on every change:

- `storybook-sync-addon` — drift detector / front door
- `design-sync-pipeline` — edit router
- `design-sync-figma-plugin` — Figma write surface

## What's here

| Export | Purpose |
|---|---|
| `Edit`, `EditResult`, `EditTarget`, `EditKind`, `EditScope`, `EditResultStatus`, `ModeAwareValue` | The wire contract that travels over HTTP between all three repos. **The single source of truth** — changing a shape here ripples to every front door. |
| `normalizeTokenName(name)` | Collapse token-name spellings (`--radius-xl` ≡ `radius/xl` ≡ `Radius/XL`) to one comparable form. |
| `tokenNameToCssVar(token)` | Figma name → CSS custom property (`radius/xl` → `--radius-xl`). |
| `deriveSelectorChain(selector)` / `stripOneLayer(selector)` | BEM/chained-class cascade fallback (up to 4 levels). |
| `isSingleValue(value)` | Reject multi-slot CSS shorthands (`1px solid red`). |

## Consuming

No npm publish. Pin via git tag, matching how the addon is consumed today:

```json
{
  "dependencies": {
    "@metalab/design-sync-core": "github:mylesmetalab/design-sync-core#v0.0.1"
  }
}
```

`npm install` runs the `prepare` script (`tsc`) after cloning, so consumers get built `dist/` output automatically.

## Build

```sh
npm install
npm run build     # tsc → dist/
npm test          # vitest
```

## Contract stability

The `Edit` shape is on the HTTP wire between the addon, pipeline, and plugin. **Additive changes only** without a coordinated bump across all three consumers. This package was extracted in P1.3 by unifying the three repos' pre-existing copies to their common superset — no wire-shape change.
