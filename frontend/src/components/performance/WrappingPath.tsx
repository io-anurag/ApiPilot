/**
 * An API path in monospace that wraps only after a "/", never inside a segment, so a long path in
 * a narrow column still reads as its segments (CLAUDE.md §40).
 */
export function WrappingPath({ path }: Readonly<{ path: string }>) {
  const segments = path.split("/");
  return (
    <span className="break-words font-mono text-xs">
      {segments.map((segment, index) => (
        // Segments are positional and never reorder, so the index is a stable key.
        <span key={index}>
          {index > 0 && "/"}
          {segment}
          {index < segments.length - 1 && <wbr />}
        </span>
      ))}
    </span>
  );
}
