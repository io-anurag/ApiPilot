import { useState } from "react";
import { EntryFeatureIcon } from "../components/EntryFeatureIcon";

type EndpointState = "ready" | "attention" | "removed";

type MockEndpoint = {
  readonly id: string;
  readonly group: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly scenario: string;
  readonly expected: string;
  readonly auth: string;
  readonly state: EndpointState;
  readonly detail: string;
};

const ENDPOINTS: readonly MockEndpoint[] = [
  {
    id: "orders-list",
    group: "Orders",
    method: "GET",
    path: "/orders",
    scenario: "List orders",
    expected: "200",
    auth: "Bearer token",
    state: "ready",
    detail: "Lists orders using the generated page-size query value.",
  },
  {
    id: "orders-create",
    group: "Orders",
    method: "POST",
    path: "/orders",
    scenario: "Create an order",
    expected: "201",
    auth: "Bearer token",
    state: "ready",
    detail:
      "Creates a new order on every iteration. Records are not cleaned up after a run.",
  },
  {
    id: "orders-get",
    group: "Orders",
    method: "GET",
    path: "/orders/{orderId}",
    scenario: "Get an order",
    expected: "200",
    auth: "Bearer token",
    state: "attention",
    detail:
      "Requires an environment value for orderId because this quick plan does not chain requests.",
  },
  {
    id: "orders-update",
    group: "Orders",
    method: "PATCH",
    path: "/orders/{orderId}",
    scenario: "Update an order",
    expected: "200",
    auth: "Bearer token",
    state: "ready",
    detail:
      "Updates the generated order payload. The orderId must be supplied by the target environment.",
  },
  {
    id: "orders-cancel",
    group: "Orders",
    method: "DELETE",
    path: "/orders/{orderId}",
    scenario: "Cancel an order",
    expected: "204",
    auth: "Bearer token",
    state: "removed",
    detail: "Removed from the plan because it deletes records on the target environment.",
  },
  {
    id: "catalog-list",
    group: "Catalog",
    method: "GET",
    path: "/products",
    scenario: "List products",
    expected: "200",
    auth: "No auth",
    state: "ready",
    detail: "Lists the public product catalog with generated pagination values.",
  },
  {
    id: "catalog-get",
    group: "Catalog",
    method: "GET",
    path: "/products/{productId}",
    scenario: "Get a product",
    expected: "200",
    auth: "No auth",
    state: "ready",
    detail: "Uses a productId supplied by the target environment.",
  },
  {
    id: "customers-list",
    group: "Customers",
    method: "GET",
    path: "/customers",
    scenario: "List customers",
    expected: "200",
    auth: "OAuth2",
    state: "ready",
    detail: "Lists customers with the OAuth2 client-credentials token.",
  },
  {
    id: "customers-create",
    group: "Customers",
    method: "POST",
    path: "/customers",
    scenario: "Create a customer",
    expected: "201",
    auth: "OAuth2",
    state: "ready",
    detail: "Creates a customer on every iteration. Use an isolated environment.",
  },
  {
    id: "reports-export",
    group: "Reports",
    method: "POST",
    path: "/reports/export",
    scenario: "Create export",
    expected: "202",
    auth: "Bearer token",
    state: "attention",
    detail:
      "The specification has no documented completion status. Choose an expected success status before generating the script.",
  },
];

const METHOD_CLASSES: Record<MockEndpoint["method"], string> = {
  GET: "bg-info-50 text-info-700 dark:bg-info-500/15 dark:text-info-100",
  POST: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-100",
  PUT: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100",
  PATCH: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100",
  DELETE: "bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-100",
};

const STATE_LABELS: Record<EndpointState, string> = {
  ready: "Ready",
  attention: "Needs input",
  removed: "Removed",
};

export function PerformancePlanScaleMockPage() {
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<MockEndpoint["method"] | "ALL">("ALL");
  const [state, setState] = useState<EndpointState | "all">("all");
  const [selectedId, setSelectedId] = useState("orders-create");
  const [profile, setProfile] = useState("Load");
  const [environment, setEnvironment] = useState("QA sandbox");
  const selected =
    ENDPOINTS.find((endpoint) => endpoint.id === selectedId) ?? ENDPOINTS[0];
  const visible = ENDPOINTS.filter(
    (endpoint) =>
      (method === "ALL" || endpoint.method === method) &&
      (state === "all" || endpoint.state === state) &&
      `${endpoint.method} ${endpoint.path} ${endpoint.scenario}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const visibleGroups = [...new Set(visible.map((endpoint) => endpoint.group))];

  return (
    <div className="space-y-5" data-testid="performance-plan-scale-mock">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div className="space-y-1">
          <p className="font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
            Layout study · endpoint scale
          </p>
          <h1 className="font-display text-3xl font-semibold text-slate-950 dark:text-white">
            Performance plan inventory
          </h1>
          <p className="max-w-3xl text-sm text-muted">
            A compact review surface for a plan with 87 endpoints. Select a row to inspect
            its request instead of expanding every endpoint at once.
          </p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 dark:bg-slate-500/15 dark:text-slate-100">
            87 endpoints
          </span>
          <span className="rounded-full bg-warning-50 px-3 py-1 text-sm text-warning-700 dark:bg-warning-500/15 dark:text-warning-100">
            13 write operations
          </span>
        </div>
      </header>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3">
            <label className="min-w-52 flex-1">
              <span className="sr-only">Search endpoints</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search method, path, or scenario"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
            </label>
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label="Filter by method"
            >
              {(["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"] as const).map(
                (candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => setMethod(candidate)}
                    className={`rounded px-2 py-1 text-xs font-medium ${method === candidate ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-brand-50 dark:bg-slate-500/15 dark:text-slate-100"}`}
                  >
                    {candidate}
                  </button>
                ),
              )}
            </div>
            <select
              aria-label="Filter endpoint state"
              value={state}
              onChange={(event) => setState(event.target.value as EndpointState | "all")}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <option value="all">All states</option>
              <option value="ready">Ready</option>
              <option value="attention">Needs input</option>
              <option value="removed">Removed</option>
            </select>
          </div>

          <section
            className="overflow-hidden rounded-lg border border-border bg-surface"
            aria-labelledby="mock-endpoints-title"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 id="mock-endpoints-title" className="text-base font-semibold">
                  Endpoints in plan
                </h2>
                <p className="text-xs text-muted">
                  Showing {visible.length} representative rows of 87 endpoints
                </p>
              </div>
              <button
                type="button"
                className="text-sm font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300"
              >
                Remove selected
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-180 border-collapse text-left text-sm">
                <thead className="bg-chrome text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Endpoint</th>
                    <th className="px-3 py-2 font-semibold">Scenario</th>
                    <th className="px-3 py-2 font-semibold">Expected</th>
                    <th className="px-3 py-2 font-semibold">Auth</th>
                    <th className="px-4 py-2 font-semibold">State</th>
                  </tr>
                </thead>
                {visibleGroups.map((group) => (
                  <tbody key={group}>
                    <tr className="border-y border-border bg-slate-50/70 dark:bg-white/5">
                      <th
                        colSpan={5}
                        className="px-4 py-2 font-mono text-xs font-semibold uppercase text-muted"
                      >
                        {group}
                      </th>
                    </tr>
                    {visible
                      .filter((endpoint) => endpoint.group === group)
                      .map((endpoint) => (
                        <tr
                          key={endpoint.id}
                          onClick={() => setSelectedId(endpoint.id)}
                          className={`cursor-pointer border-b border-border last:border-0 ${selectedId === endpoint.id ? "bg-brand-50/70 dark:bg-brand-500/10" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${METHOD_CLASSES[endpoint.method]}`}
                              >
                                {endpoint.method}
                              </span>
                              <span className="font-mono text-xs text-slate-800 dark:text-slate-200">
                                {endpoint.path}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-xs">{endpoint.scenario}</td>
                          <td className="px-3 py-3 font-mono text-xs">
                            {endpoint.expected}
                          </td>
                          <td className="px-3 py-3 text-xs text-muted">
                            {endpoint.auth}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-xs font-medium ${endpoint.state === "attention" ? "text-warning-700 dark:text-warning-100" : endpoint.state === "removed" ? "text-danger-700 dark:text-danger-100" : "text-success-700 dark:text-success-100"}`}
                            >
                              {STATE_LABELS[endpoint.state]}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                ))}
              </table>
            </div>
            {visible.length === 0 && (
              <p className="p-6 text-sm text-muted">No endpoints match these filters.</p>
            )}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center gap-2">
              <EntryFeatureIcon name="visible" />
              <h2 className="font-semibold">Selected endpoint</h2>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${METHOD_CLASSES[selected.method]}`}
              >
                {selected.method}
              </span>
              <code className="text-xs">{selected.path}</code>
            </div>
            <p className="text-sm text-muted">{selected.detail}</p>
            <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
              <div>
                <dt className="text-muted">Scenario</dt>
                <dd className="mt-1 font-medium">{selected.scenario}</dd>
              </div>
              <div>
                <dt className="text-muted">Expected</dt>
                <dd className="mt-1 font-mono font-medium">{selected.expected}</dd>
              </div>
              <div>
                <dt className="text-muted">Authentication</dt>
                <dd className="mt-1 font-medium">{selected.auth}</dd>
              </div>
              <div>
                <dt className="text-muted">Plan state</dt>
                <dd className="mt-1 font-medium">{STATE_LABELS[selected.state]}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-white/5"
            >
              Inspect generated request
            </button>
          </section>
          <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Load profile</h2>
              <button
                type="button"
                className="text-xs font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300"
              >
                Configure
              </button>
            </div>
            <div
              className="grid grid-cols-3 gap-1"
              role="group"
              aria-label="Load profile"
            >
              {["Smoke", "Load", "Soak"].map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setProfile(candidate)}
                  className={`rounded px-2 py-1.5 text-xs font-medium ${profile === candidate ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-brand-50 dark:bg-slate-500/15 dark:text-slate-100"}`}
                >
                  {candidate}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded bg-slate-50 p-2 dark:bg-white/5">
                <strong className="block text-sm">10</strong>
                <span className="text-muted">VUs</span>
              </div>
              <div className="rounded bg-slate-50 p-2 dark:bg-white/5">
                <strong className="block text-sm">5 min</strong>
                <span className="text-muted">duration</span>
              </div>
              <div className="rounded bg-slate-50 p-2 dark:bg-white/5">
                <strong className="block text-sm">1 s</strong>
                <span className="text-muted">think time</span>
              </div>
            </div>
            <p className="border-t border-border pt-3 text-xs text-muted">
              Thresholds: p95 &lt; 500 ms · error rate &lt; 1%
            </p>
          </section>
          <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Target environment</h2>
              <button
                type="button"
                className="text-xs font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300"
              >
                Manage
              </button>
            </div>
            <select
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              aria-label="Target environment"
              className="w-full rounded-md border border-border bg-surface px-2 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <option>QA sandbox</option>
              <option>Staging</option>
              <option>Local</option>
            </select>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Required values</span>
              <span className="font-medium text-warning-700 dark:text-warning-100">
                2 of 3 complete
              </span>
            </div>
            <ul className="space-y-1 text-xs">
              <li className="flex justify-between">
                <code>baseUrl</code>
                <span className="text-success-700 dark:text-success-100">present</span>
              </li>
              <li className="flex justify-between">
                <code>orderId</code>
                <span className="text-success-700 dark:text-success-100">present</span>
              </li>
              <li className="flex justify-between">
                <code>exportType</code>
                <span className="text-warning-700 dark:text-warning-100">missing</span>
              </li>
            </ul>
          </section>
          <section className="space-y-3 rounded-lg border border-warning-300 bg-warning-50 p-4 dark:border-warning-500 dark:bg-warning-500/10">
            <div className="flex items-center gap-2">
              <EntryFeatureIcon name="control" />
              <h2 className="font-semibold text-warning-700 dark:text-warning-100">
                Run safety
              </h2>
            </div>
            <p className="text-sm text-warning-700 dark:text-warning-100">
              13 write operations will run for every virtual user on every iteration.
              Records are not cleaned up.
            </p>
            <button
              type="button"
              className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Review write operations
            </button>
          </section>
          <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">k6 script and run</h2>
              <span className="text-xs font-medium text-warning-700 dark:text-warning-100">
                Blocked
              </span>
            </div>
            <p className="text-sm text-muted">
              2 endpoints need an expected status and 1 environment value is missing.
            </p>
            <button
              type="button"
              disabled
              className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white opacity-50"
            >
              Generate script
            </button>
            <button
              type="button"
              disabled
              className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium opacity-50"
            >
              Run against {environment}
            </button>
          </section>
        </aside>
      </section>
    </div>
  );
}
