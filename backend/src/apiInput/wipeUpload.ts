/**
 * Best-effort erasure of an uploaded file's bytes once analysis has finished or failed (specs/056
 * FR-049): the raw capture is not retained, only the redacted model, the report and workflow state.
 * The upload is memory-only (multer memory storage), so overwriting the buffer removes the only copy
 * the process holds; the garbage collector reclaims the memory afterwards.
 */
export function wipeUpload(file: { buffer?: Buffer } | undefined): void {
  file?.buffer?.fill(0);
}
