export function unknownTermPolicy(known = false, critical = false): "preserve" | "ask" | "critical-lookup" {
  if (critical) return "critical-lookup";
  return known ? "preserve" : "ask";
}
