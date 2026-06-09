import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function fixDatabase() {
  console.log('Fixing Database... Inserting missing types into settings tables.');

  // Insert missing reagent types
  await sql`
    INSERT INTO reagent_types (name)
    SELECT DISTINCT reagent_type FROM master_data 
    WHERE reagent_type IS NOT NULL AND reagent_type != ''
    ON CONFLICT (name) DO NOTHING
  `;

  // Insert missing job types
  await sql`
    INSERT INTO job_types (name)
    SELECT DISTINCT job_type FROM master_data 
    WHERE job_type IS NOT NULL AND job_type != ''
    ON CONFLICT (name) DO NOTHING
  `;

  // Insert missing machine types
  await sql`
    INSERT INTO machine_types (name)
    SELECT DISTINCT machine_type FROM master_data 
    WHERE machine_type IS NOT NULL AND machine_type != ''
    ON CONFLICT (name) DO NOTHING
  `;

  console.log('✅ Fix complete! All missing types have been added.');
}

fixDatabase();
