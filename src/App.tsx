import * as Tooltip from "@radix-ui/react-tooltip";
import AppShell from "./app/AppShell";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import "./styles/index.css";

export default function App() {
  return <Tooltip.Provider delayDuration={450}><ErrorBoundary name="掷数台启动失败"><AppShell /></ErrorBoundary></Tooltip.Provider>;
}
