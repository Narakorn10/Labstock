import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isAdmin } from '@/lib/auth-utils';

export async function GET() {
  try {
    // Fetch all types in parallel for performance
    const [reagentRows, jobRows, machineRows] = await Promise.all([
      sql`SELECT name FROM reagent_types ORDER BY name ASC`,
      sql`SELECT name FROM job_types ORDER BY name ASC`,
      sql`SELECT name FROM machine_types ORDER BY name ASC`
    ]);

    return NextResponse.json({
      reagentTypes: reagentRows.map(r => r.name),
      jobTypes: jobRows.map(r => r.name),
      machineTypes: machineRows.map(r => r.name)
    });
  } catch (error: any) {
    console.error('Settings GET Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await isAdmin(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, type, value } = await request.json();
    
    // Map the type to the correct table name
    const tableMap: Record<string, string> = {
      reagent: 'reagent_types',
      job: 'job_types',
      machine: 'machine_types'
    };

    const tableName = tableMap[type];
    if (!tableName) throw new Error('Invalid type');

    if (action === 'add') {
      // Use direct SQL interpolation from neon (it handles safety)
      // Note: Table names can't be parameterized in standard PG, 
      // but since we use a hardcoded map, it is safe.
      if (tableName === 'reagent_types') {
        await sql`INSERT INTO reagent_types (name) VALUES (${value}) ON CONFLICT (name) DO NOTHING`;
      } else if (tableName === 'job_types') {
        await sql`INSERT INTO job_types (name) VALUES (${value}) ON CONFLICT (name) DO NOTHING`;
      } else if (tableName === 'machine_types') {
        await sql`INSERT INTO machine_types (name) VALUES (${value}) ON CONFLICT (name) DO NOTHING`;
      }
      
      return NextResponse.json({ success: true, message: 'เพิ่มข้อมูลสำเร็จ' });
    } else if (action === 'delete') {
      if (tableName === 'reagent_types') {
        await sql`DELETE FROM reagent_types WHERE name = ${value}`;
      } else if (tableName === 'job_types') {
        await sql`DELETE FROM job_types WHERE name = ${value}`;
      } else if (tableName === 'machine_types') {
        await sql`DELETE FROM machine_types WHERE name = ${value}`;
      }
      
      return NextResponse.json({ success: true, message: 'ลบข้อมูลสำเร็จ' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error: any) {
    console.error('Settings POST Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
