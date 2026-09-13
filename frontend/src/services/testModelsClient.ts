import type { ApiModel, TestModel } from "@apipilot/shared-domain";
import { createLogger } from "../logger";

const logger = createLogger("testModelsClient");

export type GenerateTestModelResult =
  | { ok: true; testModel: TestModel }
  | { ok: false; error: string; message: string };

export async function generateBaselineTestSuite(apiModel: ApiModel): Promise<GenerateTestModelResult> {
  try {
    const response = await fetch("/api/test-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiModel }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const errorCategory = (body?.error as string) ?? "unknown_error";
      logger.error("request_failed", {
        operation: "generateBaselineTestSuite",
        errorCategory,
        statusCode: response.status,
      });
      return {
        ok: false,
        error: errorCategory,
        message: (body?.message as string) ?? `Request failed with status ${response.status}`,
      };
    }
    return { ok: true, testModel: body.testModel as TestModel };
  } catch (err) {
    logger.error("network_error", {
      operation: "generateBaselineTestSuite",
      errorCategory: "network_error",
    });
    return {
      ok: false,
      error: "network_error",
      message: err instanceof Error ? err.message : "Request failed",
    };
  }
}
