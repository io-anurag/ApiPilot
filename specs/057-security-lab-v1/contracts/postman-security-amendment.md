# Contract: Postman Export Amendment for Security Scenarios

**Status**: additive amendment to `specs/007-postman-collection-generator`. **Spec**: FR-063, US7, SC-004, SC-009, SC-014.
Research: R16.

## Entry point

`generateSecurityCollection(apiModel, approvedSecurityVersions, options) → ExportOutcome` in `backend/src/postman/`. It reuses
`buildRequestItem`, `authMapping`, `artifactVariables`, `identifiers`, the folder builder and `validateCollection`, and returns
the existing `ExportResult` shape (`collection`, `environment`, `readme`, `validation`, `limitations`, `summary`). The
existing `generateCollection` and every existing output are unchanged: a byte-equality test over the existing corpus
guards this.

## Inputs

Only **approved scenario versions**, each as `{scenarioId, version, content}` where the approval's `contentHash` equals the
content's hash (the exporter re-checks and refuses a mismatch with `unapproved_version`). Never a draft, a rejected or a stale
version. An empty set returns `empty_approved_set`.

## Item construction

1. The base item comes from `buildRequestItem` using a `TestScenario`-shaped view of the version's `baseRequest` (no assertions).
2. `securityOverlay.ts` applies the version's mutations as pure functions on the item:

| Mutation | Effect on the item |
|---|---|
| `auth.omit` | removes the auth block and any credential header or query that `authMapping` added |
| `auth.invalid-token` | sets the credential to the placeholder `{{invalid_credential}}` (a documented variable with a fixed non-secret example value) |
| `auth.malformed` | sets the credential to `{{malformed_credential}}` (fixed non-secret example value) |
| `auth.expired` | uses the identity's expired-credential variable name, empty value, secret |
| `identity.swap`, `path-id.substitute` | switches the credential variable and the path variable to the named identity's variables |
| `body.add-property` | adds the property to the example body |
| `field.violate-constraint`, `input.injection-probe` | uses the same generated values as the scenario (fixed probe text, not a credential) |
| `method.probe` | exported as a request with that method on the path |

3. Assertions come from fixed script templates for conditions: `status.not-success`, `status.in-set`, `status.equals`,
   `status.not-equals`, `header.present`, `header.absent`, `body.field-absent`, `body.field-present`. Templates are ApiPilot's
   own text with only a status number, header name or field path inserted after validation; no scenario text becomes code.
4. Folder per category, request name `"[<category>] <title>"`, description carrying scenario id, version, taxonomy edition and ids,
   expected statement and the "produced by Security Lab, specification revision <hash>" line.
5. Item ids are deterministic from `scenarioId` and `version`.

## Not expressible, so listed

New `GenerationLimitationKind` values, non-blocking, each naming `scenarioId` and the reason:

| Kind | Cause |
|---|---|
| `security-repeat-not-expressible` | `request.repeat` (one item per request in the exporter) |
| `security-persisted-state-not-expressible` | `persisted.field-unchanged` |
| `security-condition-not-expressible` | any condition without a template (`body.not-match-leak-pattern`, `repeat.limit-engaged`, `header.value-not-contains`) |

The scenario is neither dropped silently nor approximated: it appears in `limitations`, in the README, and in the response.

## Secrets

Credentials are variables only: names `<identity>_<scheme>` secret, value empty in the template; the README lists the variables
the user must supply. No identity value, token, cookie or password appears in the collection, the environment, the README or
any log (seeded-secret test, SC-009).

## Determinism

The same approved set and options give an equivalent collection and environment (XVI, SC-004). No AI is involved.

## Consumers to update

`GenerationLimitationKind` and `aggregateLimitations` (shared-domain `postmanArtifact.ts`), the export-limitations display
(`PostmanExportLimitations`) for the new kinds, and the validator's allowed-variable check for the two example variables.
