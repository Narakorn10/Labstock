import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function runMigration() {
  console.log('ðŸš€ Running migration for barcode_patterns...');
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
    console.log('âœ… barcode_patterns table created successfully!');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('âŒ Migration failed:', message);
  }
}

runMigration();
