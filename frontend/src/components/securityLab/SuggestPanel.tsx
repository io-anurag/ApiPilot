import { useContext, useId, useState } from "react";
import type { SuggestReply } from "@apipilot/shared-domain";
import { useAiStatus } from "../../hooks/useAiStatus";
import { suggestScenarios } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { Card, CardHeader } from "../patterns/Card";
import { ActiveViewContext } from "../requestChain/activeView";

/** The headline of a run: how many suggestions were stored as drafts and how many were not. */
function summaryLine(stored: number, notStored: number): string {
  if (stored === 0 && notStored === 0) return "The model made no suggestions.";
  const storedText = stored === 1 ? "1 suggestion was stored as a draft" : `${stored} suggestions were stored as drafts`;
  const notStoredText = notStored === 1 ? "1 was not stored" : `${notStored} were not stored`;
  return `${storedText}; ${notStoredText}.`;
}

/** The provider's reason is free text and often ends in a full stop already; the sentence around it adds its own. */
function withoutTrailingStops(text: string): string {
  let end = text.trimEnd().length;
  while (end > 0 && text[end - 1] === ".") end -= 1;
  return text.slice(0, end);
}

/** What a suggestion run did, as text: the drafts that were stored first, then each suggestion that was not, with its reason. */
function SuggestionOutcome({ reply, categoryNames }: Readonly<{ reply: SuggestReply; categoryNames: Readonly<Record<string, string>> }>) {
  const { accepted, rejected, ignored } = reply;
  return (
    <div className="space-y-2 text-sm text-text-secondary" data-testid="suggest-outcome">
      <output className="block font-medium text-text-primary">{summaryLine(accepted.length, rejected.length)}</output>
      {accepted.length > 0 && (
        <div>
          <p className="font-medium text-text-primary">Stored as drafts, marked as AI-suggested. Review them before approving; nothing runs until you approve a scenario and start a run.</p>
          <ul className="list-disc pl-5" data-testid="suggest-accepted">
            {accepted.map((entry) => (
              <li key={entry.id}>
                {entry.title} (<span className="font-mono text-xs">{entry.operationKey}</span>, {categoryNames[entry.categoryId] ?? entry.categoryId})
              </li>
            ))}
          </ul>
        </div>
      )}
      {rejected.length > 0 && (
        <div>
          <p className="font-medium text-text-primary">Not stored, because they did not pass the same checks every scenario passes:</p>
          <ul className="list-disc pl-5" data-testid="suggest-rejected">
            {rejected.map((entry) => (
              <li key={entry.index}>
                {entry.title ?? `Suggestion ${entry.index + 1}`}
                {entry.operationKey && (
                  <>
                    {" "}
                    (<span className="font-mono text-xs">{entry.operationKey}</span>)
                  </>
                )}
                : {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ignored > 0 && <p>{ignored} more {ignored === 1 ? "suggestion was" : "suggestions were"} over the limit and not looked at.</p>}
      <p className="text-xs">Suggested by the local model “{reply.model}”. The model proposes tests only; it never approves one, runs one or decides an outcome.</p>
    </div>
  );
}

/**
 * Optional AI-suggested scenarios (specs/057 FR-064, US8). The model runs locally through the AI provider and sees only
 * the shape of the operations. What it proposes goes through the same validation as every scenario and is stored as a
 * draft, so it still needs a person's review. When the model is unavailable, or no specification is loaded, the control
 * is disabled with the reason, and nothing else in Security Lab changes (SC-015). If the model's status cannot be
 * read the control stays usable: the server refuses authoritatively when the model is unavailable.
 */
export function SuggestPanel({
  specificationLoaded,
  categoryNames,
  onSuggested,
}: Readonly<{ specificationLoaded: boolean; categoryNames: Readonly<Record<string, string>>; onSuggested: () => void }>) {
  const active = useContext(ActiveViewContext) === "security";
  const ai = useAiStatus(active);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<SuggestReply | null>(null);
  const reasonId = useId();
  const headingId = useId();

  let blockedReason: string | null = null;
  if (!specificationLoaded) {
    blockedReason = "No specification is loaded, so there is nothing to suggest scenarios for. Upload one in the Guided Workflow to use suggestions.";
  } else if (ai.kind === "ready" && ai.status.state === "unavailable") {
    const reason = withoutTrailingStops(ai.status.reason ?? "");
    const because = reason === "" ? "" : `: ${reason}`;
    blockedReason = `The local AI model is unavailable${because}. Every other part of Security Lab still works.`;
  }

  async function suggest() {
    setSuggesting(true);
    setError(null);
    const result = await suggestScenarios();
    setSuggesting(false);
    if (!result.ok) {
      setReply(null);
      setError(result.message);
      return;
    }
    setReply(result.data);
    if (result.data.accepted.length > 0) onSuggested();
  }

  return (
    <Card as="section" aria-labelledby={headingId} data-testid="suggest-panel">
      <CardHeader
        title="Suggest scenarios with the local AI model (optional)"
        titleId={headingId}
        subtitle="Suggestions are checked like any scenario and kept as drafts for you to review. The model never approves or runs anything."
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void suggest()} disabled={suggesting || blockedReason !== null} aria-describedby={blockedReason ? reasonId : undefined} className={BUTTON_STYLES.secondary}>
          {suggesting ? "Asking the local model..." : "Suggest scenarios"}
        </button>
        {blockedReason && (
          <p id={reasonId} className="text-xs text-text-secondary" data-testid="suggest-blocked">
            {blockedReason}
          </p>
        )}
        {!blockedReason && ai.kind === "unavailable" && (
          <p className="text-xs text-text-secondary" data-testid="suggest-status-unknown">
            The AI model's status could not be read. You can still try; the answer will say whether the model is available.
          </p>
        )}
      </div>
      {suggesting && (
        <output className="mt-3 block text-sm text-text-secondary">The local model is working. This can take a while, and nothing is sent outside this machine.</output>
      )}
      {error && (
        <div className="mt-3">
          <ErrorState testId="suggest-error" message="No scenarios were suggested" detail={error} />
        </div>
      )}
      {reply && (
        <div className="mt-3">
          <SuggestionOutcome reply={reply} categoryNames={categoryNames} />
        </div>
      )}
    </Card>
  );
}
