import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CollectionFolderView, CollectionRequestView, CollectionView } from "@apipilot/shared-domain";
import {
  MoveItemDialog,
  buildMoveDestinations,
  describeMoveResult,
  describeMoveScripts,
} from "../../src/components/MoveItemDialog";

function request(id: string, name: string, copiedScriptFolderIds: string[] = []): CollectionRequestView {
  return {
    id,
    name,
    wasEdited: false,
    raw: { method: "GET", url: "https://example.test", headers: [] },
    resolved: { method: "GET", url: "https://example.test", headers: [] },
    unresolvedVariables: [],
    variableReferences: [],
    copiedScriptFolderIds,
  };
}

function folder(id: string, name: string, overrides: Partial<CollectionFolderView> = {}): CollectionFolderView {
  return { id, name, items: [], folders: [], scriptEvents: [], copiedScriptFolderIds: [], ...overrides };
}

/** Root: "Health" request; "Orders" (pre-request script) > "Get order", and "Orders / Archive"; "Payments" (test script). */
function view(getOrderCopies: string[] = []): CollectionView {
  return {
    id: "uc-1",
    items: [request("health", "Health")],
    folders: [
      folder("orders", "Orders", {
        scriptEvents: ["prerequest"],
        items: [request("get-order", "Get order", getOrderCopies)],
        folders: [folder("archive", "Archive")],
      }),
      folder("payments", "Payments", { scriptEvents: ["test"] }),
    ],
    variables: [],
  };
}

describe("buildMoveDestinations (FR-015a)", () => {
  it("offers the root and every folder by path, except the item's current container", () => {
    expect(buildMoveDestinations(view(), "get-order").map((destination) => destination.label)).toEqual([
      "Collection root",
      "Orders / Archive",
      "Payments",
    ]);
  });

  it("never offers a folder itself or anything inside it as a destination for that folder", () => {
    expect(buildMoveDestinations(view(), "orders").map((destination) => destination.containerId)).toEqual(["payments"]);
  });
});

describe("describeMoveScripts (FR-015b)", () => {
  it("lists the scripts of folders on the new path that will also run, but not folders the item is already inside", () => {
    const destinations = buildMoveDestinations(view(), "get-order");
    const payments = destinations.find((destination) => destination.containerId === "payments")!;
    const archive = destinations.find((destination) => destination.containerId === "archive")!;
    expect(describeMoveScripts(view(), "get-order", payments).alsoRuns).toEqual(["Payments (test)"]);
    expect(describeMoveScripts(view(), "get-order", archive).alsoRuns).toEqual([]);
  });

  it("warns when the item already carries a copy of a folder's scripts on the new path", () => {
    const health = buildMoveDestinations(view(), "health").find((destination) => destination.containerId === "orders")!;
    const withCopy: CollectionView = { ...view(), items: [request("health", "Health", ["orders"])] };
    expect(describeMoveScripts(withCopy, "health", health).runsTwice).toEqual(["Orders"]);
  });
});

describe("describeMoveResult", () => {
  it("says what was copied, including the Tests tab caveat when test scripts were copied", () => {
    expect(
      describeMoveResult("Get order", {
        auth: { type: "bearer", fromFolderName: "Orders" },
        scriptsFromFolders: [{ id: "orders", name: "Orders", events: ["prerequest", "test"] }],
      }),
    ).toBe(
      "Moved “Get order” and marked it edited. Copied into it: its bearer auth from folder “Orders”; the pre-request and test scripts of folder “Orders”. Saving its Tests tab merges copied test scripts with its own, so two scripts declaring the same variable name can then conflict.",
    );
    expect(describeMoveResult("Health", { auth: null, scriptsFromFolders: [] })).toBe(
      "Moved “Health”. Nothing needed copying: it keeps the same auth and scripts.",
    );
  });
});

describe("MoveItemDialog", () => {
  it("enables Move only once a destination is chosen, shows its scripts, and confirms with its id", () => {
    const onConfirm = vi.fn();
    render(<MoveItemDialog view={view()} itemId="get-order" onConfirm={onConfirm} onCancel={vi.fn()} />);

    expect(screen.getByText("Move “Get order” to…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Payments" }));
    expect(screen.getByText(/scripts of Payments \(test\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(onConfirm).toHaveBeenCalledWith("payments");
  });

  it("shows the run-twice warning as an alert, in text", () => {
    const withCopy: CollectionView = { ...view(), items: [request("health", "Health", ["orders"])] };
    render(<MoveItemDialog view={withCopy} itemId="health" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Orders" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Warning: it already carries a copy of the scripts of Orders. They would run twice.");
  });
});
