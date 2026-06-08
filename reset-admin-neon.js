import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const sql = neon(process.env.DATABASE_URL || '');

async function resetAdmin() {
  console.log('🔐 Resetting Admin Password in Neon Database...');
  
  const newPassword = 'admin'; // คุณสามารถเปลี่ยนรหัสผ่านตรงนี้ได้
  const username = 'admin';

  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    const result = await sql`
      UPDATE users 
      SET password_hash = ${hash} 
      WHERE LOWER(username) = LOWER(${username})
      RETURNING username
    `;

    if (result.length > 0) {
      console.log(`✅ Reset password for user "${username}" to "${newPassword}" successfully!`);
    } else {
      console.log(`❌ User "${username}" not found in database.`);
      console.log('💡 Tip: If you need to create the admin user, run the migration.sql script.');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

resetAdmin();
