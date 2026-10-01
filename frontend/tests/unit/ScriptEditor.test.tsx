import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { UserScript } from "@apipilot/shared-domain";
import { CREDENTIALS_NOTE, HIGHLIGHT_LIMIT_BYTES, LINE_ENDING_NOTE, ScriptEditor } from "../../src/components/userScript/ScriptEditor";
import { UserScriptPage } from "../../src/pages/UserScriptPage";
import { environment, stubFetch } from "./performanceFixtures";

/** AP-034 US3 (FR-010 to FR-012; research R19; tasks T058). */

const BASE = "/api/user-scripts";
const SHA = "ef".repeat(32);
const CONTENT = 'import http from "k6/http";\nexport default function () {\n  http.get(`${__ENV.BASE_URL}/`);\n}\n';

function script(): UserScript {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Smoke",
    sizeBytes: CONTENT.length,
    sha256: SHA,
    confirmed: true,
    lastRun: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    check: { accepted: true, hosts: [], envNames: [{ name: "BASE_URL", mappable: true }], hasDefaultFunction: true },
    confirmation: { sha256: SHA, confirmedAt: "x", hostsStated: [] },
    settings: { mapping: [{ name: "BASE_URL", source: { kind: "base-url" }, foundInScript: true }], removedNames: [], load: { kind: "script" }, thresholds: [] },
  };
}

function routes(extra: Record<string, Parameters<typeof stubFetch>[0][string]> = {}) {
  const current = script();
  return {
    [`GET ${BASE}`]: () => [200, { scripts: [current] }] as [number, unknown],
    [`GET ${BASE}/${current.id}`]: () => [200, { script: current }] as [number, unknown],
    [`GET ${BASE}/${current.id}/content`]: () => [200, CONTENT] as [number, unknown],
    [`GET ${BASE}/${current.id}/values`]: () => [200, { values: [], baseUrl: "x" }] as [number, unknown],
    [`GET ${BASE}/example`]: () => [200, "// example\nexport default function () {}\n"] as [number, unknown],
    [`GET ${BASE}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    [`GET ${BASE}/runs`]: () => [200, { runs: [] }] as [number, unknown],
    "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment()] }] as [number, unknown],
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ScriptEditor", () => {
  it("has one labelled, focusable layer; the overlay and gutter are hidden from assistive technology", () => {
    render(<ScriptEditor value={CONTENT} onChange={() => undefined} problems={[]} label="Script Smoke" />);
    expect(screen.getByRole("textbox", { name: "Script Smoke" })).toBeInTheDocument();
    expect(screen.getByTestId("script-editor-overlay")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("script-editor-gutter")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(CREDENTIALS_NOTE)).toBeInTheDocument();
    expect(screen.getByText(LINE_ENDING_NOTE)).toBeInTheDocument();
  });

  it("marks a line with a problem in the gutter and lists the reason by line", () => {
    render(<ScriptEditor value={CONTENT} onChange={() => undefined} problems={[{ rule: "forbidden-identifier", line: 3, column: 3, message: "Uses `open`." }]} label="Script" />);
    expect(within(screen.getByTestId("script-editor-gutter")).getByText(/^!\s*3$/)).toBeInTheDocument();
    expect(within(screen.getByTestId("script-problems")).getByText("Line 3, column 3:")).toBeInTheDocument();
  });

  it("turns highlighting off above 256 KiB, with a note", () => {
    render(<ScriptEditor value={"x".repeat(HIGHLIGHT_LIMIT_BYTES + 1)} onChange={() => undefined} problems={[]} label="Script" />);
    expect(screen.getByTestId("highlighting-off")).toBeInTheDocument();
    expect(screen.queryByTestId("script-editor-overlay")).not.toBeInTheDocument();
  });

  it("never evaluates the script", () => {
    const evalSpy = vi.spyOn(globalThis, "eval");
    const onChange = vi.fn();
    render(<ScriptEditor value={CONTENT} onChange={onChange} problems={[]} label="Script" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Script" }), { target: { value: `${CONTENT}eval("1");` } });
    expect(onChange).toHaveBeenCalled();
    expect(evalSpy).not.toHaveBeenCalled();
  });
});

describe("editing in the page", () => {
  it("opens a new script on the example, and keeps refused text in the editor with its reasons", async () => {
    stubFetch(routes({ [`POST ${BASE}`]: () => [422, { error: "script_refused", message: "refused", problems: [{ rule: "import-remote", line: 1, column: 15, message: "Imports a module from a URL." }] }] }));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Write a new script" }));
    const textbox = await screen.findByRole("textbox", { name: "New script" });
    await waitFor(() => expect(textbox).toHaveValue("// example\nexport default function () {}\n"));
    fireEvent.change(textbox, { target: { value: 'import x from "https://jslib.k6.io/x.js";' } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Line 1, column 15:")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New script" })).toHaveValue('import x from "https://jslib.k6.io/x.js";');
  });

  it("asks before leaving unsaved changes, and Cancel keeps the text", async () => {
    stubFetch(routes());
    render(<UserScriptPage onExit={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Smoke" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const textbox = await screen.findByRole("textbox", { name: "Script Smoke" });
    fireEvent.change(textbox, { target: { value: `${CONTENT}// changed\n` } });
    fireEvent.click(screen.getByRole("button", { name: "Run setup" }));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(within(dialog).getByText("Discard your unsaved changes to the script?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("textbox", { name: "Script Smoke" })).toHaveValue(`${CONTENT}// changed\n`);
    fireEvent.click(screen.getByRole("button", { name: "Exit Run k6 Script and return to the start screen" }));
    expect(await screen.findByTestId("confirm-dialog")).toBeInTheDocument();
  });

  it("saves from the version shown and reports that it needs confirmation again", async () => {
    const current = script();
    const calls = stubFetch(routes({ [`PUT ${BASE}/${current.id}/content`]: () => [200, { script: { ...current, sha256: "99".repeat(32), confirmed: false, confirmation: null } }] }));
    render(<UserScriptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Smoke" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Script Smoke" }), { target: { value: `${CONTENT}// v2\n` } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Confirm it before the next run/)).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PUT")!.body).toEqual({ content: `${CONTENT}// v2\n`, baseSha256: SHA });
    expect(screen.getAllByText("Needs confirmation").length).toBeGreaterThan(0);
  });
});
