import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { name: string; children: ReactNode }
interface State { failed: boolean }

/** One agent's screen failing never takes the console (sidebar, other agents) down with it. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] screen error`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="cu-ui cu-center" role="alert">
        <div className="cu-error-title">{this.props.name} could not be shown</div>
        <div>Something went wrong on this screen. The other agents still work.</div>
        <button type="button" className="cu-retry" onClick={() => this.setState({ failed: false })}>Try again</button>
      </div>
    );
  }
}
