import { MAPPING_NAME_REFUSAL_TEXT, type MappingNameRefusal } from "@apipilot/shared-domain";

/**
 * Which environment variable names a user script's mapping may set (specs/034-run-user-k6-script
 * FR-026, amended 2026-10-01; research R11). The rule lives in shared-domain, so the frontend's
 * mapping editor refuses the same names the backend does.
 */
export { MAX_MAPPING_NAME_LENGTH, validateMappingName } from "@apipilot/shared-domain";

export function mappingNameRefusalText(reason: MappingNameRefusal): string {
  return MAPPING_NAME_REFUSAL_TEXT[reason];
}
