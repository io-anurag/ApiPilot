import type { ArtifactIconName, WorkflowIconName } from "./workflowCatalog";

/** Hand-drawn inline icons for the five workflows and three artifacts (AP-038 research.md D11),
 * following the existing no-icon-library convention (spec 027 D1). Decorative: the workflow or
 * artifact name always sits beside the icon. */
const PATHS: Record<WorkflowIconName | ArtifactIconName, React.ReactNode> = {
  guided: (
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  import: (
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
      <path d="M12 11v6m0 0-2.5-2.5M12 17l2.5-2.5" />
    </>
  ),
  quick: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8.5 5 3.5-5 3.5z" />
    </>
  ),
  plans: (
    <>
      <path d="M4 4v16h16" />
      <path d="m8 15 3.5-4 3 2.5L19 8" />
    </>
  ),
  script: (
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
      <path d="m10 12-2 2 2 2m4-4 2 2-2 2" />
    </>
  ),
  openapi: (
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  postman: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M8 13h8" />
    </>
  ),
  k6: (
    <>
      <path d="m8 9-4 3 4 3m8-6 4 3-4 3" />
      <path d="m13.5 6-3 12" />
    </>
  ),
};

export function WorkflowIcon({
  name,
  className = "h-5 w-5",
}: Readonly<{ name: WorkflowIconName | ArtifactIconName; className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
