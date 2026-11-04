import { Component, type ReactNode } from "react";
import type { BrickInfo } from "../contract";
import { report } from "../../plugins-core";
import { recordCrash } from "./state";
import { ensureNotices } from "./Notices";

export class FeatureBoundary extends Component<{ info: BrickInfo; children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  componentDidCatch(error: unknown) {
    ensureNotices();
    report(this.props.info.id, "Failed", String(error));
    recordCrash(this.props.info, error);
  }
  render() { return this.state.broken ? null : this.props.children; }
}
