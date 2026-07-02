import { TrackingProvider } from './index';
import { TrackingResult } from '../line-flex-templates';

let cachedToken: string | null = null;
let tokenExpiresAt: number | null = null;

interface ThaiPostAuthResponse {
  token: string;
}

interface ThaiPostTrackingEvent {
  status_date: string;
  status_description: string;
  location: string;
  status_detail: string;
}

interface ThaiPostTrackingResponse {
  response: {
    items: Record<string, ThaiPostTrackingEvent[]>;
  };
}

async function getThaiPostToken(): Promise<string> {
  const staticToken = process.env.THAIPOST_API_TOKEN;
  if (!staticToken) {
    throw new Error('THAIPOST_API_TOKEN is not configured');
  }

  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const response = await fetch('https://trackapi.thailandpost.co.th/post/api/v1/authenticate/token', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${staticToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to authenticate with ThaiPost API: ${response.statusText}`);
  }

  const data = (await response.json()) as ThaiPostAuthResponse;
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + 3500 * 1000;

  return data.token;
}

export const thaipostProvider: TrackingProvider = {
  name: 'Thai Post / EMS',
  track: async (trackingNo: string): Promise<TrackingResult> => {
    try {
      if (process.env.THAIPOST_API_TOKEN === 'DUMMY' || !process.env.THAIPOST_API_TOKEN) {
        return {
          provider: 'Thai Post / EMS',
          trackingNo,
          status: 'IN_TRANSIT',
          statusText: 'à¸­à¸¢à¸¹à¹ˆà¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡à¸à¸²à¸£à¸‚à¸™à¸ªà¹ˆà¸‡',
          lastUpdate: new Date().toISOString(),
          history: [
            { timestamp: new Date(Date.now() - 86400000).toISOString(), status: 'à¸£à¸±à¸šà¹€à¸‚à¹‰à¸²à¸£à¸°à¸šà¸š', location: 'à¸¨à¸›.EMS', description: 'à¸£à¸±à¸šà¸–à¸¸à¸‡' },
            { timestamp: new Date().toISOString(), status: 'à¸­à¸¢à¸¹à¹ˆà¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡à¸à¸²à¸£à¸‚à¸™à¸ªà¹ˆà¸‡', location: 'à¸¨à¸›.à¸à¸£à¸¸à¸‡à¹€à¸—à¸ž', description: 'à¸ªà¹ˆà¸‡à¸­à¸­à¸à¸ˆà¸²à¸ à¸¨à¸›.' }
          ]
        };
      }

      const token = await getThaiPostToken();
      const response = await fetch('https://trackapi.thailandpost.co.th/post/api/v1/track', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: 'all',
          language: 'TH',
          barcode: [trackingNo]
        })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch tracking data');
      }

      const data = (await response.json()) as ThaiPostTrackingResponse;
      const trackData = data.response.items[trackingNo];

      if (!trackData || trackData.length === 0) {
        return {
          provider: 'Thai Post / EMS',
          trackingNo,
          status: 'UNKNOWN',
          statusText: 'à¹„à¸¡à¹ˆà¸žà¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥',
          lastUpdate: new Date().toISOString(),
          history: []
        };
      }

      const history = trackData.map((event) => ({
        timestamp: event.status_date,
        status: event.status_description,
        location: event.location,
        description: event.status_detail
      }));

      const latest = trackData[trackData.length - 1];

      return {
        provider: 'Thai Post / EMS',
        trackingNo,
        status: latest.status_description === 'à¸™à¸³à¸ˆà¹ˆà¸²à¸¢à¸ªà¸³à¹€à¸£à¹‡à¸ˆ' ? 'DELIVERED' : 'IN_TRANSIT',
        statusText: latest.status_description,
        lastUpdate: latest.status_date,
        history
      };
    } catch (error) {
      console.error('ThaiPost Tracking Error:', error);
      throw error;
    }
  }
};
