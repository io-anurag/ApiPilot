import type { ArtifactIconName, WorkflowIconName } from "./workflowCatalog";

/** Flow-oriented icons for the five workspace workflows. Decorative: the workflow name is visible beside each icon. */
const PATHS: Record<WorkflowIconName, React.ReactNode> = {
  guided: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="12" r="2" />
      <circle cx="6" cy="18" r="2" />
      <path d="m8 6 8 6M8 18l8-6" />
    </>
  ),
  import: (
    <>
      <path d="M4 12h4l2 3h4l2-3h4v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M12 3v8m0 0-3-3m3 3 3-3" />
    </>
  ),
  quick: (
    <>
      <path d="M4 16a8 8 0 0 1 16 0" />
      <path d="m12 16 4-5M7 19h10" />
      <circle cx="12" cy="16" r="1" />
    </>
  ),
  plans: (
    <>
      <rect x="3" y="5" width="5" height="5" rx="1" />
      <rect x="16" y="5" width="5" height="5" rx="1" />
      <rect x="9.5" y="15" width="5" height="5" rx="1" />
      <path d="m8 7.5h8M18.5 10v2.5H12v2.5" />
    </>
  ),
  script: (
    <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
      <path d="m10 12-2 2 2 2m4-4 2 2-2 2" />
    </>
  ),
};

export function WorkflowIcon({
  name,
  className = "h-5 w-5",
}: Readonly<{ name: WorkflowIconName; className?: string }>) {
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

/** Product marks for OpenAPI, Postman and k6. Their text labels remain visible alongside them. */
export function ArtifactProductIcon({
  name,
  className = "h-5 w-5",
}: Readonly<{ name: ArtifactIconName; className?: string }>) {
  if (name === "postman") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#ff6c37" />
        <path
          d="m7.5 16.5 7.2-7.2m-3.1-.9 3.9.9-.9 3.9m-3-1 2.2 2.2"
          fill="none"
          stroke="white"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }

  if (name === "k6") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <rect width="24" height="24" rx="5" fill="#7d64ff" />
        <text
          x="4.2"
          y="16.2"
          fill="white"
          fontFamily="Arial, sans-serif"
          fontSize="11"
          fontWeight="700"
        >
          k6
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#6ba539" />
      <path
        d="M6 8.5 9 6l3 2.5v3L9 14l-3-2.5zM12 8.5 15 6l3 2.5v3L15 14l-3-2.5zM9 14l3-2.5 3 2.5v3L12 19l-3-2.5z"
        fill="none"
        stroke="white"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}
