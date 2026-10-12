import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { fetchCurrentWorkflow } from "../services/testGenerationWorkflowClient";

/** How often a visible page that is still waiting on a run asks the server again (SC-004). */
export const WORKFLOW_REFRESH_INTERVAL_MS = 5000;

/**
 * Whether a run elsewhere could still change what the tracker shows: Postman Generation is done
 * (so the Execute stages are reachable) and Execution or Performance Testing has not finished
 * (Execution counts as finished once complete or skipped).
 */
export function isWaitingOnRun(workflow: TestGenerationWorkflow): boolean {
  if (workflow.stages.postmanGeneration.status !== "complete") return false;
  const execution = workflow.stages.execution.status;
  const executionDone = execution === "complete" || execution === "skipped";
  return !(executionDone && workflow.stages.performanceTesting.status === "complete");
}

/**
 * Keeps the guided workflow page current while it stays mounted but hidden
 * (specs/048-workflow-run-stage-status D5). A run finishing in Import & Run or Performance changes
 * the workflow on the server only, so the page asks again when it becomes visible and, while it is
 * visible and the browser tab is not hidden and a run could still change it, every
 * `WORKFLOW_REFRESH_INTERVAL_MS`. A `null` or failed response leaves the screen as it is, and a
 * response that is not newer than what the page already holds is ignored.
 */
export function useWorkflowStageRefresh(
  workflow: TestGenerationWorkflow | null,
  setWorkflow: Dispatch<SetStateAction<TestGenerationWorkflow | null>>,
  isVisible: boolean,
): void {
  const workflowRef = useRef(workflow);
  workflowRef.current = workflow;
  const waiting = workflow !== null && isWaitingOnRun(workflow);

  const refresh = useRef<() => Promise<void>>(async () => undefined);
  refresh.current = async () => {
    const result = await fetchCurrentWorkflow();
    if (!result.ok || !result.workflow) return;
    const fresh = result.workflow;
    const held = workflowRef.current;
    if (held && fresh.id === held.id && fresh.updatedAt <= held.updatedAt) return;
    setWorkflow(fresh);
  };

  // On becoming visible, and when the browser tab comes back while the page is on screen.
  useEffect(() => {
    if (!isVisible) return;
    if (workflowRef.current) void refresh.current();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && workflowRef.current) void refresh.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isVisible]);

  // While on screen and still waiting on a run.
  useEffect(() => {
    if (!isVisible || !waiting) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh.current();
    }, WORKFLOW_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isVisible, waiting]);
}
