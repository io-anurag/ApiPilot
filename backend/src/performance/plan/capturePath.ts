/**
 * AP-035 FR-008: the closed body field-path grammar. AP-037 (specs/037-request-chain-performance
 * research R3) moved it to the shared domain unchanged; this module re-exports it so every AP-035
 * import keeps working.
 */
export {
  MAX_CAPTURE_PATH_LENGTH,
  MAX_CAPTURE_PATH_SEGMENTS,
  formatCapturePath,
  parseCapturePath,
  valueAtPath,
  withValueAtPath,
  type CapturePathResult,
} from "@apipilot/shared-domain";
