# Quickstart: validating the Chain Debug Run

Prerequisites: `npm install`; `npm test` is green before you start. No real k6 is needed. Contracts: [debug-run-api.md](contracts/debug-run-api.md). Types: [data-model.md](data-model.md).

## Automated checks

```bash
npm test -w backend -- chainDebug
npm test -w frontend -- ChainDebug
npm run lint
npm run build
```

Expected:
- **Parity**: the debug executor builds the same requests and reaches the same extractor, check and sent/skipped outcomes as the generated script run in the sandbox, for the same plan and stub responder.
- **Leak scan**: after a Debug run with sentinel values in secrets, bodies and headers, no table, log line or run directory contains a sentinel (SC-002).
- **Masking corpus**: Authorization, Cookie, API-key headers, secret environment values, secret data columns and credential-like extracted values are masked in URL, header and body positions (SC-003).
- **Report invariance**: the report for a fixed run summary is byte-identical to before (SC-006).

## Manual scenario: the original problem

1. Start the app (`npm run dev`) and open a request-chain plan whose first step is `POST /auth/token` with an extractor `token` that does not match the real response field.
2. Choose the local environment and open **Debug run**. Confirm the trigger shows the environment name, tier, base URL, hosts and the write steps of every chain, then confirm.
3. Expect: step 1 is shown as sent with its request and response, the response body shows its real field name (its value masked), extractor `token` shows `failed: path not found` for the path you configured, and every later step shows not sent, naming step 1 and the failed extractor as the cause.
4. Correct the extractor path and run again. Expect: later steps are sent and shown, and nothing is marked not sent.
5. Reload the page. Expect: the Debug output is gone and the runs list has no new entry.
6. Reveal a masked token value, then reload. Expect: it is masked again, and a secret environment value shows no reveal control.

## Manual scenario: safety

- Start a Debug run with an environment missing a required value: the run proceeds, the affected step is shown not sent naming the missing value.
- Point a step at a URL that redirects to another host: the redirect is not followed and is reported.
- Navigate away mid-run: the run is cancelled and nothing is stored.
- Time a Debug run of a 10-step plan against a responsive local target: the output appears within 15 seconds (SC-005).
- Compare a response body shown in the output with the same request made directly: apart from masked values the text is identical, with no reformatting.
