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
    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    await screen.findByRole("button", { name: "Save request" });
    expect(onSave).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ method: "GET", url: "{{baseUrl}}/widgets?limit=10" }),
    );
  });

  it("disables every editable control while locked", () => {
    render(<RequestEditorPanel request={request()} locked onSave={vi.fn()} />);
    expect(screen.getByLabelText("URL")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save request" })).toBeDisabled();
  });
});
