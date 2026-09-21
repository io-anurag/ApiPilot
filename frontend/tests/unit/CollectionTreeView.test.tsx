import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CollectionFolderView, CollectionRequestView } from "@apipilot/shared-domain";
import { CollectionTreeView, type CollectionTreeActions } from "../../src/components/CollectionTreeView";

function request(overrides: Partial<CollectionRequestView> = {}): CollectionRequestView {
  return {
    id: "item-1",
    name: "Get widget",
    wasEdited: false,
    raw: { method: "GET", url: "{{baseUrl}}/widgets", headers: [] },
    resolved: { method: "GET", url: "https://api.example.com/widgets", headers: [] },
    unresolvedVariables: [],
    ...overrides,
  };
}

function folder(overrides: Partial<CollectionFolderView> = {}): CollectionFolderView {
  return { id: "folder-1", name: "Widgets", items: [], folders: [], ...overrides };
}

function actions(): CollectionTreeActions {
  return { onAddRequest: vi.fn(), onDeleteItem: vi.fn(), onRenameItem: vi.fn(), onMoveItem: vi.fn() };
}

describe("CollectionTreeView", () => {
  it("renders nested folders and requests matching the collection's own order", () => {
    const nested = folder({
      id: "folder-2",
      name: "Nested",
      items: [request({ id: "item-2", name: "Deep request" })],
    });
    render(
      <CollectionTreeView
        items={[request({ id: "item-3", name: "Root request" })]}
        folders={[folder({ items: [request()], folders: [nested] })]}
        onSelectRequest={vi.fn()}
        locked={false}
        actions={actions()}
      />,
    );

    expect(screen.getByText("Widgets")).toBeInTheDocument();
    expect(screen.getByText("Nested")).toBeInTheDocument();
    expect(screen.getByText("Get widget")).toBeInTheDocument();
    expect(screen.getByText("Deep request")).toBeInTheDocument();
    expect(screen.getByText("Root request")).toBeInTheDocument();
  });

  it("selecting a request calls onSelectRequest with that request", () => {
    const onSelectRequest = vi.fn();
    render(
      <CollectionTreeView
        items={[request()]}
        folders={[]}
        onSelectRequest={onSelectRequest}
        locked={false}
        actions={actions()}
      />,
    );
    screen.getByText("Get widget").click();
    expect(onSelectRequest).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }));
  });

  it("add/delete/rename/move controls call the corresponding action", () => {
    const treeActions = actions();
    render(
      <CollectionTreeView
        items={[request(), request({ id: "item-2", name: "Second" })]}
        folders={[]}
        onSelectRequest={vi.fn()}
        locked={false}
        actions={treeActions}
      />,
    );

    screen.getByRole("button", { name: "+ Add request" }).click();
    expect(treeActions.onAddRequest).toHaveBeenCalledWith(null);

    screen.getByRole("button", { name: "Delete Get widget" }).click();
    expect(treeActions.onDeleteItem).toHaveBeenCalledWith("item-1");

    screen.getByRole("button", { name: "Rename Get widget" }).click();
    expect(treeActions.onRenameItem).toHaveBeenCalledWith("item-1", "Get widget");

    screen.getByRole("button", { name: "Move Second up" }).click();
    expect(treeActions.onMoveItem).toHaveBeenCalledWith("root", "item-2", "up");
  });

  it("disables every control while locked", () => {
    render(
      <CollectionTreeView
        items={[request()]}
        folders={[]}
        onSelectRequest={vi.fn()}
        locked
        actions={actions()}
      />,
    );
    expect(screen.getByRole("button", { name: "+ Add request" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Get widget" })).toBeDisabled();
    expect(screen.getByText("This collection is read-only while a run is in progress.")).toBeInTheDocument();
  });
});
