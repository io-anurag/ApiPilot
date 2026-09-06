import type { AIProvider } from "@apipilot/shared-domain";
import { LocalProvider } from "./localProvider";
import { loadAIConfig } from "./modelConfig";
import { MockProvider } from "./mockProvider";

let activeProvider: AIProvider | undefined;

/** Selects and memoizes the active AIProvider based on AI_PROVIDER_MODE (FR-016). */
export function getAIProvider(env: NodeJS.ProcessEnv = process.env): AIProvider {
  if (!activeProvider) {
    const config = loadAIConfig(env);
    activeProvider =
      config.providerMode === "local"
        ? new LocalProvider(config.model, undefined, config.planning)
        : new MockProvider();
  }
  return activeProvider;
}

/** Test-only hook to clear the memoized provider between test runs. */
export function resetAIProvider(): void {
  activeProvider = undefined;
}
