import { useState, type ChangeEvent } from "react";
import type { ApiOperation } from "@apipilot/shared-domain";
import { AnalysisSummary } from "../components/AnalysisSummary";
import { OperationDetail } from "../components/OperationDetail";
import { OperationList } from "../components/OperationList";
import { uploadSpecification, type UploadResult } from "../services/specificationsClient";
import {
  generateBaselineTestSuite,
  type GenerateTestModelResult,
} from "../services/testModelsClient";
import { TestScenarioReviewPage } from "./TestScenarioReviewPage";

export function SpecificationUploadPage() {
  const [result, setResult] = useState<UploadResult | null>(null);
  const [selected, setSelected] = useState<ApiOperation | null>(null);
  const [uploading, setUploading] = useState(false);
  const [testModelResult, setTestModelResult] = useState<GenerateTestModelResult | null>(
    null,
  );
  const [generating, setGenerating] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setSelected(null);
    setTestModelResult(null);
    const uploadResult = await uploadSpecification(file);
    setResult(uploadResult);
    setUploading(false);
    event.target.value = "";
  }

  const apiModel = result?.ok ? result.apiModel : null;

  async function handleGenerateTestSuite() {
    if (!apiModel) return;
    setGenerating(true);
    const generateResult = await generateBaselineTestSuite(apiModel);
    setTestModelResult(generateResult);
    setGenerating(false);
  }

  return (
    <section>
      <h2>Upload OpenAPI Specification</h2>
      <input
        type="file"
        accept=".yaml,.yml"
        aria-label="Upload OpenAPI specification"
        onChange={handleFileChange}
        disabled={uploading}
      />
      {uploading && <p>Uploading...</p>}
      {result !== null && !result.ok && (
        <p role="alert" data-testid="upload-error">
          {result.error}: {result.message}
        </p>
      )}
      {apiModel && (
        <>
          <AnalysisSummary summary={apiModel.summary} />
          <OperationList operations={apiModel.operations} onSelect={setSelected} />
          {selected && <OperationDetail operation={selected} />}
          <div>
            <button type="button" onClick={handleGenerateTestSuite} disabled={generating}>
              Generate Baseline Test Suite
            </button>
            {generating && <p>Generating...</p>}
          </div>
          {testModelResult !== null && !testModelResult.ok && (
            <p role="alert" data-testid="test-model-error">
              {testModelResult.error}: {testModelResult.message}
            </p>
          )}
          {testModelResult?.ok && (
            <TestScenarioReviewPage
              apiModel={apiModel}
              testModel={testModelResult.testModel}
            />
          )}
        </>
      )}
    </section>
  );
}
