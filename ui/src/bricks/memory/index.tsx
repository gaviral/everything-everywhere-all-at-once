import type { BrickProps } from "../contract";
import { StatsCard } from "./StatsCard";
import { useStats } from "./useStats";
import style from "./memory.css?inline";

export default function Memory({ map }: BrickProps) {
  const { stats, live } = useStats(map.connected);
  return <StatsCard stats={stats} live={live} />;
}

export const styles = style;
