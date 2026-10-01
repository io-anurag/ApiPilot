import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MappedValueStatus, UserScript, UserScriptValueMapping } from "@apipilot/shared-domain";
import { ValueMappingEditor } from "../../src/components/userScript/ValueMappingEditor";
import { UserScriptPage } from "../../src/pages/UserScriptPage";
import { environment, stubFetch } from "./performanceFixtures";

/** AP-034 US2 (FR-025 to FR-028; tasks T050). */

const BASE = "/api/user-scripts";
const SHA = "cd".repeat(32);

function script(overrides: Partial<UserScript> = {}): UserScript {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Checkout",
    sizeBytes: 900,
    sha256: SHA,
    confirmed: true,
    lastRun: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    check: { accepted: true, hosts: [], envNames: [{ name: "API_KEY", mappable: true }, { name: "BASE_URL", mappable: true }], hasDefaultFunction: true },
    confirmation: { sha256: SHA, confirmedAt: "x", hostsStated: [] },
    settings: {
      mapping: [
        { name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" }, foundInScript: true },
        { name: "BASE_URL", source: { kind: "base-url" }, foundInScript: true },
        { name: "LEGACY", source: { kind: "environment-value", valueName: "LEGACY" }, foundInScript: false },
      ],
      removedNames: [],
      load: { kind: "script" },
      thresholds: [],
    },
    ...overrides,
  };
}

function routes(current: UserScript, extra: Record<string, Parameters<typeof stubFetch>[0][string]> = {}) {
  return {
    [`GET ${BASE}`]: () => [200, { scripts: [current] }] as [number, unknown],
    [`GET ${BASE}/${current.id}`]: () => [200, { script: current }] as [number, unknown],
    [`GET ${BASE}/${current.id}/content`]: () => [200, "export default function () {}\n"] as [number, unknown],
    [`GET ${BASE}/${current.id}/values`]: () => [200, { values: [{ name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" }, present: false }, { name: "BASE_URL", source: { kind: "base-url" }, present: true }], baseUrl: "http://127.0.0.1:4600" }] as [number, unknown],
    [`GET ${BASE}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    [`GET ${BASE}/runs`]: () => [200, { runs: [] }] as [number, unknown],
    "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment()] }] as [number, unknown],
    ...extra,
  };
}

async function openSetup() {
  fireEvent.click(await screen.findByRole("button", { name: "Checkout" }));
  fireEvent.click(await screen.findByRole("button", { name: "Run setup" }));
}

afterEach(() => vi.unstubAllGlobals());

describe("ValueMappingEditor", () => {
  const mapping: UserScriptValueMapping[] = script().settings.mapping;
  const statuses: MappedValueStatus[] = [{ name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" }, present: false }];

  it("lists sources, not-found names, presence and 'value hidden', never a value", () => {
    render(<ValueMappingEditor mapping={mapping} removedNames={[]} statuses={statuses} environmentValueNames={["API_KEY"]} busy={false} onSave={() => undefined} />);
    const editor = screen.getByTestId("value-mapping-editor");
    expect(within(editor).getByText("Missing")).toBeInTheDocument();
    expect(within(editor).getByText("Not found in the script")).toBeInTheDocument();
    expect(within(editor).getAllByText("Value hidden")).toHaveLength(3);
    expect(within(editor).getByLabelText("Source of BASE_URL")).toHaveValue("base-url");
  });

  it("refuses K6_OUT and PATH with their reasons, and adds a valid name", () => {
    const onSave = vi.fn();
    render(<ValueMappingEditor mapping={mapping} removedNames={[]} statuses={null} environmentValueNames={[]} busy={false} onSave={onSave} />);
    const input = screen.getByLabelText("Add a name the script builds at run time");
    fireEvent.change(input, { target: { value: "K6_OUT" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Names starting with K6_");
    expect(screen.getByRole("button", { name: "+ Add name" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "PATH" } });
    expect(screen.getByRole("alert")).toHaveTextContent("k6 needs this name to start");
    fireEvent.change(input, { target: { value: "TENANT" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add name" }));
    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining([{ name: "TENANT", source: { kind: "environment-value", valueName: "TENANT" } }]), []);
  });

  it("remembers a removed found name so a content change does not add it back", () => {
    const onSave = vi.fn();
    render(<ValueMappingEditor mapping={mapping} removedNames={[]} statuses={null} environmentValueNames={[]} busy={false} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove API_KEY" }));
    expect(onSave).toHaveBeenCalledWith(expect.not.arrayContaining([expect.objectContaining({ name: "API_KEY" })]), ["API_KEY"]);
  });
});

describe("Run setup", () => {
  it("defaults to the script's own load, and offers request-name thresholds", async () => {
    stubFetch(routes(script()));
    render(<UserScriptPage />);
    await openSetup();
    expect(await screen.findByLabelText("The script's own load settings")).toBeChecked();
    const scope = screen.getByLabelText("Applies to");
    expect(within(scope).getByRole("option", { name: "Whole run" })).toBeInTheDocument();
    expect(within(scope).getByRole("option", { name: "A request name…" })).toBeInTheDocument();
  });

  it("disables the profile override, with the reason, for a script with no default function", async () => {
    stubFetch(routes(script({ check: { accepted: true, hosts: [], envNames: [], hasDefaultFunction: false } })));
    render(<UserScriptPage />);
    await openSetup();
    expect(await screen.findByLabelText("A load profile, passed to k6 as --stage options")).toBeDisabled();
    expect(screen.getByText(/has no default function, so a load profile cannot replace its scenarios/)).toBeInTheDocument();
  });

  it("saves a threshold and keeps the script confirmed", async () => {
    const current = script();
    const saved = script({ settings: { ...current.settings, thresholds: [{ id: "t_1", scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 400 }] } });
    const calls = stubFetch(routes(current, { [`PUT ${BASE}/${current.id}/settings`]: () => [200, { script: saved }] }));
    render(<UserScriptPage />);
    await openSetup();
    fireEvent.change(await screen.findByLabelText("At most"), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add threshold" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("/settings"))).toBe(true));
    const body = calls.find((call) => call.method === "PUT")!.body as { thresholds: unknown[] };
    expect(body.thresholds).toEqual([{ scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 400 }]);
    expect(await screen.findByText(/The confirmation is kept/)).toBeInTheDocument();
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
  });
});
