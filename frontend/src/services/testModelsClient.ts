import type { ApiModel, TestModel } from "@apipilot/shared-domain";

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
      return {
        ok: false,
        error: (body?.error as string) ?? "unknown_error",
        message: (body?.message as string) ?? `Request failed with status ${response.status}`,
      };
    }
    return { ok: true, testModel: body.testModel as TestModel };
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      message: err instanceof Error ? err.message : "Request failed",
    };
  }
}
