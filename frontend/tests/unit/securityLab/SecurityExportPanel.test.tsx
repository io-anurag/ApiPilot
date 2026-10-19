import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SecurityExportPanel } from "../../../src/components/securityLab/SecurityExportPanel";
import * as postman from "../../../src/services/postmanCollectionsClient";
import * as client from "../../../src/services/securityLabClient";
import { exportReply } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  exportSecurityPostman: vi.fn(),
}));
vi.mock("../../../src/services/postmanCollectionsClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/postmanCollectionsClient")>()),
  downloadArtifact: vi.fn(),
}));

const exportSecurityPostman = vi.mocked(client.exportSecurityPostman);
const downloadArtifact = vi.mocked(postman.downloadArtifact);

const refusal = (error: string, message: string, status: number, details: Record<string, unknown> = {}) => ({ ok: false as const, error, message, status, details });

async function runExport() {
  fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
  return screen.findByTestId("security-export-success");
}

beforeEach(() => {
  exportSecurityPostman.mockReset();
  downloadArtifact.mockReset();
});

describe("SecurityExportPanel (T145, FR-063)", () => {
  it("states that only approved versions are exported and that no secret is written, and exports nothing until asked", () => {
    render(<SecurityExportPanel specificationLoaded />);
    expect(screen.getByRole("heading", { level: 2, name: "Export approved scenarios (Postman)" })).toBeInTheDocument();
    expect(screen.getByText(/Only approved scenario versions are exported\. Credentials are left as empty variables; no secret is written into the files\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export approved scenarios" })).toBeEnabled();
    expect(exportSecurityPostman).not.toHaveBeenCalled();
  });

  describe("without a specification", () => {
    it("disables the export and the address field with the reason, tied to the button, and asks nothing", () => {
      render(<SecurityExportPanel specificationLoaded={false} />);
      const button = screen.getByRole("button", { name: "Export approved scenarios" });
      expect(button).toBeDisabled();
      expect(screen.getByLabelText("Base address (optional)")).toBeDisabled();
      expect(screen.getByTestId("security-export-blocked")).toHaveTextContent("No specification is loaded");
      expect(button).toHaveAccessibleDescription(/Upload one in the Guided Workflow to export\./);
      fireEvent.click(button);
      expect(exportSecurityPostman).not.toHaveBeenCalled();
    });
  });

  describe("a successful export", () => {
    it("reports the validation, the counts and the empty credential variables, and offers the three files by name", async () => {
      exportSecurityPostman.mockResolvedValue({ ok: true, data: exportReply() });
      render(<SecurityExportPanel specificationLoaded />);
      const success = await runExport();
      expect(success).toHaveTextContent("Validation passed: the collection was checked against the expected collection format before delivery.");
      expect(success).toHaveTextContent("4 request(s) in 2 folder(s). Fill in the empty credential variables in Postman after importing; the README lists them.");
      const downloads = within(screen.getByTestId("security-export-downloads")).getAllByRole("button");
      expect(downloads.map((button) => button.textContent)).toEqual([
        "Download collection (security-lab.postman_collection.json)",
        "Download environment (security-lab.postman_environment.json)",
        "Download README (security-lab.README.md)",
      ]);
      expect(screen.getByTestId("export-limitations-none")).toBeInTheDocument();
      expect(screen.queryByTestId("security-export-excluded")).not.toBeInTheDocument();
      expect(exportSecurityPostman).toHaveBeenCalledWith("");
    });

    it("hands each file's exact text to the browser, and writes no credential value into the environment it offers", async () => {
      const reply = exportReply();
      exportSecurityPostman.mockResolvedValue({ ok: true, data: reply });
      render(<SecurityExportPanel specificationLoaded />);
      await runExport();
      fireEvent.click(screen.getByRole("button", { name: /Download environment/ }));
      expect(downloadArtifact).toHaveBeenCalledWith(`${JSON.stringify(reply.environment, null, 2)}\n`, "application/json", "security-lab.postman_environment.json");
      fireEvent.click(screen.getByRole("button", { name: /Download README/ }));
      expect(downloadArtifact).toHaveBeenLastCalledWith(reply.readme, "text/markdown", "security-lab.README.md");
      // The secret variables are present and empty: that is what the README tells the engineer to fill in.
      expect(reply.environment.values.filter((value) => value.type === "secret").every((value) => value.value === "")).toBe(true);
    });

    it("sends the base address the engineer typed", async () => {
      exportSecurityPostman.mockResolvedValue({ ok: true, data: exportReply() });
      render(<SecurityExportPanel specificationLoaded />);
      fireEvent.change(screen.getByLabelText("Base address (optional)"), { target: { value: "https://qa.example.test" } });
      await runExport();
      expect(exportSecurityPostman).toHaveBeenCalledWith("https://qa.example.test");
    });

    it("lists what the collection could not express, under the new security headings, instead of dropping it", async () => {
      exportSecurityPostman.mockResolvedValue({
        ok: true,
        data: exportReply({
          limitations: [
            { kind: "security-repeat-not-expressible", scenarioId: "ss-9", location: "GET /orders", message: "This scenario repeats a request, which the collection cannot represent." },
            { kind: "security-condition-not-expressible", scenarioId: "ss-8", location: "GET /orders", message: "An expected behavior has no assertion template." },
          ],
        }),
      });
      render(<SecurityExportPanel specificationLoaded />);
      await runExport();
      const limitations = screen.getByTestId("export-limitations");
      expect(limitations).toHaveTextContent("Known limitations (2)");
      expect(screen.getByTestId("export-limitation-security-repeat-not-expressible")).toHaveTextContent("Security scenarios that repeat a request");
      expect(screen.getByTestId("export-limitation-security-condition-not-expressible")).toHaveTextContent("no assertion template in this export");
      expect(screen.queryByTestId("export-limitations-none")).not.toBeInTheDocument();
    });

    it("names the approved scenarios that were left out because the specification changed, with why", async () => {
      exportSecurityPostman.mockResolvedValue({
        ok: true,
        data: exportReply({
          excluded: [
            { scenarioId: "ss-5", reason: "stale" },
            { scenarioId: "ss-6", reason: "orphaned" },
          ],
        }),
      });
      render(<SecurityExportPanel specificationLoaded />);
      await runExport();
      const excluded = screen.getByTestId("security-export-excluded");
      expect(excluded).toHaveTextContent("Left out because the specification has changed since they were approved (2).");
      const rows = within(excluded).getAllByRole("listitem");
      expect(rows[0]).toHaveTextContent("ss-5: the specification changed");
      expect(rows[1]).toHaveTextContent("ss-6: its operation is no longer in the specification");
    });

    it("disables the button while exporting and announces it", async () => {
      let resolve!: (value: Awaited<ReturnType<typeof client.exportSecurityPostman>>) => void;
      exportSecurityPostman.mockReturnValue(new Promise((r) => (resolve = r)));
      render(<SecurityExportPanel specificationLoaded />);
      fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
      expect(await screen.findByRole("button", { name: "Exporting..." })).toBeDisabled();
      expect(screen.getByLabelText("Base address (optional)")).toBeDisabled();
      expect(screen.getByText("Building the collection from the approved scenarios.")).toBeInTheDocument();
      resolve({ ok: true, data: exportReply() });
      await waitFor(() => expect(screen.getByRole("button", { name: "Export approved scenarios" })).toBeEnabled());
    });
  });

  describe("a refused export", () => {
    it("shows no approved scenarios as an empty state with the server's message, never as an error", async () => {
      exportSecurityPostman.mockResolvedValue(refusal("no_approved_scenarios", "There are no approved scenarios to export. Approve at least one scenario first.", 409));
      render(<SecurityExportPanel specificationLoaded />);
      fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
      const empty = await screen.findByTestId("security-export-empty");
      expect(empty).toHaveTextContent("There are no approved scenarios to export.");
      expect(empty).toHaveTextContent("Approve at least one scenario first.");
      expect(screen.queryByTestId("security-export-error")).not.toBeInTheDocument();
      expect(screen.queryByTestId("security-export-downloads")).not.toBeInTheDocument();
    });

    it("shows a failed export with the server's message and the generator's problems, and offers no file", async () => {
      exportSecurityPostman.mockResolvedValue(refusal("export_failed", "The collection did not pass validation.", 422, { failureCode: "collection_validation_failed", problems: ["item[0].id is not unique", 7] }));
      render(<SecurityExportPanel specificationLoaded />);
      fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
      const error = await screen.findByTestId("security-export-error");
      expect(error).toHaveTextContent("The export failed: The collection did not pass validation.");
      expect(error).toHaveTextContent("Nothing was exported.");
      const problems = within(screen.getByTestId("security-export-problems")).getAllByRole("listitem");
      expect(problems.map((item) => item.textContent)).toEqual(["item[0].id is not unique"]);
      expect(screen.queryByTestId("security-export-downloads")).not.toBeInTheDocument();
    });

    it("shows a refusal without problems as an error with no empty problem list", async () => {
      exportSecurityPostman.mockResolvedValue(refusal("no_specification", "No specification is loaded.", 409));
      render(<SecurityExportPanel specificationLoaded />);
      fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
      expect(await screen.findByTestId("security-export-error")).toHaveTextContent("The export failed: No specification is loaded.");
      expect(screen.queryByTestId("security-export-problems")).not.toBeInTheDocument();
    });

    it("replaces an earlier export with the failure, and a failure with a later export", async () => {
      exportSecurityPostman.mockResolvedValueOnce({ ok: true, data: exportReply() });
      render(<SecurityExportPanel specificationLoaded />);
      await runExport();

      exportSecurityPostman.mockResolvedValueOnce(refusal("network_error", "The Security Lab service is unreachable.", 0));
      fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
      expect(await screen.findByTestId("security-export-error")).toHaveTextContent("The Security Lab service is unreachable.");
      expect(screen.queryByTestId("security-export-success")).not.toBeInTheDocument();

      exportSecurityPostman.mockResolvedValueOnce({ ok: true, data: exportReply() });
      fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
      expect(await screen.findByTestId("security-export-success")).toBeInTheDocument();
      expect(screen.queryByTestId("security-export-error")).not.toBeInTheDocument();
    });
  });
});
