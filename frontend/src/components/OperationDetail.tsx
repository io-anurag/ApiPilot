import type { ApiOperation, BodyUnavailableReason } from "@apipilot/shared-domain";
import { CodeBlock } from "./CodeBlock";
import { FactOriginBadge } from "./FactOriginBadge";
import { HttpMethodBadge } from "./HttpMethodBadge";

const UNAVAILABLE_TEXT: Record<BodyUnavailableReason, string> = {
  missing: "a body was expected but is missing from the capture",
  empty: "an empty body was sent",
  oversized: "larger than the analyzed body size limit",
  binary: "binary content",
  compressed: "compressed, and ApiPilot does not decompress it",
  "undecodable-encoding": "an encoding other than base64",
  truncated: "cut short in the capture",
  "not-json": "not JSON, form or multipart data",
  "invalid-json": "claims to be JSON but does not parse",
  "too-deep": "nested deeper than the supported depth",
  "multipart-file": "a multipart upload with a file part, which cannot be reproduced",
};

const SECTION_TITLE = "text-xs font-semibold uppercase tracking-wider text-muted";

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function OperationDetail({ operation }: Readonly<{ operation: ApiOperation }>) {
  const observed = operation.observed;
  return (
    <article
      data-testid="operation-detail"
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary">
        <HttpMethodBadge method={operation.method} />
        <span className="min-w-0 break-all font-mono">{operation.path}</span>
        {operation.provenance && (
          <FactOriginBadge
            origin={operation.provenance.origin}
            observationCount={operation.provenance.observationCount}
            confidence={operation.provenance.confidence}
          />
        )}
      </h3>
      {operation.description && <p className="text-sm text-text-secondary">{operation.description}</p>}
      {observed && (
        <p data-testid="operation-origin" className="text-xs text-text-secondary">
          Seen {observed.observationCount} {plural(observed.observationCount, "time", "times")} on{" "}
          <span className="font-mono">{observed.origin}</span>. The origin is informational: it is never used as a test
          target.
        </p>
      )}
      <section>
        <h4 className={SECTION_TITLE}>Parameters</h4>
        {operation.parameters.length === 0 ? (
          <p className="text-sm text-muted">None</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-text-secondary">
            {operation.parameters.map((parameter) => (
              <li key={`${parameter.location}-${parameter.name}`}>
                <code className="font-mono text-xs">{parameter.name}</code> (
                {parameter.location}){parameter.required ? " (required)" : ""}
                {parameter.requiredUnknown ? " (requirement unknown)" : ""}
                {parameter.provenance && (
                  <>
                    {" "}
                    <FactOriginBadge
                      origin={parameter.provenance.origin}
                      observationCount={parameter.provenance.observationCount}
                      confidence={parameter.provenance.confidence}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {observed && observed.pathParameters.length > 0 && (
        <section data-testid="operation-path-parameters">
          <h4 className={SECTION_TITLE}>Path parameter decisions</h4>
          <ul className="mt-1 space-y-1 text-sm text-text-secondary">
            {observed.pathParameters.map((decision) => (
              <li key={decision.name}>
                <code className="font-mono text-xs">{`{${decision.name}}`}</code> was inferred because segment{" "}
                {decision.position + 1} took {decision.distinctValues} different values:{" "}
                <span className="break-all font-mono text-xs">{decision.exampleValues.join(", ")}</span>
                {decision.distinctValues > decision.exampleValues.length ? ", …" : ""}{" "}
                <FactOriginBadge
                  origin={decision.provenance.origin}
                  observationCount={decision.provenance.observationCount}
                  confidence={decision.provenance.confidence}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {operation.requestBody && (
        <section>
          <h4 className={SECTION_TITLE}>
            Request Body{operation.requestBody.required ? " (required)" : ""}
            {operation.requestBody.requiredUnknown ? " (requirement unknown)" : ""}
          </h4>
          <ul className="mt-1 space-y-1 text-sm text-text-secondary">
            {Object.keys(operation.requestBody.contentTypes).map((contentType) => (
              <li key={contentType} className="font-mono text-xs">
                {contentType}
              </li>
            ))}
          </ul>
          {operation.requestBody.provenance && (
            <p className="mt-1">
              <FactOriginBadge
                origin={operation.requestBody.provenance.origin}
                observationCount={operation.requestBody.provenance.observationCount}
                confidence={operation.requestBody.provenance.confidence}
              />
            </p>
          )}
        </section>
      )}
      <section>
        <h4 className={SECTION_TITLE}>Responses</h4>
        <ul className="mt-1 space-y-1 text-sm text-text-secondary">
          {operation.responses.map((response) => (
            <li key={response.statusCode}>
              <span className="font-mono font-semibold">{response.statusCode}</span>
              {response.provenance && response.description === "" ? "" : <> - {response.description}</>}
              {response.provenance && (
                <>
                  {" "}
                  <FactOriginBadge
                    origin={response.provenance.origin}
                    observationCount={response.provenance.observationCount}
                    confidence={response.provenance.confidence}
                  />
                </>
              )}
              {response.bodyUnavailable && (
                <span className="text-xs text-muted"> (body unavailable: {UNAVAILABLE_TEXT[response.bodyUnavailable]})</span>
              )}
            </li>
          ))}
        </ul>
      </section>
      {observed && observed.requestExamples.length > 0 && (
        <section data-testid="operation-request-examples">
          <h4 className={SECTION_TITLE}>Observed request examples</h4>
          <ul className="mt-1 space-y-2 text-sm text-text-secondary">
            {observed.requestExamples.map((example) => (
              <li key={example.firstEntryIndex}>
                Seen {example.observations} {plural(example.observations, "time", "times")}, returned{" "}
                <span className="font-mono font-semibold">{example.responseStatus}</span>
                {example.contentType ? <span className="font-mono text-xs"> ({example.contentType})</span> : null}
                {example.bodyUnavailable && (
                  <span className="text-xs text-muted"> (request body unavailable: {UNAVAILABLE_TEXT[example.bodyUnavailable]})</span>
                )}
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-medium text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    Show request values
                  </summary>
                  <CodeBlock
                    content={JSON.stringify(
                      {
                        pathParameters: example.pathParameters,
                        queryParameters: example.queryParameters,
                        headers: example.headers,
                        ...(example.body !== undefined ? { body: example.body } : {}),
                      },
                      null,
                      2,
                    )}
                  />
                </details>
              </li>
            ))}
          </ul>
          {observed.droppedExampleCount > 0 && (
            <p className="mt-1 text-xs text-muted">
              {observed.droppedExampleCount} more distinct {plural(observed.droppedExampleCount, "example was", "examples were")} seen
              and not kept.
            </p>
          )}
        </section>
      )}
      {observed && observed.credentialsObserved.length > 0 && (
        <section data-testid="operation-credentials">
          <h4 className={SECTION_TITLE}>Credentials seen (values never kept)</h4>
          <ul className="mt-1 space-y-1 text-sm text-text-secondary">
            {observed.credentialsObserved.map((credential) => (
              <li key={`${credential.location}-${credential.name}-${credential.kind}`}>
                {credential.kind} in {credential.location} <code className="font-mono text-xs">{credential.name}</code>, seen in{" "}
                {credential.observations} {plural(credential.observations, "entry", "entries")}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4 className={SECTION_TITLE}>Security</h4>
        {operation.security.length === 0 ? (
          <p className="text-sm text-muted">{observed ? "No security scheme observed" : "No security requirement"}</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-text-secondary">
            {operation.security.map((requirement) => {
              const schemeNames = requirement.schemes
                .map((scheme) => scheme.name)
                .join(" AND ");
              return <li key={schemeNames}>{schemeNames}</li>;
            })}
          </ul>
        )}
      </section>
    </article>
  );
}
