# @metalab/design-sync-core

The shared wire contract and token-name helpers for the design-sync suite; consumed by the Storybook addon (and the parked pipeline/plugin).

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
| `SHORTHAND_EXPANSIONS`, `expandDecl`, `INLINE_BINDING_KEY`, `normalizeBindingKey`, `compositeBorderTokens`, `extractBareVarToken` | **Binding shape** — which CSS shorthand expands to which longhands, and which key a binding is filed under. Moved here from the addon in v0.0.2 so every scanner (CSS, TSX, DOM, Tailwind) agrees; scanner disagreement was a live bug class. |
| `parseTailwindTheme(css)`, `mergeTailwindThemes(...)`, `hasTailwindTheme(vars)` | **Tailwind v4 theme reader** — pull `@theme` custom properties out of consumer CSS. |
| `classifyTailwindUtility(class, themeVars)`, `classifyTailwindClassList`, `composeTailwindBindings(base, overlays, themeVars)`, `splitVariants`, `isDefaultState` | **Tailwind utility → token mapper** (v0.0.2). |

## Tailwind utility → token mapping (v0.0.2)

A component that styles itself with utility classes (`bg-primary`, `rounded-md`,
`p-3`) declares no `var(--token)` anywhere, so a scanner hunting for custom-property
references finds nothing — the declared-binding dimension comes back empty for every
shadcn / cva / Tailwind consumer.

The mapping is **derived, not tabulated**. Tailwind v4's theme contract is that a
utility family reads a namespaced custom property, so the lookup is
`family + scaleKey → --<namespace>-<scaleKey>` against the consumer's own parsed
`@theme`. There is no hardcoded token list and no hardcoded scale; a token this
package has never heard of resolves as readily as a shadcn one. `@theme inline`
aliasing is followed exactly one hop, so `bg-primary` → `--color-primary:
var(--primary)` reports the token as `primary` — the name the consumer's token
manifest and Figma handoff actually use.

### Correct or absent

A confidently wrong binding is worse than none: it becomes a drift row that reads
as authoritative and is false. Every uncertain path returns `null`. Deliberately
**no binding**:

| Case | Example | Why |
|---|---|---|
| Arbitrary values | `bg-[#444]`, `p-[13px]`, `bg-(--v)` | There is no token; the value is inline. |
| Theme key the consumer doesn't declare | `font-normal`, `bg-transparent`, `text-white` | It resolves against Tailwind's built-in default theme, which is not one of the consumer's tokens. |
| Numeric spacing under the `--spacing` multiplier | `p-3`, `gap-2` | Compiles to `calc(var(--spacing) * 3)`. Declare `--spacing-3` and it starts resolving. |
| Bare `rounded` / `border` / `shadow` | `border` | `border` is a literal `1px`, not a theme lookup; the un-suffixed scale key is version-dependent. |
| Modified values | `bg-primary/50` | A derived colour, not the token. Only `text-<size>/<lh>` survives, and only its font-size half. |
| Unknown / custom utilities | `my-utility`, `[&_svg]:size-4` | Not a known family. |
| Namespace collisions | `font-bold` when both `--font-weight-bold` and `--font-bold` exist | Which one Tailwind picks is not ours to guess. |

Families covered are exactly those whose CSS property the drift snapshot compares:
`bg`, `text` (colour **and** font-size), `border` + `border-{t,r,b,l,x,y}`,
`p`/`px`/`py`/`pt`/`pr`/`pb`/`pl`, `gap`/`gap-x`/`gap-y`, `rounded` +
`rounded-{t,r,b,l,tl,tr,bl,br}`, `font` (weight **and** family), `leading`,
`tracking`, `shadow`. Resolvable-but-uncompared families (`w-*`, `m-*`, `ring-*`,
`outline-*`) are left out on purpose: emitting them would only manufacture
`flag-only` rows.

### Variant modifiers do not contribute to the default state

`hover:bg-primary-hover` is **not** the resting background. Modified classes are
parsed and reported in `binding.variants`, but `isDefaultState()` is false for them
and `composeTailwindBindings` excludes them. The drift snapshot reads
`getComputedStyle` on an un-hovered, un-forced element, so attributing a `hover:`
token to the resting paint would be exactly the technically-true-but-inapplicable
claim this module exists to prevent.

### Tailwind v3

v3 keeps its scale in `tailwind.config.js`, which this package does not evaluate.
A v3 consumer gets no bindings — absent, not wrong.

## Consuming

No npm publish. Pin via git tag, matching how the addon is consumed today:

```json
{
  "dependencies": {
    "@metalab/design-sync-core": "github:mylesmetalab/design-sync-core#v0.0.2"
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

v0.0.2 is likewise additive: it adds the binding-shape tables and the Tailwind
mapper and changes no existing export. `design-sync-pipeline` and
`design-sync-figma-plugin` stay pinned to `#v0.0.1` — nothing they consume moved.
