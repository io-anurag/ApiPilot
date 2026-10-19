import type { ReactNode } from "react";
import type { ScenarioDetail as ScenarioDetailData } from "@apipilot/shared-domain";
import { CodeBlock } from "../CodeBlock";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { StatusBadge } from "../StatusBadge";
import { Banner } from "../patterns/Banner";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { FlagExplanations } from "./FlagBadges";
import { PrerequisitePanel } from "./PrerequisitePanel";
import {
  AUTHOR_LABEL,
  ORIGIN_LABEL,
  approvalView,
  describeCondition,
  expectedBasisView,
  formatTimestamp,
  splitOperationKey,
  toJsonText,
} from "./scenarioViewModel";
import { executionStatusVariant, reviewStateVariant, severityVariant } from "./securityViewModel";

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
      {children}
    </section>
  );
}

function TextList({ items }: Readonly<{ items: readonly string[] }>) {
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm text-text-secondary">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * One scenario in full (specs/057 FR-024 to FR-033): what it does, the request it sends and the behavior it expects
 * with the basis of that expectation, the conditions it is judged by, whether it is destructive, what it still needs,
 * and its history by version with the approval each applies to. Nothing here is edited; the actions arrive as
 * `actions`, so the same view serves a scenario whose actions are unavailable with no specification loaded.
 */
export function ScenarioDetail({
  detail,
  categoryName,
  actions,
  headingId,
}: Readonly<{ detail: ScenarioDetailData; categoryName?: string; actions?: ReactNode; headingId: string }>) {
  const { scenario, content, versions } = detail;
  const operation = splitOperationKey(content.operationKey);
  const severity = severityVariant(scenario.severity);
  const state = reviewStateVariant(scenario.reviewState);
  const execution = executionStatusVariant(scenario.executionStatus);
  const basis = expectedBasisView(content.expected);
  const requestPreview = toJsonText({ operation: content.operationKey, baseRequest: content.baseRequest, mutations: content.mutations });

  return (
    <article className="space-y-4" aria-labelledby={headingId} data-testid="scenario-detail">
      <header className="space-y-2">
        <h3 id={headingId} tabIndex={-1} className="text-lg font-semibold text-text-primary focus:outline-none">
          {content.title}
        </h3>
        <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          {operation.method && <HttpMethodBadge method={operation.method} />}
          <span className="break-all font-mono text-xs text-text-primary">{operation.path}</span>
          <span>{categoryName ?? content.categoryId}</span>
          <span>Version {scenario.currentVersion}</span>
          <span>{ORIGIN_LABEL[scenario.origin]}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge label={severity.label} tone={severity.tone} />
          <StatusBadge label={state.label} tone={state.tone} />
          <StatusBadge label={execution.label} tone={execution.tone} />
          {scenario.destructive && <StatusBadge label="Destructive" tone="danger" />}
        </div>
        <p className="text-xs text-text-secondary">From the assessment: {scenario.assessmentLabel}</p>
        <FlagExplanations flags={scenario.flags} />
        {actions}
      </header>

      <Section title="Objective and rationale">
        <p className="text-sm text-text-primary">{content.objective}</p>
        <p className="text-sm text-text-secondary">{content.rationale}</p>
        <p className="text-sm text-text-secondary">
          <span className="font-medium text-text-primary">Impact if it fails: </span>
          {content.impact}
        </p>
      </Section>

      {content.destructive.flag ? (
        <Banner tone="warning" title="Destructive: this scenario may change or delete data on the target" testId="detail-destructive">
          {content.destructive.reasons.length > 0 ? <TextList items={content.destructive.reasons} /> : "It must be confirmed by name when approved and again when a run is planned."}
        </Banner>
      ) : (
        <p className="text-sm text-text-secondary" data-testid="detail-not-destructive">
          Not marked destructive.
        </p>
      )}

      <Section title="Request">
        <CodeBlock label="Base request and controlled mutations" content={requestPreview} />
        <p className="text-xs text-text-secondary">
          Planned requests: {content.plannedRequestCount}. Only the controlled mutations above are applied to the base request.
        </p>
      </Section>

      <Section title="Expected behavior">
        <p className="text-sm text-text-primary">{content.expected.statement}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary" data-testid="expected-basis">
          <StatusBadge label={basis.label} tone={basis.tone} />
          <span>{basis.detail}</span>
        </p>
        <CodeBlock label="Expected behavior (as stored)" content={toJsonText(content.expected)} />
      </Section>

      <Section title="Evaluation conditions">
        {content.conditions.length === 0 ? (
          <p className="text-sm text-text-secondary">This scenario has no evaluation conditions, so a run cannot give it a pass or fail.</p>
        ) : (
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-text-secondary" data-testid="condition-list">
            {content.conditions.map((condition, index) => (
              <li key={`${condition.kind}-${index}`}>{describeCondition(condition)}</li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Prerequisites">
        <PrerequisitePanel prerequisites={content.prerequisites} requiredIdentities={content.requiredIdentities} />
      </Section>

      {(content.limitations.length > 0 || content.manualInputs.length > 0) && (
        <Section title="Limits and inputs you provide">
          {content.limitations.length > 0 && <TextList items={content.limitations} />}
          {content.manualInputs.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase text-muted">Inputs only you can provide</p>
              <TextList items={content.manualInputs} />
            </div>
          )}
        </Section>
      )}

      <Section title="Where this came from">
        <p className="text-sm text-text-secondary">
          Specification element: <span className="break-all font-mono text-xs text-text-primary">{content.provenance.specElementPointer}</span>
          {content.provenance.ruleId && <> · Rule: <span className="font-mono text-xs text-text-primary">{content.provenance.ruleId}</span></>}
          {content.provenance.duplicateOfRules && content.provenance.duplicateOfRules.length > 0 && <> · Also produced by: {content.provenance.duplicateOfRules.join(", ")}</>}
        </p>
      </Section>

      <Section title="History by version">
        <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Scenario versions">
          <table className={TABLE_STYLES.table}>
            <caption className="sr-only">Versions of this scenario with the approval each applies to</caption>
            <thead>
              <tr>
                <th scope="col" className={TABLE_STYLES.th}>Version</th>
                <th scope="col" className={TABLE_STYLES.th}>Author</th>
                <th scope="col" className={TABLE_STYLES.th}>When</th>
                <th scope="col" className={TABLE_STYLES.th}>Change</th>
                <th scope="col" className={TABLE_STYLES.th}>Approval</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => {
                const approval = approvalView(version, scenario.currentVersion);
                return (
                  <tr key={version.version} data-testid="version-row" data-version={version.version}>
                    <th scope="row" className={`${TABLE_STYLES.td} text-left font-medium`}>
                      {version.version}
                      {version.version === scenario.currentVersion && <span className="ml-1 text-xs font-normal text-text-secondary">(current)</span>}
                    </th>
                    <td className={TABLE_STYLES.td}>{AUTHOR_LABEL[version.author]}</td>
                    <td className={TABLE_STYLES.td}>{formatTimestamp(version.createdAt)}</td>
                    <td className={`${TABLE_STYLES.td} max-w-xs`}>
                      <span className="block">{version.version === 1 ? "Generated original" : version.materialChange ? "Material change" : "Not a material change"}</span>
                      {version.editNote && <span className="block text-xs text-text-secondary">{version.editNote}</span>}
                    </td>
                    <td className={`${TABLE_STYLES.td} max-w-md`}>
                      {approval ? (
                        <>
                          <span className="block font-medium">{approval.headline}</span>
                          {approval.details.map((line) => (
                            <span key={line} className="block text-xs text-text-secondary">
                              {line}
                            </span>
                          ))}
                        </>
                      ) : (
                        <span className="text-text-secondary">No approval</span>
                      )}
                      {version.rejection && (
                        <span className="mt-1 block text-xs text-text-secondary">
                          Rejected {formatTimestamp(version.rejection.at)}: {version.rejection.reason}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </article>
  );
}
