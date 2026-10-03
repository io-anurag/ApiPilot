import { describe, expect, it } from "vitest";
import type { ChainPlan, ChainStep } from "@apipilot/shared-domain";
import { SandboxAbort, type SandboxRequest, type SandboxResponse } from "../../../fixtures/performance/k6Sandbox";
import { counted, loadChainPlan } from "../../../fixtures/chain/chainSandbox";
import { bodyExtractor, chain, chainPlan, customerLifecyclePlan, step } from "../../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T025; research R5, R11 to R13; FR-008 to FR-019, FR-040). */

const BASE = "http://127.0.0.1:4600";
const VALUES = { baseUrl: BASE, client_id: "id-1", client_secret: "secret-1" };
const NO_SETUP = { setup: [] };

function planOf(...chains: ChainStep[][]): ChainPlan {
  return chainPlan({ chains: chains.map((steps, index) => chain(`c${index + 1}`, `Chain ${index + 1}`, steps)), thinkTimeMs: 0 });
}

/** A stateful customers stub: tokens issued by count, ids by count. */
function customers(options: { tokenStatus?: number; expiresIn?: number } = {}) {
  let tokens = 0;
  let ids = 0;
  return (request: SandboxRequest): SandboxResponse => {
    const path = request.url.slice(BASE.length).split("?")[0];
    if (path === "/auth/token") {
      if (options.tokenStatus) return { status: options.tokenStatus, body: { error: "no" } };
      tokens += 1;
      return { status: 200, body: { access_token: `tok-${tokens}`, ...(options.expiresIn ? { expires_in: options.expiresIn } : {}) } };
    }
    if (path === "/api/v1/customers" && request.method === "POST") {
      ids += 1;
      return { status: 201, body: { id: `cust-${ids}` } };
    }
    if (request.method === "DELETE") return { status: 204 };
    const id = /\/api\/v1\/customers\/(.+)$/.exec(path)?.[1];
    return { status: 200, body: id ? { id: decodeURIComponent(id), status: "ACTIVE" } : { items: [] } };
  };
}

describe("chain runtime: the US1 journey", () => {
  it("sends the token request once before load and every later request with it and the VU's own id", () => {
    const respond = customers();
    const iterations = { next: 0 };
    const setupVu = loadChainPlan(customerLifecyclePlan({ thinkTimeMs: 0 }), { values: VALUES, respond, iterations });
    const data = setupVu.setup();
    const users = [1, 2].map((vu) => loadChainPlan(customerLifecyclePlan({ thinkTimeMs: 0 }), { values: VALUES, respond, vu, iterations }));
    for (let iteration = 0; iteration < 3; iteration += 1) for (const user of users) user.iterate(data, iteration);

    expect(setupVu.requests.map((r) => [r.method, r.url, r.tags])).toEqual([["POST", `${BASE}/auth/token`, { apipilot_kind: "setup", setup_step: "s1" }]]);
    expect(setupVu.requests[0].body).toBe("client_id=id-1&client_secret=secret-1");
    expect(setupVu.requests[0].headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    for (const user of users) {
      expect(user.requests).toHaveLength(18);
      expect(user.requests.every((r) => r.headers.Authorization === "Bearer tok-1")).toBe(true);
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const sent = user.requests.slice(iteration * 6, iteration * 6 + 6);
        const created = /cust-\d+/.exec(String(sent[0].body ?? "")) ?? null;
        expect(created).toBeNull();
        const id = sent[2].url.split("/").pop();
        expect(sent.slice(2).map((r) => r.url.split("/").pop())).toEqual([id, id, id, id]);
      }
    }
    expect(users[0].requests[1].url).toBe(`${BASE}/api/v1/customers?page=1&size=20`);
    expect(counted(users[0], "apipilot_cut_short")).toEqual([]);
  });
});

describe("chain runtime: runs settings and scopes (FR-008, FR-010, R5)", () => {
  it("runs a once-per-virtual-user step on the first iteration only, and again after it failed", () => {
    let loginStatus = 500;
    const plan = planOf([
      step({ id: "s1", method: "POST", url: "{{baseUrl}}/login", runs: "once-per-virtual-user", extractors: [bodyExtractor("x1", "session", "session")] }),
      step({ id: "s2", url: "{{baseUrl}}/me", headers: [{ name: "X-Session", value: "{{session}}" }] }),
    ]);
    const sandbox = loadChainPlan(plan, {
      values: VALUES,
      respond: (request) => (request.url.endsWith("/login") ? { status: loginStatus, body: { session: "sess-1" } } : { status: 200, body: {} }),
    });
    sandbox.iterate(NO_SETUP, 0);
    expect(sandbox.requests.map((r) => r.url)).toEqual([`${BASE}/login`]);
    expect(counted(sandbox, "apipilot_cut_short")).toEqual([{ step: "s1", journey: "c1", capture: "session" }]);
    loginStatus = 200;
    sandbox.iterate(NO_SETUP, 1);
    sandbox.iterate(NO_SETUP, 2);
    expect(sandbox.requests.map((r) => r.url.slice(BASE.length))).toEqual(["/login", "/login", "/me", "/me"]);
    expect(sandbox.requests.slice(2).map((r) => r.headers["X-Session"])).toEqual(["sess-1", "sess-1"]);
  });

  it("clears every-iteration values each iteration, so a failed extraction never reuses the last one", () => {
    let created = 0;
    const plan = planOf([
      step({ id: "s1", method: "POST", url: "{{baseUrl}}/items", extractors: [bodyExtractor("x1", "item_id", "id")] }),
      step({ id: "s2", url: "{{baseUrl}}/items/{{item_id}}" }),
    ]);
    const sandbox = loadChainPlan(plan, {
      values: VALUES,
      respond: (request) => {
        if (request.method !== "POST") return { status: 200, body: {} };
        created += 1;
        return { status: 200, body: created === 2 ? {} : { id: `item-${created}` } };
      },
    });
    for (let iteration = 0; iteration < 3; iteration += 1) sandbox.iterate(NO_SETUP, iteration);
    expect(sandbox.requests.map((r) => r.url.slice(BASE.length))).toEqual(["/items", "/items/item-1", "/items", "/items", "/items/item-3"]);
    expect(counted(sandbox, "apipilot_not_attempted")).toEqual([{ step: "s2", journey: "c1", reason: "cut-short" }]);
  });

  it("lets a later extractor of the same name replace the value for the steps after it", () => {
    const plan = planOf(
      [step({ id: "s1", extractors: [bodyExtractor("x1", "id", "a")] }), step({ id: "s2", url: "{{baseUrl}}/one/{{id}}" })],
      [step({ id: "s3", extractors: [bodyExtractor("x2", "id", "b")] }), step({ id: "s4", url: "{{baseUrl}}/two/{{id}}" })],
    );
    const sandbox = loadChainPlan(plan, { values: VALUES, respond: () => ({ status: 200, body: { a: "first", b: "second" } }) });
    sandbox.iterate(NO_SETUP, 0);
    expect(sandbox.requests.map((r) => r.url.slice(BASE.length))).toEqual(["/health", "/one/first", "/health", "/two/second"]);
  });
});

describe("chain runtime: extractors and cut short (FR-009, FR-011, FR-012)", () => {
  it("attempts extractors only on an expected status, cuts the chain short, and moves to the next chain", () => {
    const plan = planOf(
      [step({ id: "s1", method: "POST", url: "{{baseUrl}}/a", expectedStatuses: ["201"], extractors: [bodyExtractor("x1", "a_id", "id")] }), step({ id: "s2", url: "{{baseUrl}}/a/{{a_id}}" }), step({ id: "s3" })],
      [step({ id: "s4", url: "{{baseUrl}}/b" })],
    );
    const sandbox = loadChainPlan(plan, { values: VALUES, respond: (request) => (request.url.endsWith("/a") ? { status: 200, body: { id: "a-1" } } : { status: 200, body: {} }) });
    sandbox.iterate(NO_SETUP, 0);
    expect(sandbox.requests.map((r) => r.url.slice(BASE.length))).toEqual(["/a", "/b"]);
    expect(counted(sandbox, "apipilot_capture")).toEqual([{ step: "s1", journey: "c1", capture: "a_id", outcome: "failed" }]);
    expect(counted(sandbox, "apipilot_cut_short")).toEqual([{ step: "s1", journey: "c1", capture: "a_id" }]);
    expect(counted(sandbox, "apipilot_not_attempted").map((tags) => tags.step)).toEqual(["s2", "s3"]);
  });

  it.each([
    [{ id: "" }, "an empty string"],
    [{ id: { nested: 1 } }, "an object"],
    [{ id: null }, "null"],
    [{ other: 1 }, "a missing field"],
    ["not json", "a body that is not JSON"],
  ])("fails an extractor on %j (%s)", (body) => {
    const plan = planOf([step({ id: "s1", extractors: [bodyExtractor("x1", "v", "id")] })]);
    const sandbox = loadChainPlan(plan, { values: VALUES, respond: () => ({ status: 200, body }) });
    sandbox.iterate(NO_SETUP, 0);
    expect(counted(sandbox, "apipilot_capture")[0].outcome).toBe("failed");
  });

  it("takes numbers and booleans as text, and a header case-insensitively and unsplit", () => {
    const plan = planOf([
      step({
        id: "s1",
        extractors: [bodyExtractor("x1", "n", "count"), bodyExtractor("x2", "b", "flag"), { id: "x3", name: "loc", source: { kind: "header", name: "LOCATION" } }],
      }),
      step({ id: "s2", url: "{{baseUrl}}/{{n}}/{{b}}", headers: [{ name: "X-Loc", value: "{{loc}}" }] }),
    ]);
    const sandbox = loadChainPlan(plan, { values: VALUES, respond: () => ({ status: 200, body: { count: 42, flag: false }, headers: { Location: "/x/1, /x/2" } }) });
    sandbox.iterate(NO_SETUP, 0);
    expect(sandbox.requests[1].url).toBe(`${BASE}/42/false`);
    expect(sandbox.requests[1].headers["X-Loc"]).toBe("/x/1, /x/2");
    expect(sandbox.requests[0].responseType).toBe("text");
    expect(sandbox.requests[1].responseType).toBe("none");
  });
});

describe("chain runtime: values (FR-013, FR-015, AP-029 FR-014)", () => {
  it("sends nothing for a step missing an environment value, and does not attempt a step whose extracted value is absent", () => {
    const plan = planOf([
      step({ id: "s1", url: "{{baseUrl}}/a/{{tenant}}", extractors: [bodyExtractor("x1", "a", "a")] }),
      step({ id: "s2", url: "{{baseUrl}}/b/{{a}}" }),
      step({ id: "s3", url: "{{baseUrl}}/c" }),
    ]);
    const sandbox = loadChainPlan(plan, { values: VALUES, respond: () => ({ status: 200, body: { a: "1" } }) });
    sandbox.iterate(NO_SETUP, 0);
    expect(sandbox.requests.map((r) => r.url.slice(BASE.length))).toEqual(["/c"]);
    expect(counted(sandbox, "apipilot_missing_data")).toEqual([{ step: "s1", journey: "c1", variable: "tenant" }]);
    expect(counted(sandbox, "apipilot_not_attempted")).toEqual([{ step: "s2", journey: "c1", reason: "dependency" }]);
  });

  it("encodes URL references except baseUrl, query rows, JSON bodies and form fields; a listed Content-Type wins", () => {
    const plan = planOf([
      step({
        id: "s1",
        method: "POST",
        url: "{{baseUrl}}/search/{{term}}",
        query: [{ name: "q {{term}}", value: "{{term}}" }],
        headers: [{ name: "content-type", value: "application/vnd.api+json" }],
        body: { kind: "raw", contentType: "application/json", text: '{"term":"{{term}}"}' },
      }),
      step({ id: "s2", method: "POST", url: "{{baseUrl}}/form", body: { kind: "form", fields: [{ name: "a b", value: "{{term}}" }] } }),
      step({ id: "s3", method: "POST", url: "{{baseUrl}}/text", body: { kind: "raw", contentType: "text/plain", text: "say {{term}}" } }),
    ]);
    const sandbox = loadChainPlan(plan, { values: { ...VALUES, term: 'a/b "c"&d' }, respond: () => ({ status: 200 }) });
    sandbox.iterate(NO_SETUP, 0);
    const [search, form, text] = sandbox.requests;
    expect(search.url).toBe(`${BASE}/search/a%2Fb%20%22c%22%26d?q%20a%2Fb%20%22c%22%26d=a%2Fb%20%22c%22%26d`);
    expect(search.body).toBe('{"term":"a/b \\"c\\"&d"}');
    expect(search.headers).toEqual({ "content-type": "application/vnd.api+json" });
    expect(form.body).toBe("a%20b=a%2Fb%20%22c%22%26d");
    expect(form.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(text.body).toBe('say a/b "c"&d');
    expect(text.headers["Content-Type"]).toBe("text/plain");
  });

  it("pauses after each sent step for its own think time or the plan's default", () => {
    const plan = chainPlan({ thinkTimeMs: 1500, chains: [chain("c1", "A", [step({ id: "s1" }), step({ id: "s2", thinkTimeMs: 0 }), step({ id: "s3", thinkTimeMs: 250 })])] });
    const sandbox = loadChainPlan(plan, { values: VALUES, respond: () => ({ status: 200 }) });
    sandbox.iterate(NO_SETUP, 0);
    expect(sandbox.sleeps).toEqual([1.5, 0.25]);
  });
});

describe("chain runtime: setup failure and refresh (FR-018, FR-040)", () => {
  it.each([
    [{ tokenStatus: 401 }, "status"],
    [{}, "extractor:token"],
  ])("aborts before the load when the setup step fails (%j gives %s)", (options, reason) => {
    const respond = "tokenStatus" in options ? customers(options) : () => ({ status: 200, body: { nothing: true } });
    const sandbox = loadChainPlan(customerLifecyclePlan({ thinkTimeMs: 0 }), { values: VALUES, respond });
    expect(() => sandbox.setup()).toThrow(SandboxAbort);
    expect(counted(sandbox, "apipilot_setup")).toEqual([{ setup_step: "s1", outcome: "failed", reason }]);
    expect(sandbox.aborts).toHaveLength(1);
  });

  it("aborts with missing-data when a setup step lacks an environment value, and sends nothing", () => {
    const sandbox = loadChainPlan(customerLifecyclePlan({ thinkTimeMs: 0 }), { values: { baseUrl: BASE, client_id: "id-1" }, respond: customers() });
    expect(() => sandbox.setup()).toThrow(SandboxAbort);
    expect(sandbox.requests).toEqual([]);
    expect(counted(sandbox, "apipilot_setup")).toEqual([{ setup_step: "s1", outcome: "failed", reason: "missing-data:client_secret" }]);
  });

  it("refreshes a setup value per virtual user before it expires, and never one without a stated lifetime", () => {
    const respond = customers({ expiresIn: 100 });
    const setupVu = loadChainPlan(customerLifecyclePlan({ thinkTimeMs: 0 }), { values: VALUES, respond });
    const data = setupVu.setup();
    const user = loadChainPlan(customerLifecyclePlan({ thinkTimeMs: 0 }), { values: VALUES, respond, vu: 1 });
    user.clock.now = setupVu.clock.now;
    user.iterate(data, 0);
    expect(user.requests.some((r) => r.tags.apipilot_kind === "token-refresh")).toBe(false);
    user.clock.now += 71_000;
    user.iterate(data, 1);
    const refresh = user.requests.filter((r) => r.tags.apipilot_kind === "token-refresh");
    expect(refresh).toHaveLength(1);
    expect(refresh[0].tags).toEqual({ apipilot_kind: "token-refresh", setup_step: "s1" });
    expect(user.requests.at(-1)?.headers.Authorization).toBe("Bearer tok-2");
    expect(counted(user, "apipilot_token_refresh")).toEqual([{ setup_step: "s1", outcome: "ok" }]);

    const noLifetime = loadChainPlan(customerLifecyclePlan({ thinkTimeMs: 0 }), { values: VALUES, respond: customers() });
    const plain = noLifetime.setup();
    expect(counted(noLifetime, "apipilot_token_refresh")).toEqual([{ setup_step: "s1", outcome: "no-lifetime" }]);
    noLifetime.clock.now += 10_000_000;
    noLifetime.iterate(plain, 0);
    expect(noLifetime.requests.filter((r) => r.tags.apipilot_kind === "token-refresh")).toEqual([]);
  });
});

describe("chain runtime: checks (US3; FR-016, FR-017)", () => {
  function checked(checks: ChainStep["checks"], response: SandboxResponse, extra: Partial<ChainStep> = {}) {
    const plan = planOf([step({ id: "s1", checks, ...extra }), step({ id: "s2", url: "{{baseUrl}}/after" })]);
    const sandbox = loadChainPlan(plan, { values: VALUES, respond: (request) => (request.url.endsWith("/after") ? { status: 200 } : response) });
    sandbox.iterate(NO_SETUP, 0);
    return sandbox;
  }

  it("evaluates each kind of check against the response, counting passed and failed", () => {
    const sandbox = checked(
      [
        { id: "k1", kind: "field-exists", path: "data.note" },
        { id: "k2", kind: "field-exists", path: "data.missing" },
        { id: "k3", kind: "field-equals", path: "data.count", expected: { type: "number", value: 3 } },
        { id: "k4", kind: "field-equals", path: "data.count", expected: { type: "text", value: "3" } },
        { id: "k5", kind: "field-equals", path: "data.active", expected: { type: "boolean", value: true } },
        { id: "k6", kind: "field-equals", path: "data.count", expected: { type: "boolean", value: true } },
        { id: "k7", kind: "body-contains", text: '"status":"ACTIVE"' },
        { id: "k8", kind: "time-at-most", maxMs: 500 },
        { id: "k9", kind: "time-at-most", maxMs: 100 },
      ],
      { status: 200, body: { data: { note: null, count: 3, active: true }, status: "ACTIVE" }, durationMs: 250 },
    );
    expect(counted(sandbox, "apipilot_check").map((tags) => [tags.check, tags.outcome])).toEqual([
      ["k1", "passed"],
      ["k2", "failed"],
      ["k3", "passed"],
      ["k4", "passed"],
      ["k5", "passed"],
      ["k6", "failed"],
      ["k7", "passed"],
      ["k8", "passed"],
      ["k9", "failed"],
    ]);
    expect(counted(sandbox, "apipilot_check")[0]).toEqual({ check: "k1", outcome: "passed", step: "s1", journey: "c1" });
  });

  it("compares a field with an extracted value, and keeps extracting and sending after a failed check", () => {
    const plan = planOf([
      step({ id: "s1", extractors: [bodyExtractor("x1", "customer_id", "id")] }),
      step({ id: "s2", url: "{{baseUrl}}/c/{{customer_id}}", checks: [{ id: "k1", kind: "field-equals", path: "id", expected: { type: "text", value: "{{customer_id}}" } }], extractors: [bodyExtractor("x2", "name", "name")] }),
      step({ id: "s3", url: "{{baseUrl}}/n/{{name}}" }),
    ]);
    const sandbox = loadChainPlan(plan, { values: VALUES, respond: (request) => (request.url.includes("/c/") ? { status: 200, body: { id: "other", name: "Ada" } } : { status: 200, body: { id: "c-1" } }) });
    sandbox.iterate(NO_SETUP, 0);
    expect(counted(sandbox, "apipilot_check")).toEqual([{ check: "k1", outcome: "failed", step: "s2", journey: "c1" }]);
    expect(sandbox.requests.map((request) => request.url.slice(BASE.length))).toEqual(["/health", "/c/c-1", "/n/Ada"]);
    expect(counted(sandbox, "apipilot_cut_short")).toEqual([]);
  });

  it("fails JSON checks on a body that is not JSON, while body-contains and time checks still apply", () => {
    const sandbox = checked(
      [
        { id: "k1", kind: "field-exists", path: "id" },
        { id: "k2", kind: "body-contains", text: "Service" },
        { id: "k3", kind: "time-at-most", maxMs: 1000 },
      ],
      { status: 200, body: "Service Unavailable page", durationMs: 10 },
    );
    expect(counted(sandbox, "apipilot_check").map((tags) => tags.outcome)).toEqual(["failed", "passed", "passed"]);
  });

  it("reads the body only when a step extracts or checks it", () => {
    const timeOnly = checked([{ id: "k1", kind: "time-at-most", maxMs: 1000 }], { status: 200, durationMs: 1 });
    expect(timeOnly.requests[0].responseType).toBe("none");
    const contains = checked([{ id: "k1", kind: "body-contains", text: "x" }], { status: 200, body: "x" });
    expect(contains.requests[0].responseType).toBe("text");
  });
});

describe("chain runtime: data sets (US6; FR-013, FR-043)", () => {
  const ROWS = JSON.stringify([
    ["t-1", "Ada"],
    ["t-2", "Grace"],
    ["t-3", "Linus"],
  ]);
  const FILES = { "./apipilot-data-0.json": ROWS };

  function dataPlan(mode: "row-per-virtual-user" | "row-per-iteration", steps: ChainStep[]): ChainPlan {
    return chainPlan({
      thinkTimeMs: 0,
      chains: [chain("c1", "A", steps)],
      dataSets: [{ id: "d1", name: "customers", mode, columns: [{ name: "tenant_id", secret: false }, { name: "first_name", secret: true }], rowCount: 3, sizeBytes: 1, sha256: "a" }],
    });
  }

  it("takes the next row per iteration across virtual users, in file order, wrapping and counting the wrap", () => {
    const iterations = { next: 0 };
    const plan = dataPlan("row-per-iteration", [step({ id: "s1", url: "{{baseUrl}}/t/{{tenant_id}}", headers: [{ name: "X-Name", value: "{{first_name}}" }] })]);
    const users = [1, 2].map((vu) => loadChainPlan(plan, { values: VALUES, respond: () => ({ status: 200 }), vu, files: FILES, iterations }));
    for (let iteration = 0; iteration < 2; iteration += 1) for (const user of users) user.iterate(NO_SETUP, iteration);
    const sent = [users[0].requests[0], users[1].requests[0], users[0].requests[1], users[1].requests[1]].map((request) => request.url.slice(BASE.length));
    expect(sent).toEqual(["/t/t-1", "/t/t-2", "/t/t-3", "/t/t-1"]);
    expect([...counted(users[0], "apipilot_data"), ...counted(users[1], "apipilot_data")].map((tags) => tags.outcome).sort()).toEqual(["take", "take", "take", "wrap"]);
    expect(users[0].opened).toEqual(["./apipilot-data-0.json"]);
  });

  it("gives each virtual user one row, kept for its whole run", () => {
    const plan = dataPlan("row-per-virtual-user", [step({ id: "s1", url: "{{baseUrl}}/t/{{tenant_id}}" })]);
    const user = loadChainPlan(plan, { values: VALUES, respond: () => ({ status: 200 }), vu: 2, files: FILES });
    user.iterate(NO_SETUP, 0);
    user.iterate(NO_SETUP, 1);
    expect(user.requests.map((request) => request.url.slice(BASE.length))).toEqual(["/t/t-2", "/t/t-2"]);
    expect(counted(user, "apipilot_data")).toEqual([{ dataset: "0", outcome: "take" }]);
  });

  it("uses the first row in a Once before load step and counts that use, and resolves an extracted value before a column", () => {
    const plan = dataPlan("row-per-iteration", [
      step({ id: "s1", runs: "once-before-load", url: "{{baseUrl}}/login/{{tenant_id}}", extractors: [bodyExtractor("x1", "token", "token")] }),
      step({ id: "s2", extractors: [bodyExtractor("x2", "first_name", "name")] }),
      step({ id: "s3", url: "{{baseUrl}}/hello/{{first_name}}" }),
    ]);
    const sandbox = loadChainPlan(plan, { values: VALUES, respond: (request) => (request.url.includes("/login/") ? { status: 200, body: { token: "tok" } } : { status: 200, body: { name: "Extracted" } }), files: FILES });
    const data = sandbox.setup();
    expect(sandbox.requests[0].url).toBe(`${BASE}/login/t-1`);
    expect(counted(sandbox, "apipilot_data")).toEqual([{ dataset: "0", outcome: "setup" }]);
    sandbox.iterate(data, 0);
    expect(sandbox.requests.at(-1)?.url).toBe(`${BASE}/hello/Extracted`);
  });

  it("sends an empty cell as empty text, not as missing", () => {
    const plan = dataPlan("row-per-iteration", [step({ id: "s1", url: "{{baseUrl}}/t/{{tenant_id}}x" })]);
    const sandbox = loadChainPlan(plan, { values: VALUES, respond: () => ({ status: 200 }), files: { "./apipilot-data-0.json": JSON.stringify([["", "Ada"]]) } });
    sandbox.iterate(NO_SETUP, 0);
    expect(sandbox.requests[0].url).toBe(`${BASE}/t/x`);
    expect(counted(sandbox, "apipilot_missing_data")).toEqual([]);
  });
});
