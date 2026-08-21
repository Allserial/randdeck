import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DisplayView from "./features/display/DisplayView";
import { initializeStore, useAppStore } from "./app/store";
import { initializeI18n } from "./i18n";
import "./styles/index.css";

async function start() {
  const root = createRoot(document.getElementById("root")!);
  try {
    await initializeI18n();
    if (new URLSearchParams(location.search).get("view") === "display") { root.render(<StrictMode><DisplayView /></StrictMode>); return; }
    await initializeStore();
    await initializeI18n(useAppStore.getState().ui.locale);
    root.render(<StrictMode><App /></StrictMode>);
  }
  catch (error) { root.render(<main className="fatal-start"><h1>掷数台无法启动</h1><p>{(error as Error).message}</p><button type="button" onClick={() => location.reload()}>重试</button></main>); }
}

void start();
