import type {
  ApiOperation,
  ArtifactVariable,
  GenerationLimitation,
  PostmanAuth,
  SecuritySchemeDefinition,
} from "@apipilot/shared-domain";
import { credentialVariable } from "./artifactVariables";

/**
 * Maps declared security schemes to collection auth (FR-009).
 *
 * Only schemes the export can configure from what the specification declares are mapped. A
 * bearer token is a plausible-looking stand-in for OAuth2, but the flow, token endpoint, and
 * scopes are not something this export can supply, so configuring one would present a guess as
 * a contract (constitution I). Unmappable schemes become recorded limitations instead.
 */

export interface AuthMapping {
  auth?: PostmanAuth;
  variables: ArtifactVariable[];
  limitations: GenerationLimitation[];
}

function attribute(key: string, value: string) {
  return { key, value, type: "string" as const };
}

function mapScheme(scheme: SecuritySchemeDefinition): AuthMapping | undefined {
  if (scheme.type === "http" && scheme.scheme?.toLowerCase() === "bearer") {
    return {
      auth: { type: "bearer", bearer: [attribute("token", "{{token}}")] },
      variables: [credentialVariable("token")],
      limitations: [],
    };
  }
  if (scheme.type === "http" && scheme.scheme?.toLowerCase() === "basic") {
    return {
      auth: {
        type: "basic",
        basic: [attribute("username", "{{username}}"), attribute("password", "{{password}}")],
      },
      variables: [credentialVariable("username"), credentialVariable("password")],
      limitations: [],
    };
  }
  if (scheme.type === "apiKey" && scheme.name) {
    return {
      auth: {
        type: "apikey",
        apikey: [
          attribute("key", scheme.name),
          attribute("value", "{{apiKey}}"),
          attribute("in", scheme.in === "query" ? "query" : "header"),
        ],
      },
      variables: [credentialVariable("apiKey")],
      limitations: [],
    };
  }
  return undefined;
}

/**
 * The auth configuration for one operation. When an operation declares several alternative
 * requirement sets, the first declared set is used and the choice is recorded rather than
 * hidden (spec edge case; research.md).
 */
export function mapOperationAuth(
  operation: ApiOperation,
  securitySchemes: Record<string, SecuritySchemeDefinition>,
): AuthMapping {
  const location = `${operation.method.toUpperCase()} ${operation.path}`;
  const limitations: GenerationLimitation[] = [];

  if (operation.security.length === 0) return { variables: [], limitations };

  const [requirement, ...alternatives] = operation.security;
  if (alternatives.length > 0) {
    limitations.push({
      kind: "alternative-auth-requirement-selected",
      location,
      message: `The operation declares ${operation.security.length} alternative authentication requirements; the first declared one (${requirement.schemes.map((entry) => entry.name).join(", ")}) was applied.`,
    });
  }

  if (requirement.schemes.length === 0) return { variables: [], limitations };

  const [primary, ...additional] = requirement.schemes;
  if (additional.length > 0) {
    limitations.push({
      kind: "unsupported-auth-scheme",
      location,
      message: `The operation requires ${requirement.schemes.length} schemes together; only "${primary.name}" is configured, because the collection format carries one auth configuration per request.`,
    });
  }

  const scheme = securitySchemes[primary.name];
  if (!scheme) {
    limitations.push({
      kind: "unsupported-auth-scheme",
      location,
      message: `The operation references the security scheme "${primary.name}", which the specification does not define, so no authentication is configured.`,
    });
    return { variables: [], limitations };
  }

  const mapped = mapScheme(scheme);
  if (!mapped) {
    limitations.push({
      kind: "unsupported-auth-scheme",
      location,
      message: `The security scheme "${primary.name}" is of type "${scheme.type}", which this export cannot configure. The request is still generated, and no substitute credential mechanism is invented.`,
    });
    return { variables: [], limitations };
  }

  return { ...mapped, limitations: [...limitations, ...mapped.limitations] };
}
