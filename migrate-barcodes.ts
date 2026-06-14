import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function runMigration() {
  console.log('🚀 Running migration for barcode_patterns...');
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS barcode_patterns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        regex_pattern TEXT NOT NULL,
        item_id_group INTEGER,
        lot_no_group INTEGER,
        exp_date_group INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;
    console.log('✅ barcode_patterns table created successfully!');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
  }
}

runMigration();
