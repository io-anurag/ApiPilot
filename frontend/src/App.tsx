import { useEffect, useState } from "react";
import { fetchHealth, type HealthCheckResult } from "./services/healthClient";
import { VersionBadge } from "./components/VersionBadge";
import { SpecificationUploadPage } from "./pages/SpecificationUploadPage";

export function App() {
  const [health, setHealth] = useState<HealthCheckResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchHealth().then((result) => {
      if (!cancelled) {
        setHealth(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>ApiPilot</h1>
      <VersionBadge />
      {health === null && <p data-testid="connection-status">Checking backend...</p>}
      {health?.ok === true && (
        <p data-testid="connection-status">Backend connected ({health.data.status})</p>
      )}
      {health?.ok === false && (
        <p data-testid="connection-status" role="alert">
          Backend unreachable: {health.error}
        </p>
      )}
      <SpecificationUploadPage />
    </main>
  );
}
