import { TrackingProvider } from './index';
import { TrackingResult } from '../line-flex-templates';
import sql from '@/lib/db';
import { andDept, type DepartmentScope } from '@/lib/scoped-db';

// REQUIRED scope. The runtime check guards the slot against a wrong argument (a user object, a number, undefined...):
// andDept() treats any non-"one" mode as "no filter", which would fail open.
function assertScope(scope: DepartmentScope | undefined): asserts scope is DepartmentScope {
  const mode = (scope as { mode?: unknown } | undefined)?.mode;
  const valid = mode === 'legacy' || mode === 'all' || (mode === 'one' && Number.isInteger((scope as { departmentId?: unknown }).departmentId));
  if (!valid) throw new Error('manualProvider.track requires a DepartmentScope');
}

export const manualProvider: TrackingProvider = {
  name: 'Manual',
  track: async (trackingNo: string, scope: DepartmentScope): Promise<TrackingResult> => {
    assertScope(scope);
    // For manual provider, trackingNo could just be the shipment ID or a manual reference
    // We fetch the shipment status from our database directly
    try {
      const shipments = await sql`
        SELECT s.*, p.po_number, p.vendor 
        FROM shipments s
        LEFT JOIN purchase_orders p ON s.po_number = p.po_number
        WHERE s.tracking_no = ${trackingNo}${andDept(scope, 's')}
      `;

      if (shipments.length === 0) {
        return {
          provider: 'Manual',
          trackingNo,
          status: 'UNKNOWN',
          statusText: 'ไม่พบข้อมูล',
          lastUpdate: new Date().toISOString(),
          history: []
        };
      }

      const shipment = shipments[0];
      
      return {
        provider: 'Manual',
        trackingNo,
        status: shipment.status, // e.g. 'In Transit', 'Received'
        statusText: shipment.status === 'Received' ? 'รับของแล้ว' : 'อยู่ระหว่างการขนส่ง (Vendor อัพเดทเอง)',
        lastUpdate: shipment.updated_at || new Date().toISOString(),
        history: [
          {
            timestamp: shipment.created_at || new Date().toISOString(),
            status: 'Shipped',
            location: shipment.vendor || 'Vendor',
            description: 'ผู้ขายแจ้งจัดส่งสินค้า'
          }
        ]
      };
    } catch (error) {
      console.error('Manual Tracking Error:', error);
      throw error;
    }
  }
};
