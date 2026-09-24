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

## Security note from this work

Response bodies and test names from the target API reach the prompt after redaction. A hostile
target could try to steer the model through them, which is prompt injection. The effect is
bounded:
- the cause must be one of three values, or insufficient evidence;
- citations must be real evidence ids;
- the output is only displayed, labelled as an AI inference, and never executed.

This is recorded as a known limitation rather than mitigated further.
