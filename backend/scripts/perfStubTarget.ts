import { TargetServer } from "../tests/fixtures/execution/targetServer";

/**
 * A local stub target for AP-029's manual quickstart (specs/031-k6-performance-testing quickstart.md,
 * tasks T091) and AP-032's (specs/032-quick-performance-test quickstart.md). It serves
 * `tests/fixtures/openapi/performance.yaml`'s and `quick-performance.yaml`'s APIs on 127.0.0.1 so a real k6
 * run never has to touch a real system. Every route not configured below answers `200 {}`, which
 * covers `GET /orders/{orderId}`, `GET /warehouses/{warehouseId}` and `GET /status`.
 *
 * Run with `npm run perf:stub -w backend`. The port is `PERF_STUB_PORT`, or 4600.
 */
const ORDER_ID = "00000000-0000-4000-8000-000000000001";
const port = Number(process.env.PERF_STUB_PORT ?? "4600");

async function main(): Promise<void> {
  const server = new TargetServer();
  server.configure("POST", "/oauth/token", {
    status: 200,
    body: { access_token: "stub-token", token_type: "Bearer", expires_in: 300 },
  });
  server.configure("POST", "/orders", { status: 201, body: { orderId: ORDER_ID } });
  // AP-032 (specs/032-quick-performance-test tasks T002): tests/fixtures/openapi/quick-performance.yaml.
  // Its login issues the bearer token; POST /orders above already answers 201, and every other
  // path it documents (reads, PUT/PATCH/DELETE, logout) answers the unconfigured `200 {}`.
  server.configure("POST", "/auth/login", { status: 200, body: { accessToken: "stub-login-token" } });
  server.configure("POST", "/products", { status: 201, body: {} });
  const baseUrl = await server.start(port);
  process.stdout.write(`Performance stub target listening on ${baseUrl}\n`);

  // Prints the request count every 5 s (quickstart scenario 4 watches it stop growing on cancel),
  // then forgets the recorded requests so a long soak run does not grow this process's memory.
  let total = 0;
  const report = setInterval(() => {
    total += server.requests.length;
    server.requests.length = 0;
    process.stdout.write(`${new Date().toISOString()} requests so far: ${total}\n`);
  }, 5_000);

  const shutdown = () => {
    clearInterval(report);
    void server.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
