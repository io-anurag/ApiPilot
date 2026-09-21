import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installGlobalErrorHandlers } from "./globalErrorHandlers";
// Self-hosted (no runtime network call, per the project's local-first requirement) — these back
// the --font-sans/--font-mono/--font-display tokens declared in index.css, which previously named
// these families without ever loading them, silently falling back to OS fonts.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-serif/500.css";
import "@fontsource/ibm-plex-serif/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./index.css";

installGlobalErrorHandlers();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
