import type {
  ArtifactVariable,
  PostmanEnvironment,
  PostmanEnvironmentValue,
} from "@apipilot/shared-domain";
import { compareCodeUnits } from "./ordering";

/**
 * The companion environment artifact. It is the only place an engineer-supplied value appears
 * (FR-011), credential variables are typed `secret`, and an unsupplied variable keeps an empty
 * value rather than a guessed one (FR-012).
 */
export function buildEnvironment(
  collectionName: string,
  variables: ArtifactVariable[],
): PostmanEnvironment {
  const values: PostmanEnvironmentValue[] = [...variables]
    .sort((a, b) => compareCodeUnits(a.name, b.name))
    .map((variable) => ({
      key: variable.name,
      value: variable.value,
      type: variable.secret ? "secret" : "default",
      enabled: true,
    }));

  return {
    name: `${collectionName} environment`,
    _postman_variable_scope: "environment",
    values,
  };
}