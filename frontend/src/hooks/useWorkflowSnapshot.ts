import { useCallback, useEffect, useState } from "react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { fetchCurrentWorkflow } from "../services/testGenerationWorkflowClient";

export interface WorkflowSnapshot {
  /** False until the first read has settled (success, no workflow, or failure). */
  readonly ready: boolean;
  /** The session's workflow, or null when there is none, it expired, or it could not be read. */
  readonly workflow: TestGenerationWorkflow | null;
  /** The Guided Workflow page reports every change it makes, so the sidebar and Home stay current. */
  readonly update: (workflow: TestGenerationWorkflow | null) => void;
}

/**
 * The session's guided workflow as the shell sees it (AP-054): read once on load so the sidebar's
 * stage states are right before the guided page has ever mounted, then kept in step by the page's
 * own reports. A read that fails leaves no workflow: the sidebar shows no done stages and the
 * Guided Workflow opens at Upload, as the app does today. It never throws.
 */
export function useWorkflowSnapshot(): WorkflowSnapshot {
  const [workflow, setWorkflow] = useState<TestGenerationWorkflow | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentWorkflow().then((result) => {
      if (cancelled) return;
      // A report from the page that arrived first is newer than this read.
      if (result.ok && result.workflow) setWorkflow((current) => current ?? result.workflow);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((next: TestGenerationWorkflow | null) => {
    setWorkflow(next);
    setReady(true);
  }, []);

  return { ready, workflow, update };
}
