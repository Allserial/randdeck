import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DisplayView from "./features/display/DisplayView";
import { initializeStore } from "./app/store";
import "./styles/index.css";

async function start() {
  const root = createRoot(document.getElementById("root")!);
  if (new URLSearchParams(location.search).get("view") === "display") { root.render(<StrictMode><DisplayView /></StrictMode>); return; }
  try { await initializeStore(); root.render(<StrictMode><App /></StrictMode>); }
  catch (error) { root.render(<main className="fatal-start"><h1>掷数台无法启动</h1><p>{(error as Error).message}</p><button type="button" onClick={() => location.reload()}>重试</button></main>); }
}

void start();
