// Test the schema by executing it directly without splitting
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pool = new Pool({
  connectionString: 'postgresql://actual_user:1234567890@localhost:5432/actual'
});

async function testDirectExecution() {
  console.log('🧪 Testing Direct Schema Execution\n');
  
  const client = await pool.connect();
  
  try {
    // Clean up first  
    console.log('🧹 Cleaning up...');
    await client.query('DROP TABLE IF EXISTS payees CASCADE');
    await client.query('DROP TABLE IF EXISTS accounts CASCADE');
    await client.query('DROP TABLE IF EXISTS categories CASCADE');
    await client.query('DROP TABLE IF EXISTS category_groups CASCADE');
    
    const schemaPath = join(__dirname, 'packages/loot-core/src/platform/server/postgres/schema.sql');
    const schemaSql = readFileSync(schemaPath, 'utf8');
    
    console.log('📄 Executing entire schema as one statement...');
    await client.query(schemaSql);
    
    console.log('✅ Schema executed successfully!');
    
    // Verify core tables exist
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name IN ('accounts', 'payees', 'categories', 'transactions')
      ORDER BY table_name
    `);
    
    console.log('✅ Core tables found:', tablesResult.rows.map(r => r.table_name));
    
    if (tablesResult.rows.length === 4) {
      console.log('🎉 All expected tables created successfully!');
      
      // Test a simple insert to verify functionality
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO accounts (id, name, offbudget, closed, sort_order, tombstone)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, ['test-account', 'Test Account', 0, 0, 1000.0, 0]);
      
      const result = await client.query('SELECT * FROM accounts WHERE id = $1', ['test-account']);
      console.log('✅ Test insert successful:', result.rows[0].name);
      
      await client.query('ROLLBACK');
    }
    
  } catch (error) {
    console.error('❌ Schema execution failed:', error.message);
    console.error('Error details:', error.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

testDirectExecution();