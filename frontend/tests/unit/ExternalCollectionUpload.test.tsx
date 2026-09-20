import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExternalCollectionUpload } from "../../src/components/ExternalCollectionUpload";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: unknown, ok = true, status = 201) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, json: () => Promise.resolve(response) })),
  );
}

describe("ExternalCollectionUpload", () => {
  it("submits name, tier, and both files, then reports the created uploadedCollection", async () => {
    const created = { id: "uc-1", name: "My collection", tier: "local", requestDelayMs: 0, createdAt: "2026-01-01" };
    stubFetch({ uploadedCollection: created });
    const onUploaded = vi.fn();

    render(<ExternalCollectionUpload onUploaded={onUploaded} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My collection" } });
    fireEvent.change(screen.getByLabelText("Collection (.json)"), {
      target: { files: [new File(["{}"], "collection.json", { type: "application/json" })] },
    });
    fireEvent.change(screen.getByLabelText("Environment (.json)"), {
      target: { files: [new File(["{}"], "environment.json", { type: "application/json" })] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Upload collection" }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(created));
    expect(fetch).toHaveBeenCalledWith("/api/external-collections", expect.objectContaining({ method: "POST" }));
  });

  it("disables submit until a name and both files are present", () => {
    render(<ExternalCollectionUpload onUploaded={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Upload collection" })).toBeDisabled();
  });

  it("shows the server's error message when the upload is refused", async () => {
    stubFetch({ error: "invalid_collection", message: "the file is not valid JSON." }, false, 400);
    render(<ExternalCollectionUpload onUploaded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bad" } });
    fireEvent.change(screen.getByLabelText("Collection (.json)"), {
      target: { files: [new File(["not json"], "collection.json")] },
    });
    fireEvent.change(screen.getByLabelText("Environment (.json)"), {
      target: { files: [new File(["{}"], "environment.json")] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Upload collection" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("the file is not valid JSON."));
  });
});
