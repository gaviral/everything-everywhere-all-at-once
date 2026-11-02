import { Component, type ReactNode } from "react";

/** Whatever throws below it shows a way back, not a white page. The map lives in the core, so a reload loses nothing
 *  it has. Classes only: React has no hook for catching a render's error. */
export class Crash extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false };

  static getDerivedStateFromError() {
    return { broken: true };
  }

  render() {
    if (!this.state.broken) return this.props.children;
    return <main className="map">
      <div className="empty" role="alert">
        <h1>Something broke.</h1>
        <p>Reload: your map is saved.</p>
        <p className="empty-sample"><button type="button" className="sample-button" onClick={() => location.reload()}>Reload</button></p>
      </div>
    </main>;
  }
}
