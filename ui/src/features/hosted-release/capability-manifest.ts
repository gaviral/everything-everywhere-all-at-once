import type { Capability, Switch } from './contracts';
import { hostedReleaseFeature } from './feature';

// These are the capabilities of this rehearsal, not assertions about a live service.
export function capabilityManifest(): Capability[] {
  return [
    { id: 'candidate-inspection', label: 'Candidate inspection', local: 'available', hosted: 'prerequisite-missing',
      reason: 'Local synthetic preview available. Shared host integration and deployment receipt required.' },
    { id: 'synthetic-session', label: 'Synthetic session example', local: 'available', hosted: 'prerequisite-missing',
      reason: 'Packaged example only. Hosted session transport and reconnect acceptance required.' },
    { id: 'shared-drawing', label: 'Shared drawing', local: 'prerequisite-missing', hosted: 'prerequisite-missing',
      reason: 'Drawing owner must supply selected-build acceptance; this package provides no drawing implementation.' },
    { id: 'native-calendar', label: 'Native calendar integration', local: 'prerequisite-missing', hosted: 'unsupported',
      reason: 'Requires a supported native host locally. A website cannot invoke the native bridge; a separate file-export adapter needs acceptance.' },
  ];
}

export function candidateSwitches(): Switch[] {
  return [{ id: hostedReleaseFeature.id, defaultEnabled: false, enabled: false }];
}
