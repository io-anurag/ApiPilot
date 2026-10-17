# Contract: Destination addresses

Implements FR-029, FR-005, SC-011. Pure module `frontend/src/navigation/routes.ts`; hook `useRoute`. No new dependency.

## Address grammar

The address is the URL hash. The path and query string are never read or written, so the AP-049 access token and `?mock=...` preview addresses are untouched.

| Hash | Destination |
|---|---|
| (empty) or `#/` | Home |
| `#/guided` | Guided Workflow, at the stage the workflow is on (Upload when none) |
| `#/guided/<stageId>` | A Guided Workflow stage; `<stageId>` is one of the eleven `WorkflowStageId` values (`upload`, `analysis`, `apiReview`, `deterministicGeneration`, `aiEnhancement`, `scenarioReview`, `dependencyAnalysis`, `workflowReview`, `postmanGeneration`, `execution`, `performanceTesting`) |
| `#/import` | Import & Run Collection |
| `#/performance` | Performance |
| `#/k6` | Run k6 Script |
| `#/coverage` | API Test Coverage |

An address carries identifiers only. It MUST NOT carry specification content, file, collection, plan or script names, script text, values, run or collection ids, credentials or tokens. (Opening a specific run from Home is a navigation request held in memory, not part of the address.)

## Functions

- `parseRoute(hash: string): Route | null`: returns `null` for anything that does not match the grammar exactly (unknown segment, extra segments, an unknown stage id, wrong case). No partial matches.
- `formatRoute(route: Route): string`: the exact inverse; `parseRoute(formatRoute(r))` equals `r` for every valid route.
- `resolveRoute(requested: Route | null, state: ResolveState): RouteResolution`: pure, total, never throws. `ResolveState` is `{ workflow: TestGenerationWorkflow | null }`.

## Resolution rules

| Requested | Condition | Shown | Notice |
|---|---|---|---|
| `null` (does not parse) | always | Home | "That address does not match a screen, so Home is shown." |
| `#/guided/<stage>` | no workflow in the session | `#/guided` (Upload) | "There is no workflow in progress, so the Guided Workflow opens at Upload." |
| `#/guided/<stage>` | stage status `not-yet-reached` | `#/guided/<activeStageId>` | the stage's `getLockReason` text, e.g. "Complete Scenario Review first." |
| `#/guided/<stage>` | stage complete, skipped, partial, stale or active | as requested | none |
| any other valid route | always | as requested | none |

A redirect uses `replace` (the browser address is replaced, so Back is not trapped on the invalid address). A user navigation uses push. The notice is shown once in a polite live region at the top of the main area and dismissed on the next navigation.

## History behaviour

- Choosing a sidebar item, a Home tile, a palette command or a link inside a page pushes an address.
- Back and Forward fire `hashchange`; the shell re-resolves and shows that destination without discarding the pages kept mounted (FR-005).
- A refresh reloads the page with the same hash and resolves it against what the server holds for the session; in-page state not held by the server is lost, as today.
- Opening the app with no hash shows Home and does not rewrite the address.

## Tests (frontend/tests/unit/navigation/routes.test.ts)

Round trip for every route and stage; rejection of malformed and mixed-case hashes; each resolution row above; assertion that no formatted address contains `?`, `=`, a file extension or a space; a test that `resolveRoute` is the only place a redirect decision is made.
