# Validation: Workspace Redesign (AP-038)

**Date**: 2026-10-04 · **Version**: 19.20.0

## Automated

| Check | Result |
|---|---|
| `npm test` (workspace) | 312 files passed, 3 skipped; 2,471 tests passed, 10 skipped (opt-in suites) |
| `npm test -w frontend` | 78 files, 501 tests passed (includes the new `EntryChooser`, `CommandPalette`, `HelpDialog`, `paletteCommands`, `workflowCatalog` tests and the extended `App`, `AppHeader`, `Dialog`, `Tabs` tests) |
| `npm run lint` | clean |
| `npm run build` | exit 0, no warnings |

Intentional test change (SC-006): `UserScriptPage.test.tsx` "is offered on the start screen" now
queries `{ name: "Run k6 Script" }` exactly (plan.md). `AppHeader.test.tsx` passes the new props;
its four original assertions are unchanged.

## Scripted browser walkthrough

These checks ran with Playwright 1.63 (Chromium) against the Vite dev server and the backend in
`AI_PROVIDER_MODE=mock`. Screenshots were reviewed by eye.

| Scenario | Check | Result |
|---|---|---|
| 2 (SC-001, amended) | First pass: lowest card bottom 644 px of 657, but the user found the page crammed. Design A spacing restored: section heading top at 606 px of 657, cards start at 658 px | **pass** (amended criterion) |
| 6 (FR-001) | Computed headline font | `"IBM Plex Sans", …` in both themes: **pass** |
| 6 (FR-003) | Body background | `rgb(246, 248, 251)` light, `rgb(7, 13, 26)` dark: **pass** |
| 6 (SC-004) | Start screen and the five views in dark theme | navy surfaces throughout. The four start heroes' decorative glow was retinted from teal to the blue token during this check: **pass** |
| 1, 3 | Artifact choices, cards, tab colour markers | as specified: **pass** |
| 4 | Ctrl+K on a workflow view, type "gui", Enter | opens Guided Workflow through its tab (tab menu shown, so FR-019's tab path): **pass** |
| 4 (FR-018) | Ctrl+K inside the collection Name field | palette does not open: **pass** |
| 5 | Help dialog, then Escape | closes, focus back on the help button: **pass** |
| 7 (FR-012) | 390 px width | no horizontal overflow, one column, illustration hidden. The header hides the version badge below `sm` and the name truncates; the controls stay reachable: **pass** |
| 7 (FR-024) | Reduced motion | card `transition-duration` 1e-05s: **pass** |

## Full quickstart walkthrough (scenarios 1 to 7)

**2026-10-04, after the user's amendments (spacing, colours, justification, per-workflow
scheme).** Driven with Playwright 1.63 (Chromium, headless, 1440 × 900) from a scratch folder.
Nothing was added to the repository. It ran against a separate stack:
- backend on port 4100 with its own SQLite file and `AI_PROVIDER_MODE=mock`;
- frontend on port 5180.

The fixtures were:
- `paypal-invoicing-v2.yaml` (22 operations; the guided run produced 1,678 scenarios);
- a two-request Postman collection aimed only at the scratch backend: `/api/health` passes and a
  missing route fails;
- a small k6 script.

No external host was contacted. Screenshots of every view's main screens, in both themes, were
reviewed by eye. Result: **41/41 checks pass**. Of the first run's failures, five were script
bugs: lazy-load timing, a group lookup that counted the theme toggle, and confirmation buttons
whose labels carry a count. They were fixed in the script, and the dark Import & Run flow was
re-run with labelled inputs.

| Scenario | Checks | Notes |
|---|---|---|
| 1 Start screen | 5/5 | Headline; three artifact groups with their workflows; five cards in tab order; Recommended only on Guided. Quick performance test from its artifact control and from its card give the same view and tab menu (SC-002). Re-checked on the user's committed `EntryChooser` (product marks, new descriptions): the k6 artifact control opens Run k6 Script. |
| 2 Fold (amended) | 2/2 | "Launch a test session" bottom edge at 638 px of a 657 px viewport, light and dark. |
| 3 Tabs | 4/4 | Labels unchanged; five `aria-hidden` colour markers; the guided tab shows its upload prompt; Back to start returns to the chooser. |
| 4 Palette | 12/12 | Step 1: focus in filter, no Back to start on the start screen. Step 2: "k6" + Enter opens Run k6 Script. Step 3: Back to start offered; the highlight wraps. Step 4: Escape closes. Step 5: Ctrl+K in a text field leaves the palette closed. Step 6: likewise over the help dialog. Step 7: the theme switch is remembered after a reload. Step 8: with the guided run in progress (tab menu hidden), choosing Quick performance test behaves as its card, and the guided run resumes at API Review. Step 9: opening, filtering, moving and the theme switch sent **0** requests. |
| 5 Help dialog | 2/2 | Three shortcuts and five workflows; Escape closes it and focus returns to the help button. |
| 6 One visual system | 12/12 | Captured in both themes: Guided Workflow (Upload → API Review → Scenario Review → bulk accept 1,678 → Finalize → Postman Generation), Import & Run (upload, editor, run results with an assertion failure and the failure-analysis panel), Quick test (upload, ready, seed dialog), Performance plans (list, chains, run setup, runs), Run k6 Script (add, workspace, run setup). No element has the old green-black surface colours. Each workflow's screens use its tile's hue (FR-027): `--color-brand-600` is `#c026d3` inside Import & Run, and a focused button's ring is fuchsia there and teal on the start screen. Status colours stay green, amber and red. |
| 7 Narrow, motion, focus | 4/4 | At 390 px: no horizontal scroll, and the header controls and status stay visible. Reduced motion: `transition-duration` 1e-05s. A Tab-focused artifact control shows a 2 px ring over a 2 px offset. |

**Observations for the user's walkthrough**
- Justified text (FR-026) opens wide word gaps in narrow columns, for example the API Review
  summary sidebar ("Only the selected operations, and the schemas they reference…").
  Hyphenation cannot help with words that short.
- Applying 1,678 bulk decisions in Scenario Review took about three minutes ("Applying
  decisions: X of Y"). This is existing behaviour, unrelated to AP-038.

## Acceptance

Accepted by the user on 2026-10-04, after the scripted walkthrough above and the user's own
review. AP-038 is recorded as Implemented in `specs/ROADMAP.md` (Next Actions #55). Final
validation: `npm test` 2,471 passed, 10 skipped; lint clean; build succeeds.
