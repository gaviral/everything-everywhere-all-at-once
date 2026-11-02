import { createContext, useContext, useMemo, type ReactNode } from "react";
import { motion } from "motion/react";
import type { World } from "./core";
import { TIPS } from "./Tips";
import "./tidy.css";
import { proposalWords, waitingByThread, type Proposal } from "./tidy-core";

// The refiner's proposals reach each card through this, so the map's cards need no new props (tidy-core.ts).
type Tidy = { world: World; waiting: Map<string, Proposal[]>; decide: (id: string, apply: boolean) => void };
const TidyContext = createContext<Tidy | null>(null);

export function TidyProvider({ world, decide, children }: { world: World; decide: Tidy["decide"]; children: ReactNode }) {
  const waiting = useMemo(() => waitingByThread(world.proposals), [world.proposals]);
  const value = useMemo(() => ({ world, waiting, decide }), [world, waiting, decide]);
  return <TidyContext.Provider value={value}>{children}</TidyContext.Provider>;
}

/** How many proposals wait on a thread, for its folded card's "N to review". */
export function useWaitingProposals(thread: string): number {
  return useContext(TidyContext)?.waiting.get(thread)?.length ?? 0;
}

/** A thread's waiting proposals, in the style of its ✦ ideas: Rename or Merge applies one, × keeps things as they are. */
export function ProposalRows({ thread }: { thread: string }) {
  const tidy = useContext(TidyContext);
  if (!tidy) return null;
  return (tidy.waiting.get(thread) ?? []).map((p) => {
    const words = proposalWords(p, tidy.world);
    if (!words) return null;
    return (
      <motion.div key={p.id} id={`item-${p.id}`} layout className="ai new proposal" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <span className="ai-mark" role="img" aria-label="AI proposal" data-tip={p.kind === "rename" ? TIPS.tidyRename : TIPS.tidyMerge}>✦</span>
        <span>{words.text}</span>
        <span className="ai-actions">
          <button aria-label={`${words.apply}: ${words.text}`} onClick={() => tidy.decide(p.id, true)}>{words.apply}</button>
          <button className="quiet" aria-label={words.keep} onClick={() => tidy.decide(p.id, false)}>×</button>
        </span>
      </motion.div>
    );
  });
}
