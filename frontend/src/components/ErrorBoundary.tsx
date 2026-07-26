import { Component, type ErrorInfo, type ReactNode } from 'react';
import { log } from '../core/logger';

interface Props { children: ReactNode }
interface State { error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log('error', 'react', error.message, { stack: error.stack, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="fatal-error">
      <section>
        <strong>编辑器遇到问题</strong>
        <p>项目自动保存和恢复快照仍保留在本地。重新载入后可继续工作。</p>
        <code>{this.state.error.message}</code>
        <button className="button primary" onClick={() => window.location.reload()}>重新载入</button>
      </section>
    </main>;
  }
}
