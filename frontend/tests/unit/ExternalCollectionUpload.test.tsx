import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExternalCollectionUpload } from "../../src/components/ExternalCollectionUpload";
import type { ImportPreload } from "../../src/services/importPreload";

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

  describe("workflow link (specs/048)", () => {
    const created = { id: "uc-1", name: "Pets", tier: "local", requestDelayMs: 0, createdAt: "2026-01-01" };

    function preloadWith(workflowId?: string): ImportPreload {
      return {
        token: 1,
        name: "Pets",
        workflowId,
        collectionFile: new File(["{}"], "pets.postman_collection.json", { type: "application/json" }),
        environmentFile: new File(["{}"], "pets.postman_environment.json", { type: "application/json" }),
      };
    }

    function sentWorkflowId(): FormDataEntryValue | null {
      const call = vi.mocked(fetch).mock.calls[0];
      return (call[1]?.body as FormData).get("workflowId");
    }

    async function submit() {
      fireEvent.click(screen.getByRole("button", { name: "Upload collection" }));
      await waitFor(() => expect(fetch).toHaveBeenCalled());
    }

    it("sends the workflow id when both files are the hand-off's own", async () => {
      stubFetch({ uploadedCollection: created });
      render(<ExternalCollectionUpload onUploaded={vi.fn()} preload={preloadWith("wf-1760000000000-1")} />);
      await submit();
      expect(sentWorkflowId()).toBe("wf-1760000000000-1");
    });

    it("sends nothing when the collection file is replaced", async () => {
      stubFetch({ uploadedCollection: created });
      render(<ExternalCollectionUpload onUploaded={vi.fn()} preload={preloadWith("wf-1760000000000-1")} />);
      fireEvent.change(screen.getByLabelText("Collection (.json)"), {
        target: { files: [new File(["{}"], "pets.postman_collection.json", { type: "application/json" })] },
      });
      await submit();
      expect(sentWorkflowId()).toBeNull();
    });

    it("sends nothing when the environment file is replaced", async () => {
      stubFetch({ uploadedCollection: created });
      render(<ExternalCollectionUpload onUploaded={vi.fn()} preload={preloadWith("wf-1760000000000-1")} />);
      fireEvent.change(screen.getByLabelText("Environment (.json)"), {
        target: { files: [new File(["{}"], "pets.postman_environment.json", { type: "application/json" })] },
      });
      await submit();
      expect(sentWorkflowId()).toBeNull();
    });

    it("sends nothing without a hand-off, or for a hand-off with no workflow id", async () => {
      stubFetch({ uploadedCollection: created });
      render(<ExternalCollectionUpload onUploaded={vi.fn()} preload={preloadWith()} />);
      await submit();
      expect(sentWorkflowId()).toBeNull();
    });
  });
});
