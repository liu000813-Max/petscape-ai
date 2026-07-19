// Public, isolated technical harness for WP-B45-0 browser evidence.
// The production two-stage workspace remains the authenticated /viewer route in later WPs.
import { R3fSpikeClient } from '../(app)/viewer-spike/R3fSpikeClient';

export default function PublicR3fSpikePage() {
  return <R3fSpikeClient />;
}
