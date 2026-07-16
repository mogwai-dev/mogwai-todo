import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./styles.css";
import { initRustBridge } from "./rust/bridge";

function renderBootstrapError(error: unknown): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `
    <main style="padding: 24px; font-family: system-ui, sans-serif; line-height: 1.5;">
      <h1 style="margin: 0 0 12px;">App initialization failed</h1>
      <p style="margin: 0;">${message}</p>
    </main>
  `;
}

async function bootstrap() {
  try {
    await initRustBridge();
    const root = document.getElementById("root");
    if (!root) {
      throw new Error("#root element not found");
    }
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (error) {
    console.error("bootstrap failed", error);
    renderBootstrapError(error);
  }
}

void bootstrap();
