import type { LabelHTMLAttributes, ReactNode } from "react";

/**
 * The drop zone of the pattern set (AP-054 FR-014): a dashed deep-olive frame on pale lime, with a
 * lime icon tile. It is a `<label>` so the file input inside it (kept by the caller, `sr-only`)
 * stays keyboard reachable and the whole area opens the file picker; the caller passes the drag
 * handlers. `active` (a file is being dragged over it) fills it with lime and says so in the
 * caller's text; `disabled` mutes it and blocks the pointer.
 */
export function DropZone({
  active = false,
  disabled = false,
  icon,
  title,
  hint,
  className = "",
  children,
  ...rest
}: Readonly<
  {
    active?: boolean;
    disabled?: boolean;
    icon?: ReactNode;
    title: string;
    hint?: string;
    children?: ReactNode;
  } & LabelHTMLAttributes<HTMLLabelElement>
>) {
  let state = "border-brand-500 bg-lime-pale hover:bg-brand-100/40";
  if (active) state = "border-solid border-brand-500 bg-accent/40";
  if (disabled) state = "cursor-not-allowed border-border-strong bg-surface-subtle opacity-60";
  return (
    <label
      {...rest}
      data-active={active || undefined}
      className={`flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center motion-safe:transition-colors focus-within:ring-2 focus-within:ring-brand-500 ${disabled ? "" : "cursor-pointer"} ${state} ${className}`.trim()}
    >
      {icon && (
        <span aria-hidden="true" className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-on-accent">
          {icon}
        </span>
      )}
      <span className="text-sm font-semibold text-text-primary">{title}</span>
      {hint && <span className="text-xs text-text-secondary">{hint}</span>}
      {children}
    </label>
  );
}
