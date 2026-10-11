import { useCallback, useEffect, useState } from "react";
import type { QuickPerformanceTestView } from "@apipilot/shared-domain";
import { fetchQuickTest, uploadQuickTest } from "../services/quickPerformanceClient";

export type QuickTestState = { kind: "loading" } | { kind: "none" } | { kind: "ready"; quickTest: QuickPerformanceTestView };

export interface QuickTestSession {
  state: QuickTestState;
  uploading: boolean;
  /** The server's message for the last refused read or upload, shown on the Source step (FR-025). */
  error: string | null;
  /** Uploads a specification; resolves with the analysed view, or `null` after setting `error`. */
  upload: (file: File, replaceExisting: boolean) => Promise<QuickPerformanceTestView | null>;
  clearError: () => void;
}

/**
 * The session's uploaded specification (AP-032 quick test, specs/047 FR-023 to FR-025): read once on
 * mount, replaced only by an explicit upload. The backend keeps one per session, so it survives a
 * reload and is shared by every plan source that reads a specification. Validation, accepted formats
 * and the size limit are the server's, unchanged.
 */
export function useQuickTest(): QuickTestSession {
  const [state, setState] = useState<QuickTestState>({ kind: "loading" });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchQuickTest().then((result) => {
      if (cancelled) return;
      if (result.ok && result.quickTest) setState({ kind: "ready", quickTest: result.quickTest });
      else {
        setState({ kind: "none" });
        if (!result.ok) setError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const upload = useCallback(async (file: File, replaceExisting: boolean) => {
    setUploading(true);
    setError(null);
    const result = await uploadQuickTest(file, replaceExisting);
    setUploading(false);
    if (!result.ok) {
      setError(result.message);
      return null;
    }
    if (!result.quickTest) {
      setError("The specification could not be read.");
      return null;
    }
    setState({ kind: "ready", quickTest: result.quickTest });
    return result.quickTest;
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { state, uploading, error, upload, clearError };
}
