import { startSampleTarget } from "../tests/fixtures/securityLab/sampleTargets";
import { ALICE_KEY, ALICE_TOKEN, BOB_KEY, BOB_TOKEN } from "../tests/fixtures/securityLab/fixtureCredentials";

/**
 * A local stub target for Security Lab's manual quickstart (specs/057-security-lab-v1 quickstart.md, tasks T104).
 * It serves the sample orders API of `tests/fixtures/securityLab/sample-api.yaml` on 127.0.0.1, so a real run never
 * has to touch a real system. By default it behaves like a well-built service: it rejects missing, invalid and
 * expired credentials, refuses another user's order, validates input and answers 405 to HEAD, OPTIONS and TRACE.
 *
 * Run with `npm run security:stub -w backend`. The port is `SECURITY_STUB_PORT`, or 4700.
 *
 * `SECURITY_STUB_MODE=vulnerable` breaks those controls on purpose (reads need no credentials, any identity can read
 * any order, a malformed body returns a stack trace, probe methods are accepted), so a run has findings to show.
 * `SECURITY_STUB_FAIL_DELETE=1` makes `DELETE /orders/{id}` fail, so a cleanup failure can be seen in a run result.
 *
 * The credentials it accepts are the fixed, fake values below. They are printed so you can enter them in a profile;
 * they are not secrets and open nothing real.
 */
const port = Number(process.env.SECURITY_STUB_PORT ?? "4700");
const vulnerable = process.env.SECURITY_STUB_MODE === "vulnerable";
const failDelete = process.env.SECURITY_STUB_FAIL_DELETE === "1";

const say = (...parts: unknown[]) => process.stdout.write(`${parts.join(" ")}
`);

async function main(): Promise<void> {
  const target = await startSampleTarget({ vulnerable, failDelete }, port);
  say(`Security Lab stub target listening on ${target.origin} (${vulnerable ? "vulnerable" : "secure"} mode${failDelete ? ", DELETE fails" : ""}).`);
  say("Allowed host 127.0.0.1, port", port, "; a local profile must name the address 127.0.0.1.");
  say("Identities and fake credentials it accepts:");
  say(`  alice (owner)       bearerAuth: ${ALICE_TOKEN}   apiKeyAuth: ${ALICE_KEY}`);
  say(`  bob   (other-user)  bearerAuth: ${BOB_TOKEN}   apiKeyAuth: ${BOB_KEY}`);
  say("Test data: orderId = ord-1001, owned by alice. Press Ctrl+C to stop.");
  process.on("SIGINT", () => {
    void target.stop().then(() => process.exit(0));
  });
}

void main();
