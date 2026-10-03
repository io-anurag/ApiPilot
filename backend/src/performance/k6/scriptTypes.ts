/**
 * What a generated k6 script is made of, shared by the request-chain renderer (AP-037,
 * specs/037-request-chain-performance contracts/chain-script.md). The legacy plan renderer these
 * came from was retired in phase two (FR-036).
 */
export interface RenderedScript {
  script: string;
  environmentTemplate: string;
  /** Value name → index of its `APIPILOT_V_<index>` variable. */
  valueIndex: Record<string, number>;
}

/** k6 system tags kept on every sample. `url` and `name` are excluded, so no resolved URL reaches the metrics stream (FR-040, D11). */
export const SYSTEM_TAGS = ["status", "method", "error_code", "check", "group"] as const;

/** AP-036 research R9: a Postman dynamic variable occurrence, `{{apipilot_dyn_<k>}}` in a template. */
export interface DynamicToken {
  token: string;
  kind: string;
}
