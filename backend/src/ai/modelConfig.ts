import os from "node:os";
import path from "node:path";
import type { AIProviderMode, ModelConfig } from "@apipilot/shared-domain";

const DEFAULT_MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".apipilot", "models");
const DEFAULT_INFERENCE_TIMEOUT_MS = 60_000;

export interface AIConfig {
  providerMode: AIProviderMode;
  model: ModelConfig;
}

/**
 * Env-driven AI configuration loader, mirroring backend/src/config.ts's convention
 * (reads process.env directly, no external dependency).
 */
export function loadAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const providerMode = resolveProviderMode(env);
  const modelId = env.AI_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
  const cacheDir = env.AI_MODEL_CACHE_DIR?.trim() || DEFAULT_CACHE_DIR;
  const useAccelerator = env.AI_USE_ACCELERATOR === "true";

  const parsedTimeout = env.AI_INFERENCE_TIMEOUT_MS
    ? Number.parseInt(env.AI_INFERENCE_TIMEOUT_MS, 10)
    : DEFAULT_INFERENCE_TIMEOUT_MS;
  const inferenceTimeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_INFERENCE_TIMEOUT_MS;

  return {
    providerMode,
    model: { modelId, cacheDir, useAccelerator, inferenceTimeoutMs },
  };
}

function resolveProviderMode(env: NodeJS.ProcessEnv): AIProviderMode {
  if (env.AI_PROVIDER_MODE === "local" || env.AI_PROVIDER_MODE === "mock") {
    return env.AI_PROVIDER_MODE;
  }
  // Explicit, non-silent default (constitution XXIX): an automated test run never
  // loads a real model unless AI_PROVIDER_MODE=local is set explicitly.
  return env.VITEST || env.NODE_ENV === "test" ? "mock" : "local";
}
