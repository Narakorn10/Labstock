import { TrackingResult } from '../line-flex-templates';
import { thaipostProvider } from './thaipost';
import { dkshProvider } from './dksh';
import { manualProvider } from './manual';

export interface TrackingProvider {
  name: string;
  track(trackingNo: string): Promise<TrackingResult>;
}

const providers: Record<string, TrackingProvider> = {
  THAIPOST: thaipostProvider,
  DKSH: dkshProvider,
  MANUAL: manualProvider,
};

export async function trackShipment(providerKey: string, trackingNo: string): Promise<TrackingResult> {
  const provider = providers[providerKey.toUpperCase()];
  if (!provider) {
    throw new Error(`Tracking provider ${providerKey} not supported`);
  }
  return provider.track(trackingNo);
}

export function getSupportedProviders(): string[] {
  return Object.keys(providers);
}
