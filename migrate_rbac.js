import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL || '');

async function migrate() {
  console.log('🚀 Starting RBAC Migration...');
  
  try {
    const sqlPath = path.join(process.cwd(), 'upgrade_v4_rbac.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Split by semicolons and filter out empty strings
    const commands = sqlContent
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0);
    
    for (const cmd of commands) {
      console.log(`Executing: ${cmd.substring(0, 50)}...`);
      await sql.query(cmd);
    }
    
    console.log('✅ RBAC Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
