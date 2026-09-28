export type EntryFeatureIconName =
  "direct" | "visible" | "local" | "import" | "review" | "control";

export function EntryFeatureIcon({ name }: Readonly<{ name: EntryFeatureIconName }>) {
  const paths: Record<EntryFeatureIconName, React.ReactNode> = {
    direct: <path d="m5 12 5 5L20 7" />,
    visible: (
      <>
        <path d="M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5z" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
    local: (
      <>
        <path d="M5 11h14v9H5z" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
    import: (
      <>
        <path d="M5 4h14v16H5z" />
        <path d="M12 7v7m0 0 3-3m-3 3-3-3M8 17h8" />
      </>
    ),
    review: (
      <>
        <path d="M5 4h14v16H5zM8 9h8M8 13h4" />
        <path d="m15 15 1.5 1.5L20 13" />
      </>
    ),
    control: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8 6 4-6 4z" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-4 w-4 text-brand-700 dark:text-brand-300"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
