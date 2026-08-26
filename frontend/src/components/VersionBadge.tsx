import { useEffect, useState } from "react";
import type { VersionInfo } from "@apipilot/shared-domain";

export function VersionBadge() {
  const [version, setVersion] = useState<VersionInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/version")
      .then((res) => (res.ok ? (res.json() as Promise<VersionInfo>) : null))
      .then((data) => {
        if (!cancelled) {
          setVersion(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVersion(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) {
    return null;
  }

  return (
    <span data-testid="version-badge">
      v{version.version} ({version.commit})
    </span>
  );
}
