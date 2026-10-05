const ICONS = {
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  down: <path d="M12 5v14M19 12l-7 7-7-7" />,
  duplicate: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  delete: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />,
  rename: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
} as const;

export type IconName = keyof typeof ICONS;

/**
 * An icon-only action. The icon is decorative: the label is the accessible name and the tooltip, so
 * the action reads the same to a screen reader as the text button it replaces.
 */
export function IconButton({ icon, label, onClick, disabled, danger }: Readonly<{ icon: IconName; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded border border-transparent hover:border-border hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "text-danger-700 dark:text-danger-200" : "text-text-secondary"}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[icon]}
      </svg>
    </button>
  );
}
