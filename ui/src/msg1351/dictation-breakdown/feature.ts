/** Host owns persistence and mounting. Off retains the in-memory review and hides it.
 * No capture, service calls, queue writes or AI adapter are requested by this feature. */
export const dictationBreakdownFeature = Object.freeze({
  id: "dictation-breakdown", namespace: "msg1351/dictation-breakdown", defaultEnabled: false,
  control: Object.freeze({ kind: "controlled-boolean", prop: "enabled", change: "onEnabledChange", offBehavior: "hide-retain-session", persistence: "host-owned" }),
  exportSchema: "dictation-breakdown/v1", aiReview: "unavailable",
} as const);
