import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  return { onAddRequest: vi.fn(), onAddFolder: vi.fn(), onDeleteItem: vi.fn(), onRenameItem: vi.fn(), onMoveItem: vi.fn() };
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

  it("add/delete/rename/move controls call the corresponding action, via each row's own actions menu", () => {
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

    screen.getByRole("button", { name: "+ Add folder" }).click();
    expect(treeActions.onAddFolder).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: "Actions for Get widget" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(treeActions.onDeleteItem).toHaveBeenCalledWith("item-1");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Get widget" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(treeActions.onRenameItem).toHaveBeenCalledWith("item-1", "Get widget");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Second" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(treeActions.onMoveItem).toHaveBeenCalledWith("root", "item-2", "up");
  });

  it("a folder's own actions menu can add a nested request or folder inside it", () => {
    const treeActions = actions();
    render(
      <CollectionTreeView
        items={[]}
        folders={[folder()]}
        onSelectRequest={vi.fn()}
        locked={false}
        actions={treeActions}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for Widgets" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add request here" }));
    expect(treeActions.onAddRequest).toHaveBeenCalledWith("folder-1");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Widgets" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add folder here" }));
    expect(treeActions.onAddFolder).toHaveBeenCalledWith("folder-1");
  });

  it("the actions menu closes after selecting an item", () => {
    render(
      <CollectionTreeView
        items={[request()]}
        folders={[]}
        onSelectRequest={vi.fn()}
        locked={false}
        actions={actions()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions for Get widget" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Actions for Get widget" })).toBeDisabled();
    expect(screen.getByText("This collection is read-only while a run is in progress.")).toBeInTheDocument();
  });

  it("truncates a long request/folder name instead of pushing the actions menu out of the row", () => {
    const longName = "POST /booking — invalid-format-with-a-very-long-descriptive-scenario-name (2)";
    render(
      <CollectionTreeView
        items={[request({ name: longName })]}
        folders={[folder({ name: "A very long folder name that would otherwise overflow the sidebar" })]}
        onSelectRequest={vi.fn()}
        locked={false}
        actions={actions()}
      />,
    );
    const requestNameSpan = screen.getByText(longName);
    expect(requestNameSpan).toHaveClass("truncate", "min-w-0");
    // The row's flex-1 name button must be allowed to shrink (min-w-0) so the fixed-size actions
    // menu never gets pushed past the row/card boundary by a long, unwrapped name.
    expect(requestNameSpan.closest("button")).toHaveClass("min-w-0");
    expect(screen.getByRole("button", { name: `Actions for ${longName}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for A very long folder name that would otherwise overflow the sidebar" })).toBeInTheDocument();
  });

  it("renders headerAction alongside + Add request in the same header row", () => {
    render(
      <CollectionTreeView
        items={[request()]}
        folders={[]}
        onSelectRequest={vi.fn()}
        locked={false}
        actions={actions()}
        headerAction={<button type="button">Variables</button>}
      />,
    );
    const variablesButton = screen.getByRole("button", { name: "Variables" });
    const addRequestButton = screen.getByRole("button", { name: "+ Add request" });
    expect(variablesButton.parentElement).toBe(addRequestButton.parentElement);
  });
});
