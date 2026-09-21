import type { ReactNode } from "react";

/**
 * Single source of truth for error presentation (spec 027 FR-006/FR-007). Formalizes the boxed
 * `role="alert"` + danger-color convention already used ad hoc in several files (e.g.
 * `PostmanGenerationStage`, `ExternalCollectionUpload`) as the one shape every error condition
 * renders through, including the plainer one-line messages other files previously hand-rolled.
 * `children` renders below `detail` for a call site that needs more than message/detail text
 * (e.g. a list of validation problems) while keeping the same box/role/color.
 */
export function ErrorState({
  message,
  detail,
  testId = "error-state",
  children,
}: Readonly<{
  message: string;
  detail?: string;
  /** Preserves a call site's pre-existing data-testid so migrating onto this component doesn't
   * break tests that already query it by name. */
  testId?: string;
  children?: ReactNode;
}>) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="space-y-1 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-500 dark:bg-danger-500/10 dark:text-danger-100"
    >
      <p className="font-medium">{message}</p>
      {detail && <p>{detail}</p>}
      {children}
    </div>
  );
}
