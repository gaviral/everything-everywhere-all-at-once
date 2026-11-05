// A quiet build tree: each part joins dev, then staging, then main.
import { CLIMB, count, type Level, type PartRun, type Run } from "./run";

const WIDTH = 300, TRUNK = 24, MAIN = 44, STAGING = 120, DEV = 196;
const leafY = (index: number) => 288 + index * 74;
const branch = (y: number) => `M56 ${y}H40Q${TRUNK} ${y} ${TRUNK} ${y - 16}V${DEV}`;

function partStatus(part: PartRun) {
  if (part.stage === "off") return "failed · turned off";
  if (part.stage === "fixing") return "failed · repairing";
  if (part.fixed) return part.stage === "merged" ? "fixed · merged" : "fixed · checking";
  return { waiting: "Waiting", building: "Building", trying: "Checking", merged: "Merged" }[part.stage];
}

function Branch({ part, index }: { part: PartRun; index: number }) {
  const y = leafY(index), line = branch(y);
  const moving = ["building", "fixing", "trying"].includes(part.stage);
  return <g className={`crew-branch crew-${part.stage}`}>
    <path className="crew-line-base" d={line} />
    <path className="crew-line" d={line} pathLength={1} style={{ strokeDashoffset: 1 - CLIMB[part.stage] }} />
    {moving && <circle className="crew-message" r={3}><animateMotion dur="2s" repeatCount="indefinite" path={line} /></circle>}
    <circle className="crew-leaf" cx={56} cy={y} r={9} />
    <text className="crew-leaf-mark" x={56} y={y + 4}>{part.stage === "merged" ? "✓" : part.stage === "off" ? "×" : part.stage === "fixing" ? "!" : ""}</text>
    <text className="crew-leaf-name" x={80} y={y - 4}>{part.name.length > 23 ? `${part.name.slice(0, 22)}…` : part.name}</text>
    <text x={80} y={y + 19}><tspan className="crew-leaf-state">{partStatus(part)}</tspan><tspan className="crew-leaf-time">{part.ms !== undefined ? ` · ${part.reused ? "reused" : `${(part.ms / 1000).toFixed(1)} s`}` : ""}</tspan></text>
    <title>{[part.name, partStatus(part), part.why].filter(Boolean).join(" · ")}</title>
  </g>;
}

function Stretch({ from, to, level }: { from: number; to: number; level: Level }) {
  const line = `M${TRUNK} ${from}V${to}`;
  return <g className={`crew-stretch crew-level-${level}`}>
    <path className="crew-line-base" d={line} />
    <path className="crew-line" d={line} pathLength={1} style={{ strokeDashoffset: level === "done" ? 0 : level === "moving" ? 0.45 : 1 }} />
    {level === "moving" && <circle className="crew-message" r={3}><animateMotion dur="1.5s" repeatCount="indefinite" path={line} /></circle>}
  </g>;
}

function Node({ y, name, detail, lit }: { y: number; name: string; detail: string; lit: boolean }) {
  return <g className={lit ? "crew-node crew-node-lit" : "crew-node"}>
    <circle cx={TRUNK} cy={y} r={10} />
    <text className="crew-node-name" x={50} y={y - 2}>{name}</text>
    <text className="crew-node-detail" x={50} y={y + 21}>{detail}</text>
  </g>;
}

export function Tree({ run }: { run: Run }) {
  const onDev = count(run, "merged");
  return <aside className="crew-tree-panel" aria-label="Build progress">
    <p className="crew-tree-heading">Build tree <span>{run.parts.length} parts</span></p>
    <svg className="crew-tree" viewBox={`0 0 ${WIDTH} ${Math.max(790, leafY(run.parts.length - 1) + 48)}`} role="img" aria-label={`${run.parts.length} parts, ${onDev} merged`}>
      <Stretch from={DEV} to={STAGING} level={run.staging} />
      <Stretch from={STAGING} to={MAIN} level={run.main} />
      {run.parts.map((part, index) => <Branch key={part.id} part={part} index={index} />)}
      <Node y={MAIN} name="main" detail={run.main === "done" ? `Stable · ${run.commit ?? ""}` : "What ships"} lit={run.main === "done"} />
      <Node y={STAGING} name="staging" detail={run.staging === "done" ? "Checks passed" : "Everything together"} lit={run.staging === "done"} />
      <Node y={DEV} name="dev" detail={`${onDev} of ${run.parts.length} merged`} lit={onDev > 0} />
    </svg>
  </aside>;
}
