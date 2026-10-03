import { useEffect, useId, useState } from "react";
import { isSettableHeader, isValidHeaderName, STEP_METHODS, type ChainStep, type StepMethod } from "@apipilot/shared-domain";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { Tabs } from "../Tabs";
import { BodyEditor } from "./BodyEditor";
import { splitPastedUrl } from "./chainEditing";
import { CheckRows } from "./CheckRows";
import { ExtractorRows } from "./ExtractorRows";
import { KeyValueRows } from "./KeyValueRows";
import { ReferenceField, type ReferenceSuggestion } from "./ReferenceField";

type Section = "request" | "extract" | "checks" | "settings";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "request", label: "Request" },
  { id: "extract", label: "Extract" },
  { id: "checks", label: "Checks" },
  { id: "settings", label: "Settings" },
];

const RUNS: { value: ChainStep["runs"]; label: string; description: string }[] = [
  { value: "every-iteration", label: "Every iteration", description: "Sent by each virtual user on every iteration." },
  { value: "once-per-virtual-user", label: "Once per virtual user", description: "Sent on a virtual user's first iteration, and again until it succeeds." },
  { value: "once-before-load", label: "Once before load", description: "Sent once before any virtual user starts; its values are shared by all." },
];

const STATUS = /^[1-5](?:[0-9]{2}|XX)$/;
const FIELD_CLASS = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

function headerRefusal(name: string): string | null {
  if (name === "") return null;
  if (!isValidHeaderName(name)) return "Not a valid header name.";
  return isSettableHeader(name) ? null : `k6 sets ${name} for every request, so a step cannot set it.`;
}

/** Where the step came from, in text (FR-033). */
export function sourceLabel(step: ChainStep): string {
  const origin =
    step.source.kind === "added"
      ? "Added by you"
      : step.source.kind === "operation"
        ? `From operation ${step.source.label}`
        : step.source.kind === "workflow"
          ? `From workflow ${step.source.workflowName}: ${step.source.label}`
          : `From collection request ${step.source.label}`;
  return origin;
}

/**
 * One step, edited in place (FR-003 to FR-009, FR-016): method, URL, query parameters, headers, body,
 * extractors, checks, runs setting, think time and expected statuses. Every field accepts the
 * engineer's own text; nothing is checked against a specification (FR-026). Edits are kept as typed
 * and saved when a field loses focus or a row is added, removed or moved.
 */
export function StepEditor({
  step,
  suggestions,
  onChange,
  onCommit,
  onAddExtractor,
  onAddCheck,
}: Readonly<{
  step: ChainStep;
  suggestions: readonly ReferenceSuggestion[];
  onChange: (step: ChainStep) => void;
  onCommit: () => void;
  onAddExtractor: () => void;
  onAddCheck: (kind: "field-exists" | "field-equals" | "body-contains" | "time-at-most") => void;
}>) {
  const id = useId();
  const [section, setSection] = useState<Section>("request");
  const [statuses, setStatuses] = useState(step.expectedStatuses.join(", "));
  useEffect(() => setStatuses(step.expectedStatuses.join(", ")), [step.id, step.expectedStatuses]);
  const parsedStatuses = statuses
    .split(/[\s,]+/)
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code !== "");
  const statusProblem = parsedStatuses.find((code) => !STATUS.test(code));
  const edit = (patch: Partial<ChainStep>) => onChange({ ...step, ...patch });

  return (
    <section aria-label={`Step: ${step.name}`} className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={`${id}-name`} className="text-xs font-medium text-muted">
            Step name
          </label>
          <input id={`${id}-name`} className={`${FIELD_CLASS} w-full font-medium`} value={step.name} onChange={(event) => edit({ name: event.target.value })} onBlur={onCommit} />
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-5">
          <StatusBadge label={sourceLabel(step)} tone={step.source.kind === "added" ? "info" : "neutral"} />
          {step.changed && <StatusBadge label="Changed" tone="warning" />}
        </div>
      </div>

      <Tabs tabs={SECTIONS} activeTab={section} onChange={setSection} label="Step sections" />

      {section === "request" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-2">
            <label htmlFor={`${id}-method`} className="sr-only">
              Method
            </label>
            <div className="flex items-center gap-2">
              <HttpMethodBadge method={step.method} />
              <select
                id={`${id}-method`}
                className={`${FIELD_CLASS} font-mono`}
                value={step.method}
                onChange={(event) => {
                  edit({ method: event.target.value as StepMethod });
                  onCommit();
                }}
              >
                {STEP_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <ReferenceField
              label="URL"
              value={step.url}
              monospace
              suggestions={suggestions}
              placeholder="{{baseUrl}}/api/v1/customers"
              onChange={(url) => {
                const split = splitPastedUrl(url);
                edit(split ? { url: split.url, query: [...step.query, ...split.query] } : { url });
              }}
              onCommit={onCommit}
            />
          </div>
          <p className="text-xs text-muted">Start the URL with {"{{baseUrl}}"}, the target environment's base URL, or with a full http:// or https:// address. Query parameters go in their own list.</p>
          <div>
            <h4 className="mb-1 text-sm font-semibold">Query parameters</h4>
            <KeyValueRows label="Query parameters" rows={step.query} suggestions={suggestions} addLabel="+ Add query parameter" onChange={(query) => edit({ query })} onCommit={onCommit} />
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold">Headers</h4>
            <KeyValueRows label="Headers" rows={step.headers} suggestions={suggestions} addLabel="+ Add header" refuseName={headerRefusal} onChange={(headers) => edit({ headers })} onCommit={onCommit} />
          </div>
          <div>
            <h4 className="mb-1 text-sm font-semibold">Body</h4>
            <BodyEditor body={step.body} suggestions={suggestions} onChange={(body) => edit({ body })} onCommit={onCommit} />
          </div>
        </div>
      )}

      {section === "extract" && <ExtractorRows extractors={step.extractors} onChange={(extractors) => edit({ extractors })} onCommit={onCommit} onAdd={onAddExtractor} />}

      {section === "checks" && <CheckRows checks={step.checks} suggestions={suggestions} onChange={(checks) => edit({ checks })} onCommit={onCommit} onAdd={onAddCheck} />}

      {section === "settings" && (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Runs</legend>
            {RUNS.map((option) => (
              <label key={option.value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`${id}-runs`}
                  className="mt-1"
                  checked={step.runs === option.value}
                  onChange={() => {
                    edit({ runs: option.value });
                    onCommit();
                  }}
                />
                <span>
                  <span className="font-medium">{option.label}</span>
                  <span className="block text-xs text-muted">{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`${id}-statuses`} className="text-sm font-semibold">
                Expected statuses
              </label>
              <input
                id={`${id}-statuses`}
                className={`${FIELD_CLASS} w-full font-mono`}
                value={statuses}
                aria-invalid={statusProblem || parsedStatuses.length === 0 ? true : undefined}
                aria-describedby={`${id}-statuses-help`}
                onChange={(event) => setStatuses(event.target.value)}
                onBlur={() => {
                  if (statusProblem) return;
                  edit({ expectedStatuses: [...new Set(parsedStatuses)] });
                  onCommit();
                }}
              />
              <p id={`${id}-statuses-help`} className={`text-xs ${statusProblem || parsedStatuses.length === 0 ? "text-danger-700 dark:text-danger-200" : "text-muted"}`}>
                {statusProblem
                  ? `${statusProblem} is not a status code such as 200 or 2XX.`
                  : parsedStatuses.length === 0
                    ? "A step needs at least one expected status before the script can be generated."
                    : "Codes such as 200, 201 or 2XX, separated by commas. Any other status counts as a failure."}
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-think`} className="text-sm font-semibold">
                Think time after this step (ms)
              </label>
              <input
                id={`${id}-think`}
                type="number"
                min={0}
                className={`${FIELD_CLASS} w-full`}
                value={step.thinkTimeMs ?? ""}
                placeholder="Plan default"
                onChange={(event) => edit({ thinkTimeMs: event.target.value === "" ? null : Math.max(0, Math.round(Number(event.target.value))) })}
                onBlur={onCommit}
              />
              <p className="text-xs text-muted">Leave blank to use the plan's default.</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
