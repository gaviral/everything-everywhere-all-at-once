import { RecoveryLog } from "./RecoveryLog";

/** The optional panel exposes the log; per-feature protection is always active. */
export default function SelfHeal() {
  return <div className="self-heal-panel"><RecoveryLog showEmpty /></div>;
}
