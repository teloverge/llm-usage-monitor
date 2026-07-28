import React from "react";
import { createRoot } from "react-dom/client";
// Imported for its side effect, and BEFORE App: i18next must be initialised and
// the document language set before the first render, or the first paint is in
// the wrong language.
import "./i18n/index.ts";
import { App } from "./app.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
