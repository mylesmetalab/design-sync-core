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
| `classifyTailwindUtility(class, themeVars)`, `classifyTailwindClassList`, `composeTailwindBindings(base, overlays, themeVars, state?)`, `modifierApplicability`, `splitVariants`, `isDefaultState` | **Tailwind utility → token mapper** (v0.0.2; state-aware modifiers in v0.0.3; `forcedStates` in v0.0.5). |
| `rewriteSelector`, `pseudoStateClass`, `pseudoStatesInSelector`, `splitSelectorList`, `REWRITABLE_PSEUDO_STATES`, `isRewritablePseudoState` | **Pseudo-state forcing, pure half** (v0.0.5). Rewrites a `:hover` rule so a class can trigger it. |

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

### Variant modifiers (the decision)

A modified class never contributes to the **default** state: `isDefaultState()` is
false for it, and `hover:bg-primary-hover` is not the resting background.

But "default state" is not the same question as "what is this story painting",
and the drift snapshot measures the second one. So `composeTailwindBindings`
grades each modifier stack with `modifierApplicability(variants, state)`, where
`state` carries only things the addon actually knows — the story's `disabled` arg
and the active theme mode:

| Verdict | Modifiers | Behaviour |
|---|---|---|
| **inactive** — provably off | `hover:`, `focus:`, `focus-visible:`, `focus-within:`, `active:`, `visited:`, `target:` (and `group-`/`peer-` forms) **when not listed in `state.forcedStates`**; `disabled:`/`data-disabled:`/`aria-disabled:` when the story is not disabled and disabled is not forced; `dark:` in light mode | Contributes nothing, costs nothing. |
| **active** — provably on | a variant whose state the caller **forced** (`state.forcedStates`); `disabled:`/`data-disabled:`/`aria-disabled:` when `disabled` is set; `dark:` in dark mode | Contributes, and **outranks** the unmodified class regardless of layer order, because the generated selector carries an extra attribute and wins on specificity. |
| **indeterminate** — unknowable | `sm:`, `lg:`, `[&_svg]:`, `data-[state=open]:`, other `data-*`/`aria-*` hooks, `dark:` with no mode supplied | The property is left **unbound** and listed in `conflicts`. One of those classes may be what is painted, so answering from the unmodified class would be a guess. |

#### `forcedStates` (v0.0.5)

The inactive row above used to be unconditional, justified by "the addon reads
`getComputedStyle` on a freshly-rendered element and forces no states — forcing is
the Design Inspector's job". That stopped being true when the drift auditor gained
state comparison, and left unconditional it gives a specific, quiet wrong answer:
while a forced `:hover` is being measured, `hover:bg-primary-hover` is reported
`inactive`, so the value the element is *actually painting* is attributed to the
base utility or to no token — and a generated fix prompt names the wrong
declaration.

So a caller that forces states says which:

```ts
modifierApplicability(["hover"], { forcedStates: ["hover"] }); // "active"
modifierApplicability(["hover"], {});                          // "inactive"
```

Absent or empty is a no-op, so existing callers are unaffected. **Only list states
you have really forced** — naming one you have not is worse than omitting it,
because it claims a class applies when it does not.

`group-`/`peer-` forms are deliberately *not* settled by this: `group-hover:` means
the group ancestor is hovered, which forcing hover on this element does not make
true.

An absent `disabled` arg counts as **false**: that is what an absent boolean prop
means in HTML and React, and the component forwards it to the DOM. Treating it as
*unknown* instead would poison the background, border and text bindings of every
story of every component that has a disabled style — the useful majority — to
guard against a case that cannot occur.

Why this matters concretely: a shadcn Button carries
`data-disabled:bg-disabled` in its `cva()` base and `bg-primary` in its
`variant.primary` slot. A `PrimaryDisabled` story paints `bg-disabled`. Reporting
`background-color → primary` for it would be exactly the confidently-wrong signal
this module exists to prevent — so state has to be part of the resolution, not an
afterthought.

### Tailwind v3

v3 keeps its scale in `tailwind.config.js`, which this package does not evaluate.
A v3 consumer gets no bindings — absent, not wrong.

## Consuming

No npm publish. Pin via git tag, matching how the addon is consumed today:

```json
{
  "dependencies": {
    "@metalab/design-sync-core": "github:mylesmetalab/design-sync-core#v0.0.5"
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

v0.0.3 adds state-aware modifier resolution (`composeTailwindBindings`' optional
fourth argument, `modifierApplicability`). It **changes the behaviour** of
`composeTailwindBindings` for class lists containing indeterminate modifiers — the
affected property is now left unbound instead of answered from the unmodified
class — but that function shipped in v0.0.2 and has one consumer (the addon), so
no coordinated bump is needed. Pipeline and plugin remain on `#v0.0.1`.
