type PathStep = {
  readonly label: string;
  readonly icon: "upload" | "analyze" | "design" | "run" | "collection" | "performance";
};

function PathIcon({ type }: Readonly<{ type: PathStep["icon"] }>) {
  const paths = {
    upload: <path d="M12 16V4m0 0L8 8m4-4l4 4M5 14v5h14v-5" />,
    analyze: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m16 16 4 4M8.5 11h5M11 8.5v5" />
      </>
    ),
    design: (
      <>
        <path d="M5 5.5h14v13H5zM8 9h8M8 12h5M8 15h3" />
      </>
    ),
    run: (
      <>
        <path d="m9 6 8 6-8 6z" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
    collection: (
      <>
        <path d="M5 4.5h14v15H5zM8 8h8M8 12h8M8 16h5" />
      </>
    ),
    performance: (
      <>
        <path d="M5 17V7m5 10V4m5 13v-7m5 7V6" />
      </>
    ),
  } satisfies Record<PathStep["icon"], React.ReactNode>;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      {paths[type]}
    </svg>
  );
}

export function WorkflowPathPreview({ steps }: Readonly<{ steps: readonly PathStep[] }>) {
  return (
    <ol className="col-span-full flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:gap-0">
      {steps.map(({ label, icon }, index) => (
        <li key={label} className="flex flex-1 items-center gap-2.5 sm:gap-0">
          <div className="flex items-center gap-2.5">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${index === 0 ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "border-border text-muted"}`}
            >
              <PathIcon type={icon} />
            </span>
            <span
              className={`whitespace-nowrap text-xs font-medium ${index === 0 ? "text-slate-900 dark:text-white" : "text-muted"}`}
            >
              {label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <span
              aria-hidden="true"
              className="mx-3 hidden h-px flex-1 bg-border sm:block"
            />
          )}
        </li>
      ))}
    </ol>
  );
}
