import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function checkDatabase() {
  const masterReagents = await sql`SELECT DISTINCT reagent_type FROM master_data WHERE reagent_type IS NOT NULL`;
  const masterJobs = await sql`SELECT DISTINCT job_type FROM master_data WHERE job_type IS NOT NULL`;
  const masterMachines = await sql`SELECT DISTINCT machine_type FROM master_data WHERE machine_type IS NOT NULL`;

  const dbReagents = await sql`SELECT name FROM reagent_types`;
  const dbJobs = await sql`SELECT name FROM job_types`;
  const dbMachines = await sql`SELECT name FROM machine_types`;

  console.log("Master Data Reagent Types:", masterReagents.map(r => r.reagent_type));
  console.log("DB Reagent Types:", dbReagents.map(r => r.name));

  console.log("\nMaster Data Job Types:", masterJobs.map(r => r.job_type));
  console.log("DB Job Types:", dbJobs.map(r => r.name));

  console.log("\nMaster Data Machine Types:", masterMachines.map(r => r.machine_type));
  console.log("DB Machine Types:", dbMachines.map(r => r.name));
}

checkDatabase();
