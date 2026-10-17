# Contract: Design tokens and contrast

Implements FR-006 to FR-012, SC-003, SC-007, SC-010. Single definition: `frontend/src/index.css` (Tailwind v4 `@theme`, no `tailwind.config.js`). Every value below is a proposal taken from the approved mock; the contrast test (`frontend/tests/unit/contrast.test.ts`) is the authority and the values may be tuned only to satisfy it (FR-007).

## Tokens

All values are literal hex in `index.css` so a test can read them. Light / dark.

| Group | Token | Light | Dark |
|---|---|---|---|
| Surface | `background` | `#F8F8F8` | `#0C110E` |
| | `surface`, `surface-elevated`, `chrome` | `#FFFFFF` | `#141B17` / `#1A231E` / `#0F1511` |
| | `surface-subtle` | `#F4F7F5` | `#1A231E` |
| | `surface-strong` | `#E9EFEB` | `#232D27` |
| | `surface-hover` | `#F0F4F1` | `#1D2721` |
| Edges | `border` (decorative) | `#E8EDE9` | `#25302A` |
| | `border-strong` (decorative) | `#CFD8D2` | `#34423A` |
| | `border-control` (inputs, selects, checkboxes, secondary buttons) | `#7C8680` | `#6F7D74` |
| Text | `text-primary` | `#101412` | `#F2F6EF` |
| | `text-secondary` | `#4A544E` | `#C4CFC7` |
| | `muted` | `#66706A` | `#9AAA9F` |
| Accent | `accent` | `#E7F68F` | `#E7F68F` |
| | `on-accent` | `#2A3010` | `#2A3010` |
| Tints | `lime-pale`, `mint`, `sage`, `olive` | `#F3FCC7`, `#D5F6E5`, `#BDD9CA`, `#CCD97F` | `#2A3114`, `#1C2C25`, `#3D5A4B`, `#7D8A3A` |
| Brand ramp (text, lines, focus) | `brand-50` / `100` / `200` / `300` / `400` | `#F3FCC7` / `#E7F68F` / `#CCD97F` / `#B3C45A` / `#8FA63A` | `#2A3114` / `#3A4519` / `#7D8A3A` / `#CCD97F` / `#E7F68F` |
| | `brand-500` (focus, lines) | `#6F8A1F` | `#E7F68F` |
| | `brand-600` / `700` (text) / `800` / `900` | `#66801C` / `#5B7314` / `#4A5E10` / `#3A4A0C` | `#D4E76A` / `#E7F68F` / `#F3FCC7` / `#FFFFFF` |
| Status | `success` text / tint | `#166534` / `#DDF3E4` | `#86EFAC` / `#16301F` |
| | `warning` text / tint | `#92400E` / `#FDEBC0` | `#FCD34D` / `#3A2D0E` |
| | `danger` text / tint | `#8F1D1D` / `#FDC5C7` | `#FCA5A5` / `#3D1A1C` |
| | `info` text / tint (palette neutral) | `#36574A` / `#D5F6E5` | `#C4CFC7` / `#1C2C25` |
| Methods | `method-get/post/put/patch/delete/head/options` | unchanged | unchanged |
| Charts | `chart-1` to `chart-6` | `#5B7314 #2E7D5B #7C8A1D #66706A #9A6B1E #4F6B5E` | `#E7F68F #86EFAC #CCD97F #9AAA9F #FBBF24 #BDD9CA` |

**Removed**: `--solid-*` (eight), `--color-section-*`, `--section-solid`, `--section-accent`, the `[data-section]` blocks, `--color-wf-*` (four), and the `:root,[data-section]` brand derivation with its `@theme inline` indirection. `--color-brand-*` keep their names; `bg-brand-600|700` fills carrying text are replaced by `bg-accent text-on-accent`.

## Required pairings (the contrast test)

Minimum ratio, in both themes. "Text" 4.5:1; "non-text" 3:1.

| Foreground | Background | Min | Where |
|---|---|---|---|
| `text-primary`, `text-secondary` | `background`, `surface`, `surface-subtle`, `surface-strong`, `lime-pale`, `mint`, `accent` | 4.5 | all body text |
| `muted` | `background`, `surface`, `surface-subtle` | 4.5 | secondary text; **not** permitted on `mint` or `lime-pale` (use `text-secondary`) |
| `on-accent` | `accent` | 4.5 | primary actions, current item |
| `brand-700` | `surface`, `background`, `lime-pale`, `mint`, `accent` | 4.5 | links, olive text |
| status text | its own tint | 4.5 | chips, banners |
| `info` text | `info` tint | 4.5 | informational chips |
| `border-control` | `surface`, `background`, `surface-subtle`, `lime-pale`, `mint` | 3 | input, select, textarea, checkbox, secondary-button outlines |
| `brand-500` | `surface`, `background`, `lime-pale`, `mint` | 3 | focus marks, selected-state edge |
| `chart-1` to `chart-6` | `surface` | 3 | series with a label or marker |
| method label text | its method fill | 4.5 | method badges (already met; guard retained) |

`border` and `border-strong` are decorative and exempt. Disabled controls are exempt. The lime fill itself is not a 3:1 graphic against white (about 1.15:1), so every selected or current state also carries a 2 px `brand-500` edge and text, as well as the fill.

## Guards (frontend/tests/unit/colourTokens.test.ts, extracted from sectionCatalog.test.ts)

1. No hex colour in any `.ts`/`.tsx` under `frontend/src` except `components/WorkflowIcon.tsx` (third-party logo colours).
2. No Tailwind palette utility (`bg-slate-500`, `text-blue-600` and the rest of the existing pattern).
3. No `text-white` on `bg-brand-*`, `bg-accent` or a pale tint in the same class list.
4. No `data-section`, `section-*` or `wf-*` token reference remains.
5. Both themes define every token of the table.
6. No `text-align: justify` rule in `index.css` and no `text-justify` utility in components (FR-012, SC-010).

## Text alignment

`p:not(.font-mono){ text-align: justify; hyphens: auto }` is removed. Monospace text keeps `font-variant-ligatures: none`.
