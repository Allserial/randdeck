import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "./Button";

export class ErrorBoundary extends Component<{ children: ReactNode; name?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("UI boundary", this.props.name, error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="error-boundary" role="alert"><AlertTriangle size={28} /><h2>{this.props.name || "此区域暂时不可用"}</h2><p>{this.state.error.message}</p><Button icon={<RotateCcw size={16} />} onClick={() => this.setState({ error: null })}>重试</Button></div>;
  }
}
