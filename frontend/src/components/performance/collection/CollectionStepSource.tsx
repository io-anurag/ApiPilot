import { collectionStepLabel, type PerformanceStep } from "@apipilot/shared-domain";
import { StatusBadge } from "../../StatusBadge";
import { captureOriginText, environmentValuesOf, NOT_DOCUMENTED_IN_A_SPECIFICATION_LABEL } from "../performanceViewModel";

/**
 * AP-036 (specs/036-collection-performance-test research R20): where a collection step came from and
 * how its values are wired: its request, the values it captures with the script line each came from,
 * the references bound to earlier captures, and the values the environment provides. Names only,
 * never a value (FR-024).
 */
export function CollectionStepSource({
  step,
  stepLabel,
}: Readonly<{ step: PerformanceStep; stepLabel: (stepId: string) => string }>) {
  if (!step.collectionRequest) return null;
  const captures = step.captures ?? [];
  const bindings = step.bindings ?? [];
  const environment = environmentValuesOf(step);
  return (
    <dl className="grid gap-3 text-sm" data-testid={`collection-step-source-${step.id}`}>
      <div>
        <dt className="text-xs font-medium text-muted">Collection request</dt>
        <dd>{collectionStepLabel(step.collectionRequest)}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted">Captures</dt>
        <dd>
          {captures.length === 0 ? (
            "None"
          ) : (
            <ul className="space-y-1">
              {captures.map((capture) => (
                <li key={capture.name} className="flex flex-wrap items-center gap-1.5">
                  <code className="font-mono text-xs">{capture.name}</code>
                  <span className="text-xs text-muted">
                    ← {capture.source.kind === "body" ? `response field ${capture.source.path}` : `response header ${capture.source.name}`}
                    {captureOriginText(capture) ? ` · ${captureOriginText(capture)}` : ""}
                  </span>
                  {capture.documented === false && <StatusBadge label={NOT_DOCUMENTED_IN_A_SPECIFICATION_LABEL} tone="warning" />}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted">Values from earlier steps</dt>
        <dd>
          {bindings.length === 0 ? (
            "None"
          ) : (
            <ul className="space-y-1">
              {bindings.map((binding) => (
                <li key={`${binding.target.kind}-${"name" in binding.target ? binding.target.name : ""}`} className="text-xs">
                  <code className="font-mono">{binding.target.kind === "reference" ? `{{${binding.target.name}}}` : binding.captureName}</code>{" "}
                  <span className="text-muted">
                    ← captured {binding.captureName}, from {stepLabel(binding.captureStepId)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-muted">Values from the environment</dt>
        <dd>{environment.length === 0 ? "Only the base URL" : environment.map((name) => <code key={name} className="mr-1.5 font-mono text-xs">{name}</code>)}</dd>
      </div>
    </dl>
  );
}
