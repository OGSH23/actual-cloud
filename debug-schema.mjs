// Debug PostgreSQL schema issues
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pool = new Pool({
  connectionString: 'postgresql://actual_user:1234567890@localhost:5432/actual'
});

async function debugSchema() {
  console.log('🔍 Debugging PostgreSQL Schema Issues\n');
  
  const client = await pool.connect();
  
  try {
    const schemaPath = join(__dirname, 'packages/loot-core/src/platform/server/postgres/schema.sql');
    const schemaSql = readFileSync(schemaPath, 'utf8');
    
    // Split schema into statements
    const statements = schemaSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`Found ${statements.length} SQL statements to execute\n`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`\n📝 Executing statement ${i + 1}/${statements.length}:`);
      console.log(statement.substring(0, 100) + (statement.length > 100 ? '...' : ''));
      
      try {
        await client.query(statement);
        console.log(`✅ Statement ${i + 1} executed successfully`);
      } catch (error) {
        console.error(`❌ Statement ${i + 1} failed:`, error.message);
        console.error(`\nFull statement:\n${statement}\n`);
        break;
      }
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

debugSchema();