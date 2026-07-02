import { TrackingProvider } from './index';
import { TrackingResult } from '../line-flex-templates';

interface DkshTrackingEvent {
  time: string;
  status: string;
  location: string;
  description: string;
}

interface DkshTrackingResponse {
  status?: string;
  statusText?: string;
  updatedAt?: string;
  events?: DkshTrackingEvent[];
}

export const dkshProvider: TrackingProvider = {
  name: 'DKSH',
  track: async (trackingNo: string): Promise<TrackingResult> => {
    const apiUrl = process.env.DKSH_API_URL;
    const apiKey = process.env.DKSH_API_KEY;

    if (!apiUrl || !apiKey || apiUrl === 'DUMMY') {
      return {
        provider: 'DKSH',
        trackingNo,
        status: 'IN_TRANSIT',
        statusText: 'à¸à¸³à¸¥à¸±à¸‡à¸ˆà¸±à¸”à¸ªà¹ˆà¸‡à¹‚à¸”à¸¢à¸£à¸–à¸«à¹‰à¸­à¸‡à¹€à¸¢à¹‡à¸™',
        lastUpdate: new Date().toISOString(),
        history: [
          { timestamp: new Date(Date.now() - 4000000).toISOString(), status: 'à¹€à¸•à¸£à¸µà¸¢à¸¡à¸ˆà¸±à¸”à¸ªà¹ˆà¸‡', location: 'DKSH Warehouse', description: 'à¸šà¸£à¸£à¸ˆà¸¸à¸ªà¸´à¸™à¸„à¹‰à¸²' },
          { timestamp: new Date().toISOString(), status: 'à¸à¸³à¸¥à¸±à¸‡à¸ˆà¸±à¸”à¸ªà¹ˆà¸‡', location: 'Bangkok', description: 'à¸à¸³à¸¥à¸±à¸‡à¹€à¸”à¸´à¸™à¸—à¸²à¸‡à¹„à¸›à¸ªà¹ˆà¸‡' }
        ]
      };
    }

    try {
      const response = await fetch(`${apiUrl}/tracking/${trackingNo}`, {
        headers: {
          'x-api-key': apiKey
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch DKSH tracking');
      }

      const data = (await response.json()) as DkshTrackingResponse;

      return {
        provider: 'DKSH',
        trackingNo,
        status: data.status || 'UNKNOWN',
        statusText: data.statusText || 'à¹„à¸¡à¹ˆà¸—à¸£à¸²à¸šà¸ªà¸–à¸²à¸™à¸°',
        lastUpdate: data.updatedAt || new Date().toISOString(),
        history: data.events?.map((event) => ({
          timestamp: event.time,
          status: event.status,
          location: event.location,
          description: event.description
        })) || []
      };
    } catch (error) {
      console.error('DKSH Tracking Error:', error);
      throw error;
    }
  }
};
