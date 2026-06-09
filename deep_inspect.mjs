import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

async function deepInspect() {
  try {
    console.log("--- Inventory Table Schema ---");
    const invCols = await sql`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'inventory'
    `;
    console.table(invCols);

    console.log("\n--- Checking for empty strings in ALL columns of inventory ---");
    const inventory = await sql`SELECT * FROM inventory`;
    inventory.forEach((row, i) => {
        Object.entries(row).forEach(([col, val]) => {
            if (val === '') {
                console.log(`Row ${i} (ID: ${row.id || 'N/A'}, Item: ${row.item_id}): Column ${col} is an EMPTY STRING`);
            }
        });
    });

    console.log("\n--- Checking for empty strings in logs ---");
    const logs = await sql`SELECT * FROM logs LIMIT 100`;
    logs.forEach((row, i) => {
        Object.entries(row).forEach(([col, val]) => {
            if (val === '') {
                console.log(`Log Row ${i} (ID: ${row.id}): Column ${col} is an EMPTY STRING`);
            }
        });
    });

  } catch (error) {
    console.error('Deep inspection failed:', error);
  }
}

deepInspect();
