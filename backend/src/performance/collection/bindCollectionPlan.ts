import type { Capture, CollectionReferenceLocation, ConversionFinding, FindingOwner } from "@apipilot/shared-domain";
import type { CollectionScript } from "./readCollectionRequests";
import type { RecognizedSetter, ScriptRecognition } from "./recognizeScript";

/**
 * AP-036 (specs/036-collection-performance-test research R6, FR-006, FR-008): a collection step's
 * captures, converted from the test scripts that apply to it, and the bindings of every later
 * `{{name}}` to the latest earlier capture of the same name, whatever the capture's scope. Bindings
 * are re-derived on every assembly from the step order, so reorders, removals and rebuilds need no
 * stored binding to repair (AP-035 R1). Pure.
 */
export interface DraftReference {
  name: string;
  locations: Set<CollectionReferenceLocation>;
  /** Every occurrence is in an auth field or an `Authorization` header (research R8). */
  authOnly: boolean;
}

export interface DraftStep {
  id: string;
  itemId: string;
  captures: Capture[];
  /** The step's `{{name}}`s that an earlier capture may fill, by name. */
  references: Map<string, DraftReference>;
}

export interface StepBinding {
  /** The `{{name}}` the step uses. */
  name: string;
  captureStepId: string;
  captureName: string;
  /** FR-019: bound by the engineer rather than by name. */
  addedByUser: boolean;
}

export interface AddedBinding {
  name: string;
  captureStepId: string;
  captureName: string;
}

/** What a step's test scripts give it: its converted captures, and the setters a later one replaced. */
export interface ConvertedCaptures {
  captures: Capture[];
  /** One `superseded-setter` finding per replaced setter, for this step only. */
  superseded: Omit<ConversionFinding, "stepIds">[];
}

/**
 * R6: each recognised setter is a capture on the step its script applies to. When one name is set
 * twice for a step, the later statement in Postman's script order (collection, folders, request)
 * wins; the earlier one is listed as superseded.
 */
export function convertedCaptures(scripts: readonly CollectionScript[], recognize: (script: CollectionScript) => ScriptRecognition): ConvertedCaptures {
  const latest = new Map<string, { setter: RecognizedSetter; owner: FindingOwner }>();
  const superseded: ConvertedCaptures["superseded"] = [];
  for (const script of scripts) {
    if (script.event !== "test") continue;
    for (const setter of recognize(script).setters) {
      const earlier = latest.get(setter.name);
      if (earlier) {
        superseded.push({
          kind: "superseded-setter",
          owner: earlier.owner,
          event: "test",
          line: earlier.setter.line,
          column: null,
          excerpt: earlier.setter.excerpt,
          detail: setter.name,
        });
        latest.delete(setter.name);
      }
      latest.set(setter.name, { setter, owner: script.owner });
    }
  }
  const captures = [...latest.values()].map(
    ({ setter, owner }): Capture => ({
      name: setter.name,
      source: setter.source,
      documented: null,
      origin: { kind: "collection-script", scope: setter.scope, owner, line: setter.line },
    }),
  );
  return { captures, superseded };
}

/**
 * R6, FR-008, FR-019: binds each reference of each step to the latest earlier capture of the same
 * name, in `steps`' order. A reference the engineer bound (`added`) uses that capture instead, while
 * it is still a capture of an earlier step. An unbound reference is an environment value.
 */
export function bindReferences(steps: readonly DraftStep[], added: ReadonlyMap<string, readonly AddedBinding[]>): Map<string, StepBinding[]> {
  const result = new Map<string, StepBinding[]>();
  steps.forEach((step, index) => {
    const earlier = steps.slice(0, index);
    const bindings: StepBinding[] = [];
    const explicit = new Map((added.get(step.id) ?? []).map((binding) => [binding.name, binding]));
    for (const name of [...step.references.keys()]) {
      const chosen = explicit.get(name);
      if (chosen && earlier.some((candidate) => candidate.id === chosen.captureStepId && candidate.captures.some((capture) => capture.name === chosen.captureName))) {
        bindings.push({ name, captureStepId: chosen.captureStepId, captureName: chosen.captureName, addedByUser: true });
        continue;
      }
      const producer = [...earlier].reverse().find((candidate) => candidate.captures.some((capture) => capture.name === name));
      if (producer) bindings.push({ name, captureStepId: producer.id, captureName: name, addedByUser: false });
    }
    result.set(step.id, bindings);
  });
  return result;
}
