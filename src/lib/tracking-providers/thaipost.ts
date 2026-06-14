import { TrackingProvider } from './index';
import { TrackingResult } from '../line-flex-templates';

// In a real app, you would cache this token until it expires
let cachedToken: string | null = null;
let tokenExpiresAt: number | null = null;

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

  const data = await response.json();
  cachedToken = data.token;
  // Set expiry to a little before actual expiry (e.g. 1 hour)
  tokenExpiresAt = Date.now() + 3500 * 1000; 

  return data.token;
}

export const thaipostProvider: TrackingProvider = {
  name: 'Thai Post / EMS',
  track: async (trackingNo: string): Promise<TrackingResult> => {
    try {
      if (process.env.THAIPOST_API_TOKEN === 'DUMMY' || !process.env.THAIPOST_API_TOKEN) {
        // Mock data for development
        return {
          provider: 'Thai Post / EMS',
          trackingNo,
          status: 'IN_TRANSIT',
          statusText: 'อยู่ระหว่างการขนส่ง',
          lastUpdate: new Date().toISOString(),
          history: [
            { timestamp: new Date(Date.now() - 86400000).toISOString(), status: 'รับเข้าระบบ', location: 'ศป.EMS', description: 'รับถุง' },
            { timestamp: new Date().toISOString(), status: 'อยู่ระหว่างการขนส่ง', location: 'ศป.กรุงเทพ', description: 'ส่งออกจาก ศป.' }
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

      const data = await response.json();
      const trackData = data.response.items[trackingNo];
      
      if (!trackData || trackData.length === 0) {
         return {
          provider: 'Thai Post / EMS',
          trackingNo,
          status: 'UNKNOWN',
          statusText: 'ไม่พบข้อมูล',
          lastUpdate: new Date().toISOString(),
          history: []
        };
      }

      const history = trackData.map((event: any) => ({
        timestamp: event.status_date,
        status: event.status_description,
        location: event.location,
        description: event.status_detail
      }));

      const latest = trackData[trackData.length - 1];

      return {
        provider: 'Thai Post / EMS',
        trackingNo,
        status: latest.status_description === 'นำจ่ายสำเร็จ' ? 'DELIVERED' : 'IN_TRANSIT',
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
