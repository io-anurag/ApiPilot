import { collectionStepLabel, type CollectionPlanInfo } from "@apipilot/shared-domain";
import { HttpMethodBadge } from "../../HttpMethodBadge";
import { ExpectedStatusEditor } from "../JourneyList";
import { WrappingPath } from "../WrappingPath";

/**
 * AP-036 FR-027 (specs/036-collection-performance-test research R8, R20): the collection requests
 * whose values feed only later steps' authentication. They run once before the load, are shared by
 * every virtual user, and are refreshed by each one before a stated lifetime ends. Each lists the
 * values it provides and the steps that use them, and has its own expected statuses (FR-012).
 */
export function CredentialRequestList({
  requests,
  busy,
  stepLabel,
  onExpectedStatuses,
  onRemove,
}: Readonly<{
  requests: CollectionPlanInfo["credentialRequests"];
  busy: boolean;
  stepLabel: (stepId: string) => string;
  onExpectedStatuses: (stepId: string, codes: string[]) => void;
  onRemove: (itemId: string) => void;
}>) {
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby="credential-requests-title" className="space-y-2 rounded-md border border-border bg-chrome p-3 dark:bg-white/5" data-testid="credential-request-list">
      <div>
        <h4 id="credential-requests-title" className="text-sm font-semibold">
          Run once before the load
        </h4>
        <p className="text-xs text-muted">
          These requests provide values only to later steps&apos; authentication. Each is sent once before the load starts and its values are shared by every virtual user;
          when its response states a lifetime, each virtual user sends it again before the values expire. They are not journey steps and are not counted in any step.
        </p>
      </div>
      <ul className="space-y-3">
        {requests.map((request) => {
          const label = collectionStepLabel(request.request);
          return (
            <li key={request.stepId} className="space-y-2 rounded-md border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <HttpMethodBadge method={request.request.method} />
                <WrappingPath path={request.request.path} />
                <span className="text-sm">{label}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(request.request.itemId)}
                  aria-label={`Remove ${label} from the plan`}
                  className="ml-auto rounded border border-danger-500 px-2 py-1 text-xs font-medium text-danger-700 hover:bg-danger-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-danger-100 dark:hover:bg-danger-500/10"
                >
                  Remove from plan
                </button>
              </div>
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-muted">Provides</dt>
                  <dd>
                    <ul className="space-y-0.5">
                      {request.usedBy.map((use) => (
                        <li key={use.captureName}>
                          <code className="font-mono">{use.captureName}</code>{" "}
                          <span className="text-muted">
                            used by {use.stepIds.length === 1 ? stepLabel(use.stepIds[0]) : `${use.stepIds.length} steps: ${use.stepIds.map(stepLabel).join(", ")}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-muted">Values from the environment</dt>
                  <dd>{request.requiredValues.filter((name) => name !== "baseUrl").join(", ") || "Only the base URL"}</dd>
                </div>
              </dl>
              <ExpectedStatusEditor
                step={{ id: request.stepId, operationKey: label, expectedStatuses: request.expectedStatuses, collectionRequest: request.request }}
                disabled={busy}
                onChange={(codes) => onExpectedStatuses(request.stepId, codes)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
