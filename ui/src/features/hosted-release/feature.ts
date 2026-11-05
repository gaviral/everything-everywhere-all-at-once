export const hostedReleaseFeature = Object.freeze({
  id: 'intake1422-hosted-release',
  label: 'Hosted candidate inspection',
  defaultEnabled: false as const,
  disableBehavior: 'Stops inspection; no application or user data is changed.',
});

export function inspectionEnabled(enabled?: boolean): boolean {
  return enabled === true;
}
