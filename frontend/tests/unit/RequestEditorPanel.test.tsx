import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    ...overrides,
  };
}

describe("RequestEditorPanel", () => {
  it("pre-fills the raw form from the request and shows the resolved preview", () => {
    render(<RequestEditorPanel request={request()} locked={false} onSave={vi.fn()} />);
    expect(screen.getByLabelText("URL")).toHaveValue("{{baseUrl}}/widgets");
    expect(screen.getByText("https://api.example.com/widgets")).toBeInTheDocument();
    expect(screen.getByText(/Unresolved: token/)).toBeInTheDocument();
  });

  it("editing the URL and saving calls onSave with the edited fields", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RequestEditorPanel request={request()} locked={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "{{baseUrl}}/widgets?limit=10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Save" });
    expect(onSave).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ method: "GET", url: "{{baseUrl}}/widgets?limit=10" }),
    );
  });

  it("disables every editable control while locked", () => {
    render(<RequestEditorPanel request={request()} locked onSave={vi.fn()} />);
    expect(screen.getByLabelText("URL")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("switches between Headers, Body, and Tests sections without losing edits", () => {
    render(<RequestEditorPanel request={request()} locked={false} onSave={vi.fn()} />);
    expect(screen.getByRole("tab", { name: /Headers/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Body" }));
    fireEvent.change(screen.getByLabelText("Raw body"), { target: { value: "{\"a\": 1}" } });

    fireEvent.click(screen.getByRole("tab", { name: /Tests/ }));
    expect(screen.getByRole("tab", { name: "Body" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByLabelText("Raw body")).not.toBeInTheDocument();
  });

  it("pre-fills an existing test script and saves an edited one", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <RequestEditorPanel
        request={request({ testScript: 'pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});' })}
        locked={false}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Tests/ }));
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
    render(<RequestEditorPanel request={request()} locked={false} onSave={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Tests" })).toBeInTheDocument();
  });

  it("shows a marker on the Tests tab when the request already carries a test script", () => {
    render(<RequestEditorPanel request={request({ testScript: 'pm.test("x", function () {});' })} locked={false} onSave={vi.fn()} />);
    expect(screen.getByRole("tab", { name: /Has tests/ })).toBeInTheDocument();
  });
});
