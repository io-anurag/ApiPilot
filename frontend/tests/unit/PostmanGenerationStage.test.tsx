import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ExportResult } from "@apipilot/shared-domain";
import { PostmanGenerationStage } from "../../src/components/PostmanGenerationStage";

function makeArtifact(): ExportResult {
  return {
    collection: { info: { name: "collection" } },
    environment: { name: "environment" },
    readme: "# README",
    summary: { requestCount: 6, folderCount: 3, byProvenance: { RULE: 6, AI: 0 } },
    limitations: [],
  } as unknown as ExportResult;
}

describe("PostmanGenerationStage", () => {
  it("shows the download links immediately when a previously-generated artifact is passed in, not just after a fresh Generate click", () => {
    render(
      <PostmanGenerationStage postmanArtifact={makeArtifact()} onGenerated={vi.fn()} />,
    );

    expect(screen.getByTestId("postman-generation-success")).toBeInTheDocument();
    const downloads = screen.getByTestId("postman-generation-downloads");
    expect(downloads).toHaveTextContent("Download collection");
    expect(downloads).toHaveTextContent("Download environment");
    expect(downloads).toHaveTextContent("Download README");
    expect(
      screen.getAllByRole("link", { name: /Download/ }),
    ).toHaveLength(3);
  });

  it("shows the idle form with no artifact provided", () => {
    render(<PostmanGenerationStage onGenerated={vi.fn()} />);

    expect(
      screen.queryByTestId("postman-generation-success"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate Postman Collection" }),
    ).toBeInTheDocument();
  });
});
