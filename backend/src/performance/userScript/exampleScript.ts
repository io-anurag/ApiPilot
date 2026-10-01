/**
 * ApiPilot's fixed starter script for a new user script (specs/034-run-user-k6-script FR-010,
 * US3 AS1): one named request to `BASE_URL`, one check, no credentials. It passes the script check.
 */
export const EXAMPLE_SCRIPT = `// A k6 script you can run from ApiPilot (Run k6 Script).
// Credentials belong in environment values, never in the script: read them through __ENV and
// map each name to an environment value in Run setup. ApiPilot cannot check a script holds none.
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 1,
  duration: "30s",
};

export default function () {
  const response = http.get(\`\${__ENV.BASE_URL}/\`, { tags: { name: "GET /" } });
  check(response, { "status is 2xx": (r) => r.status >= 200 && r.status < 300 });
  sleep(1);
}
`;
