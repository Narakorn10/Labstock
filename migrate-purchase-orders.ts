import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function runMigration() {
  console.log('🚀 Running migration for purchase_orders...');
  try {
    // purchase_orders table
    await sql`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id SERIAL PRIMARY KEY,
        po_number TEXT UNIQUE NOT NULL,
        vendor TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        note TEXT,
        vendor_note TEXT,
        expected_date DATE,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMPTZ,
        shipped_at TIMESTAMPTZ,
        received_at TIMESTAMPTZ
      );
    `;
    console.log('✅ purchase_orders table created!');

    // purchase_order_items table
    await sql`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id SERIAL PRIMARY KEY,
        po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES master_data(item_id),
        item_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit TEXT NOT NULL,
        received_qty INTEGER DEFAULT 0
      );
    `;
    console.log('✅ purchase_order_items table created!');

    // notification_settings table
    await sql`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT,
        line_user_id TEXT,
        line_display_name TEXT,
        notify_po_created BOOLEAN DEFAULT true,
        notify_po_confirmed BOOLEAN DEFAULT true,
        notify_po_shipped BOOLEAN DEFAULT true,
        notify_po_received BOOLEAN DEFAULT true,
        notify_low_stock BOOLEAN DEFAULT true
      );
    `;
    console.log('✅ notification_settings table created!');

    // Add tracking columns to shipments
    await sql`
      ALTER TABLE shipments 
      ADD COLUMN IF NOT EXISTS po_number TEXT REFERENCES purchase_orders(po_number),
      ADD COLUMN IF NOT EXISTS tracking_no TEXT,
      ADD COLUMN IF NOT EXISTS tracking_provider TEXT,
      ADD COLUMN IF NOT EXISTS tracking_status TEXT,
      ADD COLUMN IF NOT EXISTS tracking_updated_at TIMESTAMPTZ;
    `;
    console.log('✅ shipments table altered with tracking and po_number columns!');
    
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
  }
}

runMigration();
