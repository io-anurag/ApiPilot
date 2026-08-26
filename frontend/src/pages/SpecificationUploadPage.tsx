import { useState, type ChangeEvent } from "react";
import type { ApiOperation } from "@apipilot/shared-domain";
import { AnalysisSummary } from "../components/AnalysisSummary";
import { OperationDetail } from "../components/OperationDetail";
import { OperationList } from "../components/OperationList";
import { uploadSpecification, type UploadResult } from "../services/specificationsClient";

export function SpecificationUploadPage() {
  const [result, setResult] = useState<UploadResult | null>(null);
  const [selected, setSelected] = useState<ApiOperation | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setSelected(null);
    const uploadResult = await uploadSpecification(file);
    setResult(uploadResult);
    setUploading(false);
    event.target.value = "";
  }

  const apiModel = result?.ok ? result.apiModel : null;

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
        </>
      )}
    </section>
  );
}
