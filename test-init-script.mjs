// Test the schema initialization script
import { Pool } from 'pg';
import { openDatabase } from './packages/loot-core/src/platform/server/postgres/index.js';
import { initializePostgresSchema, isSchemaInitialized } from './packages/loot-core/src/platform/server/postgres/init-schema.js';

const pool = new Pool({
  connectionString: 'postgresql://actual_user:1234567890@localhost:5432/actual'
});

async function testInitScript() {
  console.log('🧪 Testing PostgreSQL Schema Initialization Script\n');
  
  const client = await pool.connect();
  
  try {
    // Clean up first
    console.log('🧹 Cleaning up existing schema...');
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    
    // Create database object
    const db = { pool };
    
    // Test schema initialization
    console.log('🔨 Running schema initialization...');
    await initializePostgresSchema(db);
    
    // Test schema check
    console.log('🔍 Checking if schema is initialized...');
    const isInitialized = await isSchemaInitialized(db);
    
    if (isInitialized) {
      console.log('✅ Schema initialization successful!');
      
      // Verify initial data
      const versionResult = await client.query('SELECT * FROM db_version');
      console.log('📋 Database version:', versionResult.rows[0]?.version);
      
      const migrationResult = await client.query('SELECT * FROM __migrations__');
      console.log('📋 Migration marker:', migrationResult.rows[0]?.id);
      
      console.log('🎉 All initialization tests passed!');
    } else {
      console.error('❌ Schema not properly initialized');
    }
    
  } catch (error) {
    console.error('❌ Initialization test failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

testInitScript();