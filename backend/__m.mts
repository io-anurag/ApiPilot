import { readFileSync } from "node:fs";
import "./src/loadEnv.ts";
import { parseYaml } from "./src/openapi/parseYaml.ts";
import { validateSpec } from "./src/openapi/validateSpec.ts";
import { buildApiModel } from "./src/openapi/buildApiModel.ts";
import { generateTestModel } from "./src/testDesign/generateTestModel.ts";
import { buildAIScenarioPrompt, AI_SCENARIO_MAX_OUTPUT_TOKENS } from "./src/testDesign/aiScenarioPrompt.ts";
import { getAIProvider } from "./src/ai/index.ts";

const v = await validateSpec(parseYaml(readFileSync(process.env.SPEC!, "utf8")));
const apiModel = buildApiModel(v.document as any, v.issues as any);
const tm = generateTestModel(apiModel);
const sized = apiModel.operations
  .map((o) => ({ o, chars: buildAIScenarioPrompt({ ...apiModel, operations: [o] } as any, tm).length }))
  .sort((a, b) => b.chars - a.chars);
console.log(`worst=${sized[0].chars} median=${sized[Math.floor(sized.length/2)].chars} best=${sized[sized.length-1].chars} chars`);
if (process.env.SKIP_INFER) process.exit(0);
const provider = getAIProvider();
await provider.getInputBudget(AI_SCENARIO_MAX_OUTPUT_TOKENS);
for (const pick of [sized[0], sized[Math.floor(sized.length/2)]]) {
  const prompt = buildAIScenarioPrompt({ ...apiModel, operations: [pick.o] } as any, tm);
  const t = Date.now();
  const res = await provider.infer({ contractVersion: 1, requestId: `m-${pick.chars}`, input: prompt, expectedOutputFormat: "json", maxOutputTokens: AI_SCENARIO_MAX_OUTPUT_TOKENS });
  let verdict = res.status === "success" ? "?" : `ERR:${(res as any).errorCategory}`;
  if (res.status === "success" && res.content) {
    try { verdict = Array.isArray(JSON.parse(res.content.trim().replace(/^```[a-z]*\s*/i,"").replace(/```\s*$/,"")).candidates) ? "VALID" : "WRONG_SHAPE"; }
    catch { verdict = "TRUNCATED"; }
  }
  console.log(`  ${pick.o.method} ${pick.o.path} ${pick.chars}ch -> ${Date.now()-t}ms ${verdict}`);
}
