import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { analyzeChainPlan, type ChainPlan, type DataSetInfo } from "@apipilot/shared-domain";
import { DataSetsPanel } from "../../src/components/requestChain/DataSetsPanel";
import { lifecyclePlan, PLAN_ID, viewOf } from "./requestChainFixtures";

/** AP-037 (specs/037-request-chain-performance tasks T081; US6, FR-041 to FR-045). */

afterEach(() => vi.unstubAllGlobals());

const BASE = `/api/chain-plans/${PLAN_ID}/data-sets`;
const CUSTOMERS: DataSetInfo = {
  id: "d1",
  name: "customers",
  mode: "row-per-iteration",
  columns: [
    { name: "first_name", secret: false },
    { name: "password", secret: false },
  ],
  rowCount: 50,
  sizeBytes: 100,
  sha256: "a".repeat(64),
};

function planWithData(): ChainPlan {
  const plan = lifecyclePlan({ dataSets: [CUSTOMERS] });
  plan.chains[0].steps[1] = { ...plan.chains[0].steps[1], body: { kind: "raw", contentType: "application/json", text: '{"name":"{{first_name}}"}' } };
  return plan;
}

function stub(routes: Record<string, (init: RequestInit) => [number, unknown]>) {
  const calls: { key: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const key = `${init.method ?? "GET"} ${String(input)}`;
      calls.push({ key, init });
      const [status, body] = routes[key]?.(init) ?? [404, { error: "not_found", message: key }];
      return { ok: status < 300, status, json: () => Promise.resolve(body) } as Response;
    }),
  );
  return calls;
}

function renderPanel(plan: ChainPlan, onPlanChanged = vi.fn()) {
  render(<DataSetsPanel plan={plan} analysis={analyzeChainPlan(plan, { environmentValueNames: null })} onPlanChanged={onPlanChanged} />);
  return onPlanChanged;
}

describe("DataSetsPanel", () => {
  it("shows each data set's columns, row count and the steps that use each column", () => {
    renderPanel(planWithData());
    const section = screen.getByRole("region", { name: "Data set customers" });
    expect(within(section).getByText(/50 rows · 2 columns/)).toBeInTheDocument();
    const firstName = within(section).getByText("{{first_name}}").closest("tr")!;
    expect(within(firstName).getByText("Create a customer")).toBeInTheDocument();
    expect(within(within(section).getByText("{{password}}").closest("tr")!).getByText("No step")).toBeInTheDocument();
  });

  it("uploads a file with a name and mode, and shows a refusal with its reason and line", async () => {
    let attempt = 0;
    const calls = stub({
      [`POST ${BASE}`]: () => {
        attempt += 1;
        return attempt === 1
          ? [422, { error: "data_set_invalid", message: "Line 7: expected 6 fields, found 5.", reason: "field-count", line: 7 }]
          : [201, { dataSet: CUSTOMERS, ...viewOf(planWithData()) }];
      },
    });
    const onPlanChanged = renderPanel(lifecyclePlan());
    fireEvent.change(screen.getByLabelText(/CSV file/), { target: { files: [new File(["a\n1\n"], "customers.csv", { type: "text/csv" })] } });
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "row-per-virtual-user" } });
    fireEvent.click(screen.getByRole("button", { name: "Add data set" }));
    expect(await screen.findByTestId("data-set-error")).toHaveTextContent("Line 7: expected 6 fields, found 5.");
    const form = calls[0].init.body as FormData;
    expect([form.get("name"), form.get("mode")]).toEqual(["customers", "row-per-virtual-user"]);
    fireEvent.click(screen.getByRole("button", { name: "Add data set" }));
    await waitFor(() => expect(onPlanChanged).toHaveBeenCalledTimes(1));
  });

  it("fills the data set name from the chosen file, until the engineer types their own", () => {
    renderPanel(lifecyclePlan());
    const file = (name: string) => ({ target: { files: [new File(["a\n1\n"], name, { type: "text/csv" })] } });
    fireEvent.change(screen.getByLabelText(/CSV file/), file("customers.csv"));
    expect(screen.getByLabelText("Data set name")).toHaveValue("customers");
    fireEvent.change(screen.getByLabelText(/CSV file/), file("orders.CSV"));
    expect(screen.getByLabelText("Data set name")).toHaveValue("orders");
    fireEvent.change(screen.getByLabelText("Data set name"), { target: { value: "my data" } });
    fireEvent.change(screen.getByLabelText(/CSV file/), file("other.csv"));
    expect(screen.getByLabelText("Data set name")).toHaveValue("my data");
  });

  it("marks a column secret and previews the first rows with secret cells hidden", async () => {
    const calls = stub({
      [`PUT ${BASE}/d1`]: (init) => [200, { dataSet: { ...CUSTOMERS, columns: JSON.parse(String(init.body)).columns }, ...viewOf(planWithData()) }],
      [`GET ${BASE}/d1/preview`]: () => [200, { columns: [{ name: "first_name", secret: false }, { name: "password", secret: true }], rows: [["Ada", null]] }],
    });
    renderPanel(planWithData());
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark password secret" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(String(calls[0].init.body)).columns).toEqual([
      { name: "first_name", secret: false },
      { name: "password", secret: true },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Preview first rows" }));
    const preview = await screen.findByTestId("data-set-preview");
    expect(within(preview).getByText("Ada")).toBeInTheDocument();
    expect(within(preview).getByText("hidden")).toBeInTheDocument();
  });

  it("removes a data set after confirmation, saying its values must then come from the environment", async () => {
    stub({ [`DELETE ${BASE}/d1`]: () => [200, viewOf(lifecyclePlan())] });
    const onPlanChanged = renderPanel(planWithData());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = screen.getByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("will need those values from the environment");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove data set (1)" }));
    await waitFor(() => expect(onPlanChanged).toHaveBeenCalled());
  });
});
