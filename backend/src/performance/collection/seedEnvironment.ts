import type { Environment, UploadedCollectionSet } from "@apipilot/shared-domain";
import { createEnvironment } from "../../execution/environmentStore";
import { buildVariableBindings } from "../../externalCollections/collectionView";
import { parseStoredCollection } from "../../externalCollections/uploadedCollectionParsing";
import { BaseUrlMissingError } from "../errors";
import type { CollectionAssembly, LiteralLocation } from "./assembleCollectionPlan";
import { BASE_URL } from "./collectionValues";
import { SUPPORTED_DYNAMIC_VARIABLES } from "./dynamicValues";
import { readCollectionRequests } from "./readCollectionRequests";

/**
 * AP-036 FR-017 (specs/036-collection-performance-test research R17): "New environment from this
 * collection". A target environment with the given name, the collection's tier, its base-URL
 * variable's value as the base URL, and the values the plan needs, resolved as the collection view
 * resolves them (a non-empty value of the collection's environment, then its default), plus the
 * literals R12 kept out of the script. This is the only code that reads collection values; it
 * copies them on the server and returns the environment, whose values the caller never sends
 * back. Names that resolve to nothing are left out, so the checklist shows them as missing. The
 * collection is not changed.
 */
export function seedEnvironmentFromCollection(
  name: string,
  stored: UploadedCollectionSet,
  snapshot: string,
  assembly: Pick<CollectionAssembly, "plan" | "literals">,
): Environment {
  const info = assembly.plan.collection;
  if (!info) throw new Error("Only a collection plan seeds an environment.");
  const resolved = new Map(
    buildVariableBindings(parseStoredCollection(stored.collection), stored.variableValues).flatMap((binding) =>
      binding.resolved && binding.value !== undefined ? [[binding.name, binding.value] as const] : [],
    ),
  );
  const baseUrl = info.baseUrlVariable === null ? undefined : resolved.get(info.baseUrlVariable);
  if (!baseUrl) throw new BaseUrlMissingError();

  const literalValue = literalReader(snapshot, info.orderedRequestIds);
  const variableValues: Record<string, string> = {};
  for (const requirement of assembly.plan.userSuppliedValues) {
    if (requirement.name === BASE_URL) continue;
    const value = requirement.source === "collection-literal" ? literalValue(assembly.literals.get(requirement.name)) : resolved.get(requirement.name);
    if (value !== undefined && value !== "") variableValues[requirement.name] = value;
  }
  return createEnvironment({ name, tier: stored.tier, baseUrl, variableValues, requestDelayMs: 0 });
}

/** Reads a literal where R12 found it in the snapshot the plan was built from. */
function literalReader(snapshot: string, orderedRequestIds: readonly string[]) {
  const reads = readCollectionRequests(parseStoredCollection(snapshot), orderedRequestIds, { supportedDynamicVariables: SUPPORTED_DYNAMIC_VARIABLES });
  const sources = new Map(reads.flatMap((read) => (read.kind === "request" ? [[read.source.ref.itemId, read.source] as const] : [])));
  return (location: LiteralLocation | undefined): string | undefined => {
    if (!location) return undefined;
    const source = sources.get(location.itemId);
    if (!source) return undefined;
    if (location.kind === "auth") return source.auth.fields[location.field];
    return source.headers.find((header) => header.key === location.header)?.value;
  };
}
