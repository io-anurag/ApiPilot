# Quickstart: Run a User-Supplied k6 Script (AP-034)

**Feature**: [spec.md](./spec.md) | **Contracts**: [user-scripts-api.md](./contracts/user-scripts-api.md), [changes-to-existing-apis.md](./contracts/changes-to-existing-apis.md) | **Data model**: [data-model.md](./data-model.md) | **Research**: [research.md](./research.md)

These scenarios check the feature end to end:
- Scenarios 1 to 8 are manual browser walkthroughs.
- Scenario 9 is the opt-in real-k6 check.

`npm test` covers the same behaviour with AP-029's fake runner and needs no k6.

## Prerequisites

- `npm install` at the repository root, then `npm run dev`.
- **Scenarios 3 to 7 and 9 only:** k6 1.0.0 or later, installed by you, on `PATH` or named in
  `K6_BINARY_PATH`. ApiPilot does not install it.
- **Stub target:** `npm run perf:stub -w backend` (`http://127.0.0.1:4600`). Never point these
  scenarios at a system you are not authorized to load.
- **Scripts** in `backend/tests/fixtures/userScripts/`, added by this feature:
  - `accepted/basic.js`: reads `__ENV.BASE_URL` and `__ENV.API_KEY`, sends named requests to the
    stub, has checks, a group, a custom trend and a threshold.
  - `accepted/scenarios-only.js`: named scenarios and no default function.
  - `accepted/unnamed-urls.js`: unnamed requests with ids and query strings in their URLs, and more
    than 100 distinct names.
  - `refused/`: at least 25 scripts, each breaking one rule, with the expected rule and line in
    `refused/expected.json`.
- **Two environments:** `Local stub` (Local tier, base URL `http://127.0.0.1:4600`, `API_KEY` set to
  a value you remember) and `Stub alt` (Dev tier, same base URL, a different `API_KEY`).

## 1. Entry and refusals (User Story 1 AS1 to AS3; FR-001, FR-004 to FR-008; SC-001)

1. Open the app. **Expect** a "Run k6 Script" entry beside the other start-screen entries.
2. Choose it. **Expect** a page that needs no specification, offers **Upload script** and
   **Write a new script**, and states that credentials belong in environment values.
3. Upload each file in `refused/`. **Expect** for each:
   - a refusal listing every reason with its line, and the rule matching `expected.json`;
   - no new script in the list.
4. Upload a file over 1 MiB and a binary file. **Expect** both to be refused, and nothing stored.
5. Generate and download a script from a quick performance test (AP-032), and upload it here.
   **Expect**:
   - it is accepted;
   - its `APIPILOT_V_<n>` names are listed;
   - each is already mapped to the environment value it stands for, with `baseUrl` mapped to the
     base URL (spec Edge Cases).

   Confirm it and run it against the environment the quick test used. **Expect** it to send the
   same requests as the quick run, with the report naming the script as yours.
6. Upload `accepted/lookup-tables.js`. **Expect** it to be accepted: computed writes, `const`
   lookup tables, `hasOwnProperty.call` and `Map` lookups pass the check.

## 2. Upload, check results and confirmation (US1 AS2, AS4, AS5; FR-009, FR-013 to FR-016)

1. Upload `accepted/basic.js`. **Expect** it in the list with:
   - its name, size and SHA-256;
   - the hosts found, or "none found in the script text";
   - `BASE_URL` and `API_KEY` as names read;
   - "Needs confirmation".
   Compare the SHA-256 with `certutil -hashfile basic.js SHA256` (Windows) or `sha256sum`.
2. Open **Run setup**. **Expect** the trigger to be unavailable, with "the script has not been
   confirmed".
3. Open the confirmation. **Expect** it to:
   - say ApiPilot did not write or verify the script;
   - list the hosts;
   - say hosts built at run time cannot be listed;
   - say ApiPilot cannot restrict where requests go;
   - show the SHA-256.
   Confirm.
4. Rename the script. **Expect** it to stay confirmed.

## 3. A run against one environment (US1 AS6 to AS8; FR-017 to FR-023, FR-030 to FR-036)

1. Choose `Local stub`. **Expect** the trigger to show:
   - the environment's name;
   - the tier label "Local";
   - the base URL;
   - the hosts found;
   - the statement that load comes from the machine running ApiPilot.
2. Start the run. **Expect** progress within 5 seconds: elapsed time, virtual users, requests and
   failures. **Expect** the target and hosts to stay visible.
3. When it ends, **expect** the report to:
   - say the script was supplied by you, with its name and SHA-256;
   - show the environment, the k6 version, "the script's own load settings", and the mapped names
     with their sources and no values;
   - group requests by their k6 names;
   - show checks, the group, the custom trend and the script's threshold outcome;
   - list the hosts that received requests;
   - show the write requests by name and method.
4. Download the report and open it offline. **Expect** it to render completely.

## 4. Mapping and a second environment (User Story 2; FR-024 to FR-026; SC-004)

1. Run the script against `Stub alt`. **Expect** the stub's request log to show each run's own
   `API_KEY`.
2. Search the backend log (`logs/backend.log`), the report and the run page for both `API_KEY`
   values. **Expect** no match.
3. Map `API_KEY` to a value `Stub alt` does not have. **Expect** "missing" before the run. **Expect**
   the run to start anyway, with the script receiving no value for that name.
4. Add the names `K6_OUT`, `PATH`, `1ABC` and `A-B`. **Expect** each to be refused with its reason.

## 5. Load override and thresholds (US2 AS5 to AS7; FR-027, FR-028)

1. Choose the Smoke profile and change a stage. **Expect** the confirmation to be kept.
2. Run. **Expect**:
   - the virtual users to follow the stages;
   - the run controls and report to show the stages as the load used;
   - the SHA-256 in the report to be unchanged.
3. Add an ApiPilot p95 threshold that fails. Run. **Expect** it marked failed against the measured
   value, and the script's own threshold outcome shown separately.
4. Upload `accepted/scenarios-only.js`, confirm it, and choose a profile. **Expect** the override to
   be unavailable with the reason, and runs to use the script's own settings.

## 6. Editor (User Story 3; FR-010 to FR-012, FR-016)

1. Choose **Write a new script**. **Expect** the fixed example, reading `BASE_URL`, with line
   numbers, highlighting and the credentials note.
2. Save, confirm and run it.
3. Edit one line and save. **Expect** a new SHA-256, "Needs confirmation", and the trigger
   unavailable.
4. Add `import x from "https://jslib.k6.io/x.js";` and save. **Expect**:
   - a refusal at that line;
   - the stored script unchanged;
   - your unsaved text still in the editor.
5. Leave the editor. **Expect** a prompt to discard unsaved changes.
6. Download. **Expect** the file to equal the stored bytes (compare the SHA-256).

## 7. Unnamed requests, run failures and the slot (Edge Cases; FR-029, FR-032)

1. Run `accepted/unnamed-urls.js`. **Expect**:
   - unnamed requests shown as method, host and path, with no query string;
   - an "Other requests" row with the count of combined names, and the note on naming requests.
2. Save a script that throws in its init code, confirm and run it. **Expect** a failed run, with
   k6's message (at most 2,000 characters) on the run's page, and nothing from it in
   `logs/backend.log`.
3. Make the script `console.log(__ENV.API_KEY)`, then run it. **Expect** the value nowhere in the
   run page, report or log.
4. Start a run and, while it runs, try to start a quick performance run or a collection run.
   **Expect** both refused with "an execution is in progress". Try to delete the running script and
   **expect** a refusal.
5. Start a run and stop the backend. Restart it. **Expect** the run recorded as cancelled because
   of a backend restart, and no run started.

## 8. Environment access and isolation (FR-024)

In a new browser session, open "Run k6 Script" with no scripts. **Expect** the environment list to
be unavailable until a script is stored. **Expect** no change to the guided or quick paths.

## 9. Opt-in real k6 (research R21)

Run `npm run test:k6-real -w backend` with k6 installed and the stub target running. **Expect** the
user-script case to pass. It checks that:
- `name` and `url` tags reach the aggregate;
- `--stage` overrides the script's scenarios;
- exit code 99 is reported for a crossed script threshold;
- console output is not stored.
