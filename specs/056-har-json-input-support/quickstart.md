# Quickstart: Validating HAR and JSON Input Support

Runnable validation scenarios, one group per user story. Contracts and rules are referenced, not repeated:
[upload-api-amendment.md](contracts/upload-api-amendment.md), [har-import-rules.md](contracts/har-import-rules.md),
[observed-generation-rules.md](contracts/observed-generation-rules.md),
[api-definition-format-v1.md](contracts/api-definition-format-v1.md), [data-model.md](data-model.md).

## Prerequisites

- Node.js 24, `npm install` at the repository root (this adds `ajv` to `backend`).
- The constitution amendment 3.2.0 (applied 2026-10-18; plan, *Governance prerequisite*) reviewed and merged, and
  `specs/constitution.md` resynced, before implementation.
- No model, GPU, network or k6 is needed. AI-dependent checks use the mock provider (`AI_PROVIDER_MODE=mock`, the test default).
- Fixtures under `backend/tests/fixtures/apiInput/` and, for manual runs, `docs/examples/sample-capture.har`,
  `docs/examples/sample-api-definition.json` and `docs/examples/sample-openapi.json` (all synthetic, no real credentials).

## Automated validation

```bash
npm test                                   # whole suite; existing tests must pass unmodified (SC-002)
npm test -- backend/tests/unit/apiInput    # input layer units
npm test -- backend/tests/integration/apiInput.upload.test.ts
npm test -- backend/tests/integration/apiInput.secrets.test.ts   # SC-004 corpus
npm test -- backend/tests/integration/apiInput.limits.test.ts    # SC-009
npm run lint
npm run build
```

Do not claim any of these passed without running it.

## Story 1: recognizing the format (Slice A)

Start the app (`npm run dev`), open the guided workflow, and upload each file. Expected outcomes:

| File | Expected |
| --- | --- |
| An OpenAPI YAML spec | Unchanged behaviour. Format shown as **OpenAPI (YAML)**. |
| The same spec as JSON (`docs/examples/sample-openapi.json`) | Same operations, same analysis summary, same scenarios. Format **OpenAPI (JSON)**. |
| A Postman collection JSON | No workflow. Message says a Postman collection was recognized, with an action to open Import & Run Collection. |
| `{"hello": "world"}` | No workflow. `unrecognized_input_format`, naming the supported formats. |
| JSON with both `openapi` and `log.entries` | No workflow. `ambiguous_input_format` naming both families. |
| A Swagger 2.0 JSON file | The same unsupported-version message as the YAML equivalent. |
| A `.json` file whose content is YAML | Judged by content: processed as YAML. |
| A `.har` file that is truncated JSON | `invalid_json`, naming the parse problem, not the extension. |
| An empty file | The existing `invalid_yaml` empty-document message. |

Automated: `apiInput.upload.test.ts` and the YAML/JSON equivalence test (deep equality of `apiModel`, and of generated
scenarios with ids normalized) over every existing OpenAPI fixture (SC-001).

## Story 5: safety first (Slice B, gate for Story 2)

Run `apiInput.secrets.test.ts`. It uploads a HAR seeded with markers (`SEEDED-SECRET-*`) in `Authorization`, `Cookie`,
`Set-Cookie`, query strings (`api_key`, `access_token`), JSON and form bodies and URL userinfo, then drives the workflow
through generation, AI enhancement (mock provider) and Postman generation, and asserts that no marker appears in: the HTTP
responses (including the import report), captured log output, the AI prompt text, and the generated collection and
environment JSON. Expected: zero occurrences (SC-004).

Limits: `apiInput.limits.test.ts` uploads a file over 10 MiB, a capture over `INPUT_HAR_MAX_ENTRIES`, JSON nested past
`INPUT_MAX_JSON_DEPTH`, and entries with oversized bodies. Expected: refusal naming the limit (or the body skipped and
reported), and a second session's `GET /api/test-generation-workflow` completing normally during the large analysis
(SC-009). A unit test confirms nothing in `backend/src/apiInput/` imports `http`, `https`, `net`, `dns`, `fs` or
`child_process`.

## Stories 2 and 3: HAR import and report (Slice B)

Upload `docs/examples/sample-capture.har`. Expected, in the apiReview stage:

1. A **HAR import summary** shows total, imported, excluded, malformed and operation counts, and they reconcile
   (imported + excluded + malformed = total).
2. Exclusions are listed by reason with counts: analytics beacon, third-party font, CORS preflight, redirect, `304`,
   static assets, each with its rule name.
3. Repeated calls to one endpoint appear as one operation. A path with a varying identifier is one operation with a path
   parameter marked **Inferred ×N**. A path with identifier-like text in a single observation stays literal and the
   analysis issues include `ambiguous-path`.
4. Statuses are labelled **Observed ×N**. No error status appears unless it was in the capture.
5. Every origin label is text (not color alone), readable in light and dark themes and with keyboard-only navigation.
6. A HAR where every entry is excluded or malformed creates no workflow and shows the counts by reason
   (`no_operations_derived`).

Determinism (SC-003): upload the same file again, or run the unit test that serializes the model and report twice and
compares them. Expected: identical.

Timing (SC-007): the 500-entry fixture reaches the operation list in under 30 s.

## Story 4: generation (Slice C)

Continue the HAR run through deterministic generation. Expected:

- Each observed 2xx status has one positive scenario using the observed example, whose only assertion is that status,
  shown as **Observed**.
- Negative scenarios (`missing-field`, `invalid-type`) exist only for fields seen in at least 3 consistent bodies, are
  labelled **Inference-derived**, and have no status assertion unless a matching failure was observed.
- No boundary, enum, format, header, body or schema assertion exists for any HAR operation.
- An operation with no 2xx response, or whose observed requests all have a multipart file part, is listed with the reason no
  scenarios were generated.
- An operation observed with a form-encoded or multipart text-field body has a positive scenario using the observed field
  values; credential-named values appear as placeholders in the model and as variable references in the artifact.
- Dependency review proposes a likely or possible relationship for the login-token and created-id reuse in the fixture,
  never confirmed on value matching alone.
- Postman generation succeeds, the collection contains variable references and no captured credential, and the base URL
  is the selected environment, never the capture's host. Execution still requires choosing an environment and the existing
  confirmation.

Exporter checks (FR-056, FR-048):

```bash
npm test -- backend/tests/unit/postman/formBodies.test.ts
npm test -- backend/tests/unit/postman/existingArtifactsUnchanged.test.ts   # byte equality, existing OpenAPI fixtures
npm test -- backend/tests/integration/execution/formBodiesNewman.test.ts    # local server receives urlencoded and multipart fields
```

Expected: the generated collection for the HAR fixture has an `urlencoded` item and a `formdata` item (with no manual
`Content-Type` on the multipart one), no `[redacted:` text anywhere, and a secret variable for each credential kind seen;
generation fails with `collection_validation_failed` if a unit test injects a placeholder the exporter cannot substitute.

OpenAPI regression: generate for an existing OpenAPI fixture and compare against the stored expectation. Expected:
unchanged, including the AI prompt text and the Postman artifacts, byte for byte.

## Story 6: definition format (Slice D)

Upload `docs/examples/sample-api-definition.json`. Expected: format **ApiPilot API definition**, 2 operations, declared
labels, one verified dependency, deterministic scenarios from the existing rules. Then upload each invalid fixture:

| Fixture | Expected `problems` entry (location) |
| --- | --- |
| wrong version | `/version` |
| misspelled field | `/operations/<n>/<field>` |
| duplicate method and path | `/operations/<n>` |
| malformed path | `/operations/<n>/path` |
| status 99 | `/operations/<n>/responses/<m>/status` |
| hint naming a missing operation | `/dependencyHints/<n>/consumer/operation` |
| arbitrary JSON with an `operations` list but no `format` | `unrecognized_input_format`, no problems list |

Expected: all violations reported in one response, nothing imported. A definition whose example holds
`"Authorization": "Bearer SEEDED-SECRET-1"` imports with a placeholder and a `credential-detected` issue, and the marker
appears nowhere in the outputs.

## Story 7: documentation (Slice E)

Follow `README.md`, `docs/USER_MANUAL.md` and `docs/api-definition-format.md` with only the bundled example files and reach
a reviewed operation list for a HAR and for a definition in under 10 minutes (SC-010). Check that the documented
representative outputs (counts, exclusion reasons, operation lists) match what the product shows for those files.

## Completion checklist

- [ ] Constitution 3.2.0 reviewed and merged; `specs/constitution.md` resynced.
- [ ] Exporter byte-equality snapshot passes for every existing OpenAPI fixture.
- [ ] `npm test`, `npm run lint`, `npm run build` run and reported honestly.
- [ ] Existing OpenAPI tests unmodified and passing.
- [ ] README, architecture, user manual, HTTP API, configuration, `.env.example`, definition reference, examples updated.
- [ ] 002 and 009 contract amendment pointers added; roadmap entry added.
- [ ] Version bumped with `npm run version:bump -- feature` (19.58.0 to 19.59.0) and the lockfile updated through npm.
- [ ] Changes left uncommitted for review.
