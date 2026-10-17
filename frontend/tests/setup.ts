import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// The app's pages are lazy-loaded, so under a loaded machine (the whole suite in parallel) the first
// render of a page can take longer than Testing Library's 1 s default. A wait that succeeds is not
// slowed down; this only gives a slow one room, and stays under Vitest's 5 s test timeout.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
  // jsdom keeps `location` across cases and destinations are addressed by the hash (AP-054), so an
  // address left by one test would otherwise decide where the next one starts.
  // (Some suites run in the node environment, where there is no window.)
  if (typeof window !== "undefined") window.history.replaceState(null, "", "/");
});
