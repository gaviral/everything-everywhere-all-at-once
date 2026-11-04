import type { HostingRequirement } from './contracts';

export function hostingContract(): HostingRequirement[] {
  return [
    { id: 'tls', requirement: 'Trusted HTTPS origin and secure browser context, with certificate renewal and phone verification.', evidence: 'MISSING' },
    { id: 'transport', requirement: 'Bidirectional session transport, authorized membership and server-owned ordering; webhooks alone do not supply browser delivery.', evidence: 'MISSING' },
    { id: 'reconnect', requirement: 'Reconnect with session identity, acknowledged sequence, deduplication and snapshot catch-up; show offline and stale state.', evidence: 'MISSING' },
    { id: 'cost', requirement: 'Owner-reviewed concurrency, idle connection, compute, storage, egress and model budgets with enforceable limits.', evidence: 'MISSING' },
    { id: 'route', requirement: 'Provider decision needs measured latency and primary-source cost evidence for instance and serverless options.', evidence: 'MISSING' },
    { id: 'release', requirement: 'Immutable deployable app artifact, served revision/fingerprint receipt, logged-out access and prior-artifact retention.', evidence: 'MISSING' },
  ];
}
