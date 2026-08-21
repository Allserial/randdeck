import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "./Button";
import i18n from "i18next";
import { translateRuntimeMessage } from "../../i18n/messages";

export class ErrorBoundary extends Component<{ children: ReactNode; name?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("UI boundary", this.props.name, error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="error-boundary" role="alert"><AlertTriangle size={28} /><h2>{this.props.name || i18n.t("errors.fallback")}</h2><p>{translateRuntimeMessage(this.state.error.message, i18n.t.bind(i18n))}</p><Button icon={<RotateCcw size={16} />} onClick={() => this.setState({ error: null })}>{i18n.t("app.retry")}</Button></div>;
  }
}
