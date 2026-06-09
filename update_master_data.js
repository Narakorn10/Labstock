import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import axios from 'axios';
import { parse } from 'csv-parse/sync';

const sql = neon(process.env.DATABASE_URL || '');
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1cqq-Hwuqv3bVCpRmGvrE-qls4FvvwqPvepOxYxrEEKo/export?format=csv&gid=1210507178';

async function updateMasterData() {
  console.log('🚀 Fetching CSV from Google Sheets...');
  try {
    const response = await axios.get(SHEET_URL);
    const csvData = response.data;
    
    console.log('✅ CSV Fetched. Parsing data...');
    // Parse CSV, skipping the first line (headers)
    const records = parse(csvData, {
      columns: ['item_id', 'barcode', 'name', 'reagent_type', 'job_type', 'machine_type', 'unit', 'min_threshold', 'weekly_target'],
      skip_empty_lines: true,
      from_line: 2 // Skip header
    });
    
    console.log(`✅ Parsed ${records.length} records. Updating database...`);

    let successCount = 0;
    let errorCount = 0;

    for (const record of records) {
      if (!record.item_id) continue;

      const item_id = record.item_id.trim();
      const barcode = record.barcode.trim() || null;
      const name = record.name.trim();
      const reagent_type = record.reagent_type.trim() || null;
      const job_type = record.job_type.trim() || null;
      const machine_type = record.machine_type.trim() || null;
      const unit = record.unit.trim() || null;
      
      // Parse integers, fallback to 0
      const min_threshold = parseInt(record.min_threshold, 10) || 0;
      const weekly_target = parseInt(record.weekly_target, 10) || 0;

      try {
        await sql`
          INSERT INTO master_data (
            item_id, barcode, name, reagent_type, job_type, machine_type, unit, min_threshold, weekly_target
          ) VALUES (
            ${item_id}, ${barcode}, ${name}, ${reagent_type}, ${job_type}, ${machine_type}, ${unit}, ${min_threshold}, ${weekly_target}
          )
          ON CONFLICT (item_id) DO UPDATE SET
            barcode = EXCLUDED.barcode,
            name = EXCLUDED.name,
            reagent_type = EXCLUDED.reagent_type,
            job_type = EXCLUDED.job_type,
            machine_type = EXCLUDED.machine_type,
            unit = EXCLUDED.unit,
            min_threshold = EXCLUDED.min_threshold,
            weekly_target = EXCLUDED.weekly_target;
        `;
        successCount++;
      } catch (err) {
        console.error(`❌ Failed to upsert item ${item_id}:`, err.message);
        errorCount++;
      }
    }

    console.log(`🎉 Master Data update complete!`);
    console.log(`   - Successfully updated: ${successCount}`);
    console.log(`   - Failed: ${errorCount}`);

  } catch (error) {
    console.error('❌ Failed to update Master Data:', error.message);
  }
}

updateMasterData();
