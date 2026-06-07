require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function updateSchema() {
  console.log('🚀 Updating database schema for Shipments...');
  try {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS shipments (
        id SERIAL PRIMARY KEY,
        reference_no TEXT,
        vendor TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES master_data(item_id),
        lot_no TEXT NOT NULL,
        exp_date TEXT,
        quantity DECIMAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'In Transit',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        received_at TIMESTAMP WITH TIME ZONE,
        received_by TEXT
      );
    `);
    
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_shipments_vendor ON shipments(vendor);`);
    await sql.query(`CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);`);

    console.log('✅ Shipments table and indexes created successfully!');
  } catch (error) {
    console.error('❌ Schema update failed:', error.message);
  }
}

updateSchema();
