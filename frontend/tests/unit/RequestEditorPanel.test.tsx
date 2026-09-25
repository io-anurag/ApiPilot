import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CollectionRequestView } from "@apipilot/shared-domain";
import { RequestEditorPanel } from "../../src/components/RequestEditorPanel";

function request(overrides: Partial<CollectionRequestView> = {}): CollectionRequestView {
  return {
    id: "item-1",
    name: "Get widget",
    wasEdited: false,
    raw: { method: "GET", url: "{{baseUrl}}/widgets", headers: [{ key: "Authorization", value: "Bearer {{token}}" }] },
    resolved: { method: "GET", url: "https://api.example.com/widgets", headers: [{ key: "Authorization", value: "Bearer {{token}}" }] },
    unresolvedVariables: ["token"],
    variableReferences: [],
    copiedScriptFolderIds: [],
    ...overrides,
  };
}

/** The edit tabs ("Request editor sections") and the resolved-preview tabs ("Resolved preview
 * sections") both include a "Headers"/"Body"/"Tests"-named tab, so tests that need one
 * specifically scope their query to the relevant `tablist` rather than a page-wide `getByRole`. */
function editTabs() {
  return within(screen.getByRole("tablist", { name: "Request editor sections" }));
}

describe("RequestEditorPanel", () => {
  it("pre-fills the raw form from the request and shows the resolved preview", () => {
    render(<RequestEditorPanel request={request()} locked={false} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("URL")).toHaveValue("{{baseUrl}}/widgets");
    expect(screen.getByText("https://api.example.com/widgets")).toBeInTheDocument();
    expect(screen.getByText(/Unresolved: token/)).toBeInTheDocument();
  });

  it("editing the URL and saving calls onSave with the edited fields", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RequestEditorPanel request={request()} locked={false} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "{{baseUrl}}/widgets?limit=10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Save" });
    expect(onSave).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ method: "GET", url: "{{baseUrl}}/widgets?limit=10" }),
    );
  });

  it("disables every editable control while locked", () => {
    render(<RequestEditorPanel request={request()} locked onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("URL")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("calls onClose when the Close button is clicked", () => {
    const onClose = vi.fn();
    render(<RequestEditorPanel request={request()} locked={false} onSave={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "✕ Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("switches between Headers, Body, and Tests sections without losing edits", () => {
    render(<RequestEditorPanel request={request()} locked={false} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(editTabs().getByRole("tab", { name: /Headers/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(editTabs().getByRole("tab", { name: "Body" }));
    fireEvent.change(screen.getByLabelText("Raw body"), { target: { value: "{\"a\": 1}" } });

    fireEvent.click(editTabs().getByRole("tab", { name: /Tests/ }));
    expect(editTabs().getByRole("tab", { name: "Body" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByLabelText("Raw body")).not.toBeInTheDocument();
  });

  it("pre-fills an existing test script and saves an edited one", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <RequestEditorPanel
        request={request({ testScript: 'pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});' })}
        locked={false}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(editTabs().getByRole("tab", { name: /Tests/ }));
    const textarea = screen.getByLabelText(/Test script/) as HTMLTextAreaElement;
    expect(textarea.value).toContain("Status code is 200");

    fireEvent.change(textarea, { target: { value: 'pm.test("Status code is 201", function () {});' } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Save" });
    expect(onSave).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ testScript: 'pm.test("Status code is 201", function () {});' }),
    );
  });

  it("shows no marker on the Tests tab when the request carries no test script", () => {
    render(<RequestEditorPanel request={request()} locked={false} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(editTabs().getByRole("tab", { name: "Tests" })).toBeInTheDocument();
  });

  it("shows a marker on the Tests tab when the request already carries a test script", () => {
    render(<RequestEditorPanel request={request({ testScript: 'pm.test("x", function () {});' })} locked={false} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(editTabs().getByRole("tab", { name: /Has tests/ })).toBeInTheDocument();
  });

  it("tabs the resolved preview into Request/Body/Tests sections", () => {
    render(
      <RequestEditorPanel
        request={request({ resolved: { method: "GET", url: "https://api.example.com/widgets", headers: [], body: '{"a":1}' }, testScript: "pm.test(\"x\", function(){});" })}
        locked={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const previewTabs = within(screen.getByRole("tablist", { name: "Resolved preview sections" }));
    expect(previewTabs.getByRole("tab", { name: "Request" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("https://api.example.com/widgets")).toBeInTheDocument();
    expect(screen.queryByText('{"a":1}')).not.toBeInTheDocument();

    fireEvent.click(previewTabs.getByRole("tab", { name: "Body" }));
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();

    fireEvent.click(previewTabs.getByRole("tab", { name: "Tests" }));
    expect(screen.getByText(/pm\.test/)).toBeInTheDocument();
  });

  it("shows a request's implied auth header as a read-only note, in both the Headers tab and the resolved preview", () => {
    render(
      <RequestEditorPanel
        request={request({
          raw: { method: "GET", url: "{{baseUrl}}/widgets", headers: [] },
          resolved: { method: "GET", url: "https://api.example.com/widgets", headers: [] },
          unresolvedVariables: [],
          variableReferences: [],
          copiedScriptFolderIds: [],
          impliedAuthHeader: { key: "Authorization", rawValue: "Bearer {{token}}", resolvedValue: "Bearer abc123" },
        })}
        locked={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Headers tab: shown as a note, not as an editable row, with the placeholder still visible.
    expect(editTabs().getByRole("tab", { name: "Headers" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Auth adds:")).toBeInTheDocument();
    expect(screen.getByText(/Added by its auth when it runs\./)).toBeInTheDocument();
    // Split across sibling nodes by VariableHighlightedText (a "Bearer " text node plus a
    // separately-highlighted "{{token}}" span), so matched by combined textContent rather than
    // a single node's own text.
    expect(
      screen.getByText((_, element) => element?.textContent === "Bearer {{token}}"),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("header name")).not.toHaveValue("Authorization");

    // Resolved preview: the substituted value, alongside a "(from auth)" marker.
    expect(screen.getByText("Bearer abc123")).toBeInTheDocument();
    expect(screen.getByText("(from auth)")).toBeInTheDocument();
  });
});

describe("RequestEditorPanel — effective auth and used variables (FR-002a, FR-002b)", () => {
  it("shows inherited folder auth with its source and {{variable}} fields, and a hidden secret literal as hidden", () => {
    render(
      <RequestEditorPanel
        request={request({
          auth: {
            type: "bearer",
            source: { kind: "folder", folderId: "orders", folderName: "Orders" },
            fields: [
              { key: "token", value: "{{token}}", hiddenLiteral: false },
              { key: "password", value: "", hiddenLiteral: true },
            ],
          },
        })}
        locked={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(editTabs().getByRole("tab", { name: "Auth" }));
    expect(screen.getByText("Bearer Token")).toBeInTheDocument();
    expect(screen.getByText("Inherited from folder “Orders”.")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("{{token}}")).toBeInTheDocument();
    expect(within(table).getByText("Hidden literal value")).toBeInTheDocument();
  });

  it("says when no auth applies", () => {
    render(<RequestEditorPanel request={request()} locked={false} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(editTabs().getByRole("tab", { name: "Auth" }));
    expect(screen.getByText(/No auth applies/)).toBeInTheDocument();
  });

  it("lists each used variable with where it is used, a text status, and its value source", () => {
    render(
      <RequestEditorPanel
        request={request({
          variableReferences: [
            { name: "baseUrl", usedIn: ["url"], resolved: true, source: "environment" },
            { name: "token", usedIn: ["headers", "auth"], resolved: false },
          ],
        })}
        locked={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(editTabs().getByRole("tab", { name: /Used variables/ }));
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("{{baseUrl}}URLSetEnvironment value");
    expect(rows[2]).toHaveTextContent("{{token}}Headers, AuthMissing—");
  });
});

describe("RequestEditorPanel — the Headers tab auth note", () => {
  it("names where inherited auth comes from, with the {{variable}} highlighted", () => {
    render(
      <RequestEditorPanel
        request={request({
          raw: { method: "GET", url: "{{baseUrl}}/widgets", headers: [] },
          impliedAuthHeader: { key: "Authorization", rawValue: "Bearer {{token}}", resolvedValue: "Bearer abc123" },
          auth: {
            type: "bearer",
            source: { kind: "folder", folderId: "orders", folderName: "Orders" },
            fields: [{ key: "token", value: "{{token}}", hiddenLiteral: false }],
          },
        })}
        locked={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Inherited from folder “Orders”\./)).toBeInTheDocument();
    expect(screen.getAllByText("{{token}}")[0]).toHaveClass("font-mono");
  });
});
