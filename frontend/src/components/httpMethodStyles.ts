/**
 * The one definition of HTTP-method colour. `HttpMethodBadge` and the API-review method breakdown
 * both read it, so a method has the same colour everywhere.
 *
 * Solid, saturated fills from the `method-*` design tokens (index.css), the same in light and dark
 * (no `dark:` overrides), each with a label colour chosen for contrast: white on the dark fills, the
 * always-dark `code-surface` on the three bright ones (PUT amber, HEAD cyan, OPTIONS lime), at
 * least 4.8:1 throughout. A subtle inner ring keeps a bright fill visible on a light surface. A
 * method outside this set stays a neutral badge.
 *
 * Reviewed as OKLab distances between the fills: the closest pair is 0.20 (the earlier tinted set had
 * GET and PATCH 0.08 apart, and HEAD and OPTIONS were one identical neutral). The label is always
 * text, so colour is never the only signal.
 */
export const METHOD_BADGE_CLASSES: Record<string, string> = {
  GET: "bg-method-get text-white",
  POST: "bg-method-post text-white",
  PUT: "bg-method-put text-code-surface",
  PATCH: "bg-method-patch text-white",
  DELETE: "bg-method-delete text-white",
  HEAD: "bg-method-head text-code-surface",
  OPTIONS: "bg-method-options text-code-surface",
};
export const DEFAULT_METHOD_BADGE_CLASSES = "bg-surface-strong text-text-primary";

/** Solid fills for a breakdown bar and its legend dot, in the same colours as the badges. */
export const METHOD_FILL_CLASSES: Record<string, string> = {
  GET: "bg-method-get",
  POST: "bg-method-post",
  PUT: "bg-method-put",
  PATCH: "bg-method-patch",
  DELETE: "bg-method-delete",
  HEAD: "bg-method-head",
  OPTIONS: "bg-method-options",
};
