# Evaluation: AI Failure Analysis (AP-031)

**Task**: T057 | **Decision rule**: research D11 | **Constitution**: VII, XXII

## Result in one paragraph

The pipeline around the model works as designed. Evidence is deterministic and redacted, invalid
answers are rejected, citations are validated, and failures are explicit. The default local
model, `onnx-community/Qwen2.5-0.5B-Instruct`, is **not adequate for this task**. With a single
worked example (prompt v1) it produced valid JSON every time, but it copied the example's cause
and confidence into every answer. With three contrasting examples (prompt v2) valid-JSON success
fell to 50%, below D11's 80% bar, and it still echoed example confidences. Per D11, this opens a
**model decision through AP-004's benchmark process**, which needs your go-ahead because it means
downloading and evaluating larger models. AP-031 is therefore *implementation complete, AI
evaluation pending* (constitution XXII, XXXI), not "Implemented".

**Update 2026-09-24:** the model decision was run on `Qwen2.5-1.5B-Instruct`,
`SmolLM2-1.7B-Instruct` and `Qwen3-1.7B` (thinking disabled), with prompt v2 and an example-free
prompt v3. D11's bar was also tightened. No candidate is adequate; the closest, Qwen3-1.7B, gets
58% of causes right but is confidently wrong on 42% of cases.
The default model and prompt v2 are unchanged, and the next options need a product decision (see
"Decision after runs 1 to 3").

**Update 2026-09-24, run 5:** the product decision was to decide the cause by fixed rules and use
the AI only to explain it (spec Clarifications 2026-09-24; research D15 to D20; prompt v4). On the
same 12 cases the rules match every label, and the default model now writes a usable explanation for
12 of 12, with no contradictions, at an 11.2 s median. The default model is unchanged. AP-031 stays
*implementation complete, AI evaluation pending*, only because SC-006 also needs at least 4 real,
redacted failures in the corpus (T055), and every case so far is synthetic.

## Setup

| Item | Value |
|---|---|
| Date | 2026-09-23 |
| Machine | Intel Core Ultra 7 165H, 31 GB RAM, Windows 11 |
| Model | `onnx-community/Qwen2.5-0.5B-Instruct`, default dtype, already cached in `backend/models` (no download, fully offline) |
| Device | CPU (`AI_USE_ACCELERATOR` unset for reproducibility) |
| Planning / timeout | defaults: 42 ms prefill and 180 ms decode per token; 120 s per inference |
| Command | `npm run test:ai-real:failure-analysis -w backend` |
| Corpus | `backend/tests/fixtures/failureAnalysis/evaluationCorpus.ts`: 12 **synthetic** cases (4 environment, 4 specification mismatch, 2 downstream, 2 insufficient evidence); 2 use matched specification context |
| Raw output | `backend/logs/failure-analysis-evaluation.json` (git-ignored; overwritten on each run) |

**Real cases are still missing.** Research D11 and T055 require at least 4 cases taken from real,
redacted recorded failures (constitution XXII). No real recorded run was available in this
session, and inventing one would defeat the purpose. **Needed from you:** a redacted
uploaded-collection run, or the go-ahead to record one against a real target, such as the PayPal
Invoicing API v2 walkthrough in `specs/ROADMAP.md` Next Actions #13.

## Results

| Metric | Prompt v1 (single example) | Prompt v2 (three contrasting examples) |
|---|---|---|
| Structured-output success | **12/12 (100%)** | 6/12 (50%) |
| Cause agreement with the label | 4/12 (33%) | 2/12 (17%) |
| Valid citation (of structured answers) | 12/12 | 4/6 |
| Confidence values seen | 0.8 in every answer | 0.7 and 0.85 only |
| Confident but wrong (likely cause stated, wrong cause) | **8/12** | 4/12 |
| Explicit failure (`ai-failed`, or insufficient evidence from validation) | 0/12 | 8/12 |
| Median / max latency | 7.1 s / 13.5 s | 10.4 s / 26.3 s |

The v1 run was at 18:17 UTC and the v2 run at 18:22 UTC.

### Per case

| Case | Expected | v1 answer | v2 answer |
|---|---|---|---|
| env-connection-refused | environment | environment (0.8) | insufficient: no valid evidence cited (0.85) |
| env-timeout | environment | environment (0.8) | insufficient: no valid evidence cited (0.85) |
| env-gateway-502 | environment | environment (0.8) | specification mismatch (0.7) |
| env-bad-credentials-401 | environment | environment (0.8) | specification mismatch (0.7) |
| spec-200-instead-of-documented-201 | specification mismatch | environment (0.8) | ai-failed: `INVALID_RESPONSE` |
| spec-missing-required-field | specification mismatch | environment (0.8) | ai-failed: `INVALID_RESPONSE` |
| spec-wrong-content-type | specification mismatch | environment (0.8) | specification mismatch (0.7) ✓ |
| spec-400-on-documented-request | specification mismatch | environment (0.8) | ai-failed: `INVALID_RESPONSE` |
| downstream-503 | downstream | environment (0.8) | downstream (0.85) ✓ |
| downstream-500-dependency | downstream | environment (0.8) | ai-failed: `INVALID_RESPONSE` |
| insufficient-bare-500 | insufficient | environment (0.8) | ai-failed: `INVALID_RESPONSE` |
| insufficient-bare-assertion | insufficient | environment (0.8) | ai-failed: `INVALID_RESPONSE` |

v1's 4 "agreements" are the 4 environment cases, which match the single example's own cause, so
they are not evidence of reasoning.

## What the model did (diagnosis)

- **It copied the examples.** v1 returned the worked example's `environment-issue` / 0.8 for every
  case. In v2, the answers that parsed reused the examples' confidence values, and one correct
  answer reproduced its closest example's summary almost word for word.
- **It echoed its input.** A spot check of the raw v2 output for `insufficient-bare-500` showed the
  model returning the prompt's `evidence` array instead of an answer, which is correctly rejected
  as `INVALID_RESPONSE`.
- **It cited ids that only exist in the examples** (`E2` where the case had only `E1`). Validation
  dropped them, turning the answer into insufficient evidence as designed.
- **Confidence is not calibrated.** The self-reported confidence never varied with the evidence,
  so the 0.5 threshold (research D7) cannot discriminate with this model.

The safeguards behaved correctly throughout. No invalid answer was stored, uncited answers became
insufficient evidence, every outcome was explicit, and every analysis is labelled as an
inference. The failure is the model's reasoning quality, not the pipeline.

## Decision

1. **Keep prompt v2** (`FAILURE_ANALYSIS_RESPONSE_VERSION = 2`). Both versions are inadequate with
   this model, but v2 fails explicitly far more often (8 of 12) and states a wrong cause
   confidently half as often (4 of 12 against 8 of 12). That is the safer failure mode under
   constitution XIX and FR-008.
2. **Keep the 0.5 threshold** for now. With uncalibrated confidence no value would help, so
   changing it is not evidence-driven. Revisit it with the model decision.
3. **Open a model decision through AP-004** (research D11: v2's structured-output success of 50%
   is below 80%). Candidate models should be benchmarked on this corpus with the evaluation above,
   plus the 4 real cases, before the default changes. Examples are larger instruction-tuned models
   such as `Qwen2.5-1.5B-Instruct`, or a 3B model at q4. This downloads models, so it is not done
   without your go-ahead.
4. **Status**: implementation complete, AI evaluation pending, not "Implemented" (research D11,
   tasks.md T059).

## Model decision, run 1: `Qwen2.5-1.5B-Instruct` (2026-09-24)

The first candidate for decision 3. It was chosen because AP-004's benchmark
(`specs/004-ai-provider-local-inference/research.md` §2) tested only 0.5B and then 3.8B (Phi-3-mini,
about 323 s per request, disqualified on latency), leaving the 1.5B size untested. It is the same
model family as the default, so the chat template and parsing are unchanged, and it runs at the
default fp32 dtype, per AP-004's CPU guidance.

| Item | Value |
|---|---|
| Model | `onnx-community/Qwen2.5-1.5B-Instruct`, fp32 (`onnx/model.onnx` + `model.onnx_data`, 6.2 GB; SHA-256 checked against Hugging Face) |
| Everything else | As in Setup above: same machine, CPU, default planning rates and 120 s timeout, same 12 synthetic cases, prompt v2 |
| Command | `AI_MODEL_ID=onnx-community/Qwen2.5-1.5B-Instruct AI_USE_ACCELERATOR=false npm run test:ai-real:failure-analysis -w backend` |

| Metric | 0.5B, prompt v2 | **1.5B, prompt v2** |
|---|---|---|
| Structured-output success | 6/12 (50%) | **7/12 (58%)** |
| Cause agreement with the label | 2/12 (17%) | **4/12 (33%)** |
| Valid citation (of structured answers) | 4/6 | **7/7** |
| Confident but wrong | 4/12 | **0/12** |
| Confidence values seen | 0.7, 0.85 | 0.2, 0.85 |
| Median / max latency | 10.4 s / 26.3 s | 29.9 s / 54.0 s |

Per case, the 1.5B model was correct on both downstream cases (0.85) and both insufficient-evidence
cases (0.2). It answered insufficient evidence (0.2) for the other 8 cases. For 5 of those 8 the
answer was rejected as `INVALID_RESPONSE`.

**Diagnosis.** A one-off debug capture of the raw output for the 5 rejected cases (synthetic data
only, not kept) showed well-formed JSON, not truncation. The model wrote `steps` as objects
(`{"stepNumber": 1, "description": "…"}`) instead of the strings the contract requires, so
validation (research D7) rejected them correctly. Every one of those answers was also
`insufficient-evidence` with confidence 0.2, which is exactly the prompt's insufficient-evidence
worked example. Its downstream answers reuse the downstream example's 0.85. The larger model
still copies the examples, but it falls back to the "safe" example instead of a wrong cause. It
never distinguished an environment issue from a specification mismatch.

**Result.** The 1.5B model does not meet D11's 80% bar. Accepting object-shaped steps would raise
structured output to 12/12, but would leave cause agreement at 4/12, so relaxing validation is not
a fix. The default model is unchanged. The evidence points to example copying, which affects
both model sizes, as the next thing to address, rather than size alone.

## Model decision, run 2: prompt v3 (2026-09-24)

Prompt v3 (`FAILURE_ANALYSIS_RESPONSE_VERSION = 3`) replaces v2's three worked examples with a
placeholder `answerFormat`, so there is no concrete cause or confidence to copy. It also states
that `steps` are plain strings. The allowed-cause decision guide is unchanged. Setup as in run 1,
on both cached models.

| Metric | 0.5B, v3 | 1.5B, v3 |
|---|---|---|
| Structured-output success | 1/12 (8%) | **12/12 (100%)** |
| Cause agreement with the label | 0/12 | 4/12 (33%) |
| Valid citation (of structured answers) | 1/1 | 12/12 |
| Confident but wrong | 1/12 | **8/12** (confidence 0.9 to 1.0) |
| Median / max latency | 6.7 s / 10.2 s | 27.8 s / 38.3 s |

- **0.5B:** without concrete examples, it could not produce the answer shape at all, and its one
  valid answer was wrong. The cause of the 11 rejections was not captured.
- **1.5B:** the format problem is gone, but it answered `downstream-service-issue` for 10 of 12
  cases. It was correct only on the two environment cases with no response, and the two genuine
  downstream cases. It never chose `specification-mismatch` or `insufficient-evidence`, and it
  stated every wrong answer with confidence 0.9 or more, so the 0.5 threshold filtered none of
  them.

**Result.** v3 on 1.5B passes the letter of D11 (structured output at least 80%) but fails its
purpose. Confidently wrong answers are the failure mode constitution XIX and FR-008 most want to
avoid, and v2 on 1.5B had none. So v3 is not adopted, and the next candidate is evaluated
(run 3).

**Gap in the decision rule.** D11's only numeric bar is structured-output success, and this run
shows that a model can pass it while being wrong most of the time. An adoption bar should also
cover cause agreement and confidently wrong answers. That is a change to research D11, recorded
here for a decision rather than applied. *Resolved 2026-09-24:* D11 now also requires cause
agreement of at least 75% and at most 10% confidently wrong answers. None of runs 1 to 3 meets it.

## Model decision, run 3: `SmolLM2-1.7B-Instruct` (2026-09-24)

`HuggingFaceTB/SmolLM2-1.7B-Instruct` is Apache-2.0 and from a different model family. There is no
`onnx-community` or `Xenova` conversion of it, so the ONNX files come from the model's own repository,
which is tagged `transformers.js`. It ran at fp32 (`onnx/model.onnx` + `model.onnx_data`, 6.8 GB;
SHA-256 checked). Setup as in run 1, with both prompts.

| Metric | SmolLM2, v2 | SmolLM2, v3 |
|---|---|---|
| Structured-output success | 9/12 (75%) | 2/12 (17%) |
| Cause agreement with the label | **0/12** | 0/12 |
| Confident but wrong | 0/12 | 1/12 |
| Answers seen | `insufficient-evidence` (0.2) for all 9 | one `insufficient-evidence` (0.5), one wrong cause (0.9) |
| Median / max latency | 23.6 s / 74.4 s | 64.6 s / 608.9 s (the maximum includes the first model load) |

With v2, SmolLM2 returned the insufficient-evidence worked example for every structured answer. It
never reached the right cause, including the two cases whose label is insufficient evidence, because
those two answers were rejected. With v3 it mostly could not produce the answer shape.

## Model decision, run 4: `Qwen3-1.7B` with thinking disabled (2026-09-24)

`onnx-community/Qwen3-1.7B-ONNX` is Apache-2.0 upstream (`Qwen/Qwen3-1.7B`). It ran at fp32
(`onnx/model.onnx` + `model.onnx_data`, 6.9 GB; SHA-256 checked). Its chat template has a reasoning
mode that opens every answer with a `<think>` block, so the local provider now renders all chat
templates with `enable_thinking: false` (specs/013 research Decision 1, addendum 2026-09-24). With
the flag, Qwen3's generation prompt ends in an empty, closed `<think></think>` block. The Qwen2.5
templates render byte-identically with and without it. The run was judged against the tightened D11
bar (research D11, 2026-09-24).

| Metric | Qwen3-1.7B, v2 | Qwen3-1.7B, v3 | D11 bar |
|---|---|---|---|
| Structured-output success | **12/12 (100%)** | **12/12 (100%)** | ≥ 80%, met |
| Cause agreement with the label | 7/12 (58%) | 7/12 (58%) | ≥ 75%, **not met** |
| Confidently wrong | 5/12 (42%) | 5/12 (42%) | ≤ 10%, **not met** |
| Valid citation | 12/12 | 12/12 | |
| Confidence values seen | 0.7 to 0.85 | 0.8 to 1.0 | |
| Median / max latency | 52.1 s / 69.6 s | 35.5 s / 74.9 s | |

Both prompts produced the same cause on every case, so unlike the earlier models, Qwen3 is not
copying the examples' causes. With v2 it still reused the examples' confidence values (0.7 and
0.85). It was correct on both no-response environment cases, all four specification-mismatch
cases and one downstream case. The wrong answers were:
- `env-gateway-502` answered downstream-service issue;
- `env-bad-credentials-401` answered specification mismatch;
- `downstream-500-dependency` answered environment issue;
- both insufficient-evidence cases answered specification mismatch.

It never chose `insufficient-evidence`, and it never gave a confidence below 0.7, so the 0.5
threshold filtered none of the wrong answers.

The 502 case is arguably ambiguous, since a gateway error can also point downstream. The label
stays as it is: relabelling a case after seeing a model's answer would bias the evaluation. Even
counting it as correct, the pair would reach 8/12 agreement and 4/12 confidently wrong, still short
of the bar.

**Result.** Not adequate under D11, but clearly the strongest candidate. It is the only one that
distinguishes causes and always produces valid output, and its latency stays under the 120 s
timeout on CPU. Its failure mode is overconfidence.

## Decision after runs 1 to 3 (2026-09-24)

| Model, prompt | Structured | Agreement | Confident but wrong | Median latency |
|---|---|---|---|---|
| Qwen2.5-0.5B, v2 (current default) | 50% | 17% | 4/12 | 10.4 s |
| Qwen2.5-1.5B, v2 | 58% | 33% | 0/12 | 29.9 s |
| Qwen2.5-1.5B, v3 | 100% | 33% | 8/12 | 27.8 s |
| SmolLM2-1.7B, v2 | 75% | 0% | 0/12 | 23.6 s |
| SmolLM2-1.7B, v3 | 17% | 0% | 1/12 | 64.6 s |
| Qwen3-1.7B, v2 (run 4) | 100% | 58% | 5/12 | 52.1 s |
| Qwen3-1.7B, v3 (run 4) | 100% | 58% | 5/12 | 35.5 s |

*After run 4:* the decisions below still hold. No pair meets the tightened D11 bar, the default
model and prompt v2 are unchanged, and the Qwen3 option listed below has now been tried.

1. **No evaluated model is adequate.** None combines at least 80% structured output with useful
   cause agreement. Every model copies the worked examples when they are present, and when they
   are absent it either fails the format or collapses onto one cause.
2. **The default model is unchanged** (`onnx-community/Qwen2.5-0.5B-Instruct`). Qwen2.5-1.5B with v2
   is the safest candidate measured, with no confidently wrong answers, but at a third of the
   agreement bar it does not justify tripling latency for this feature and for AI enhancement.
   So `specs/004-ai-provider-local-inference/benchmark-results.json` is not changed.
3. **Prompt v2 stays in the code.** v3 is not adopted: it drops the default model to 8%
   structured output. It is documented here only as an evaluated variant.
4. **Status is unchanged**: implementation complete, AI evaluation pending.

Options for the next decision, to be chosen by the product owner:
- A deterministic cause classification from the evidence (for example, no response points to an
  environment issue, and a status differing from the documented one points to a specification
  mismatch), with the model limited to the summary and steps. This changes FR-003 and research D4
  and D7, so it goes through `/speckit-clarify` on this spec.
- A larger model on hardware acceleration (`AI_USE_ACCELERATOR`), with its own latency evidence.
  Every model above ran on CPU only.
- `onnx-community/Qwen3-1.7B-ONNX` with thinking mode disabled. It is the same size class, so the
  evidence above suggests limited headroom.
- The D11 adoption bar gap described in run 2.

The first option was chosen and is evaluated in run 5.

## Model decision, run 5: rule-decided cause, AI explanation only (2026-09-24)

**What changed.** The cause is now decided by seven ordered rules over the full recorded evidence
(`backend/src/failureAnalysis/classifyFailure.ts`, rule set version 1; research D15). The model
receives the decided cause and the deciding rule, and writes only a summary, cited evidence ids and
one to three next steps (prompt v4, response version 4; research D16). An answer is usable only if it
is structured, cites at least one real evidence id, and does not name a cause other than the decided
one (research D20). D11 is replaced for this purpose by SC-006's explanation bar: at least 80% usable,
at most 10% rejected for contradicting the rule.

**Setup.** The same 12 synthetic cases as runs 1 to 4, CPU only, fp32, prompt v4,
`npm run test:ai-real:failure-analysis -w backend`. Both models were already cached, so nothing was
downloaded.

| Metric | Qwen2.5-0.5B (default) | Qwen3-1.7B, thinking off | SC-006 bar |
|---|---|---|---|
| Rule agreement with the label | 12/12 (100%) | 12/12 (100%) | 100%, met |
| Usable explanations | **12/12 (100%)** | 11/12 (92%) | ≥ 80%, met by both |
| Rejected for contradicting the rule | **0/12 (0%)** | 0/12 (0%) | ≤ 10%, met by both |
| Median / max latency | **11.2 s / 13.7 s** | 29.4 s / 49.0 s | |

Rule agreement is the same for both models by construction, because the model no longer decides the
cause. The same 12 of 12 result is also checked in `npm test` (`classifyFailure.test.ts`), with no
model. Qwen3's one unusable answer (`env-connection-refused`) failed validation for its shape or
citations, not for naming another cause, and was shown as "AI explanation unavailable" with the
rule's cause and evidence intact.

**Caveat.** The rules were written with these 12 cases in view, so 12 of 12 shows that the rules
implement their labels, not that they generalise. That is what SC-006's real-case requirement is
for.

**Decision.**
1. **The default model stays** `onnx-community/Qwen2.5-0.5B-Instruct`. It meets the explanation
   bar outright and is about 2.6 times faster than Qwen3-1.7B, which does not do better. No AP-004
   default-model proposal is needed, and `specs/004-ai-provider-local-inference/benchmark-results.json`
   is not changed.
2. **Prompt v4 is the prompt in the code.** Prompts v2 and v3 are superseded, because they asked the
   model for the cause.
3. **SC-006 is not yet fully met.** Its rule, usable-rate and contradiction conditions are met. Its
   requirement for at least 4 real, redacted recorded failures is not, because T055 is open. AP-031
   therefore stays *implementation complete, AI evaluation pending* (constitution XXII). Once real
   cases are added, rerun both `npm test` and this evaluation.

## Security note from this work

Response bodies and test names from the target API reach the prompt after redaction. A hostile
target could try to steer the model through them, which is prompt injection. The effect is
bounded:
- since run 5 the cause is decided by fixed rules, so the model cannot change it, and an answer
  naming a different cause is rejected. Response text still reaches rule 4, whose service-name token
  can turn a 500 or 503 into a downstream-service issue, and nothing more;
- citations must be real evidence ids;
- the output is only displayed, labelled as an AI inference, and never executed.

This is recorded as a known limitation rather than mitigated further.
