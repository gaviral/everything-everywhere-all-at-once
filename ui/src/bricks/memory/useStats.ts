import { useEffect, useState } from "react";
import { pollStats, type Stats } from "./stats";

export function useStats(connected: boolean) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    setAvailable(false);
    if (!connected) return;
    return pollStats(value => {
      setAvailable(value !== null);
      if (value) setStats(value);
    });
  }, [connected]);
  return { stats, live: connected && available };
}
