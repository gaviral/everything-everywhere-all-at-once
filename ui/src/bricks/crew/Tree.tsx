// The tree: every part a branch growing up into dev, dev into staging, staging into main. Lines grow as work climbs.
import { CLIMB, count, type Level, type PartRun, type Run } from "./run";

const WIDE = 1000, TALL = 640;
const TRUNK = 500, MAIN = 62, STAGING = 150, DEV = 248, LEAF = 548;

const leafX = (index: number, total: number) => total === 1 ? TRUNK : 70 + index * (WIDE - 140) / (total - 1);
const branch = (x: number) => `M${x} ${LEAF}C${x} ${LEAF - 170} ${TRUNK + (x - TRUNK) * 0.3} ${DEV + 90} ${TRUNK} ${DEV}`;

function wrapped(name: string) {
  const words = name.split(" ");
  if (words.length < 2) return [name];
  const middle = Math.ceil(words.length / 2);
  return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")];
}

function Branch({ part, x }: { part: PartRun; x: number }) {
  const line = branch(x);
  const moving = part.stage === "building" || part.stage === "fixing" || part.stage === "trying";
  return <g className={`crew-branch crew-${part.stage}`}>
    <path className="crew-line-base" d={line} />
    <path className="crew-line" d={line} pathLength={1} style={{ strokeDashoffset: 1 - CLIMB[part.stage] }} />
    {moving && <circle className="crew-message" r={7}><animateMotion dur={part.stage === "trying" ? "0.9s" : "1.5s"} repeatCount="indefinite" path={line} /></circle>}
    <circle className="crew-leaf" cx={x} cy={LEAF} r={15}>{part.why && <title>{part.why}</title>}</circle>
    <text className="crew-leaf-mark" x={x} y={LEAF + 6}>{part.stage === "merged" ? "✓" : part.stage === "off" ? "×" : ""}</text>
    {wrapped(part.name).map((words, index) => <text key={index} className="crew-leaf-name" x={x} y={LEAF + 42 + index * 24}>{words}</text>)}
    {part.ms !== undefined && <text className="crew-leaf-time" x={x} y={LEAF + 92}>{part.reused ? "reused" : `${(part.ms / 1000).toFixed(1)} s`}{part.fixed ? " · fixed" : ""}</text>}
  </g>;
}

function Stretch({ from, to, level }: { from: number; to: number; level: Level }) {
  const line = `M${TRUNK} ${from}Q${TRUNK + 26} ${(from + to) / 2} ${TRUNK} ${to}`;
  return <g className={`crew-stretch crew-level-${level}`}>
    <path className="crew-line-base" d={line} />
    <path className="crew-line" d={line} pathLength={1} style={{ strokeDashoffset: level === "done" ? 0 : level === "moving" ? 0.45 : 1 }} />
    {level === "moving" && <circle className="crew-message" r={8}><animateMotion dur="0.8s" repeatCount="indefinite" path={line} /></circle>}
  </g>;
}

function Node({ y, name, detail, lit }: { y: number; name: string; detail: string; lit: boolean }) {
  return <g className={lit ? "crew-node crew-node-lit" : "crew-node"}>
    <circle cx={TRUNK} cy={y} r={20} />
    <text className="crew-node-name" x={TRUNK + 36} y={y + 2}>{name}</text>
    <text className="crew-node-detail" x={TRUNK + 36} y={y + 26}>{detail}</text>
  </g>;
}

export function Tree({ run }: { run: Run }) {
  const onDev = count(run, "merged");
  return <svg className="crew-tree" viewBox={`0 0 ${WIDE} ${TALL + 60}`} role="img" aria-label={`${run.parts.length} parts, ${onDev} merged`}>
    <defs><filter id="crew-hand"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="4" /><feDisplacementMap in="SourceGraphic" scale="4" /></filter></defs>
    <g filter="url(#crew-hand)">
      <Stretch from={DEV} to={STAGING} level={run.staging} />
      <Stretch from={STAGING} to={MAIN} level={run.main} />
      {run.parts.map((part, index) => <Branch key={part.id} part={part} x={leafX(index, run.parts.length)} />)}
    </g>
    <Node y={MAIN} name="main" detail={run.main === "done" ? `stable · ${run.commit ?? ""}` : "what ships"} lit={run.main === "done"} />
    <Node y={STAGING} name="staging" detail={run.staging === "done" ? "passed" : "everything together"} lit={run.staging === "done"} />
    <Node y={DEV} name="dev" detail={`${onDev} of ${run.parts.length} parts`} lit={onDev > 0} />
  </svg>;
}
