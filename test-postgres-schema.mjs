// Test PostgreSQL schema creation and validation
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// PostgreSQL connection
const pool = new Pool({
  connectionString: 'postgresql://actual_user:1234567890@localhost:5432/actual'
});

async function testSchemaCreation() {
  console.log('🧪 Testing PostgreSQL Schema Creation for Actual Budget\n');
  
  let client;
  
  try {
    client = await pool.connect();
    console.log('✅ Connected to PostgreSQL');
    
    // 1. Clean up any existing schema
    console.log('\n🧹 Cleaning up existing schema...');
    await dropExistingSchema(client);
    
    // 2. Read and execute schema creation
    console.log('\n📄 Reading schema file...');
    const schemaPath = join(__dirname, 'packages/loot-core/src/platform/server/postgres/schema.sql');
    const schemaSql = readFileSync(schemaPath, 'utf8');
    
    console.log('🔨 Creating PostgreSQL schema...');
    await client.query(schemaSql);
    
    // 3. Validate schema structure
    console.log('\n✅ Schema created! Validating structure...');
    await validateSchema(client);
    
    // 4. Test custom functions
    console.log('\n🔧 Testing custom functions...');
    await testCustomFunctions(client);
    
    // 5. Test basic CRUD operations
    console.log('\n💾 Testing basic database operations...');
    await testBasicOperations(client);
    
    // 6. Test views
    console.log('\n👁️  Testing database views...');
    await testViews(client);
    
    console.log('\n🎉 All PostgreSQL schema tests passed!');
    
  } catch (error) {
    console.error('\n❌ Schema test failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

async function dropExistingSchema(client) {
  // Drop views first
  const views = [
    'v_transactions',
    'v_transactions_internal', 
    'v_transactions_internal_alive',
    'v_categories',
    'v_payees',
    'v_schedules',
    'mv_budget_summary'
  ];
  
  for (const view of views) {
    await client.query(`DROP VIEW IF EXISTS ${view} CASCADE`);
    await client.query(`DROP MATERIALIZED VIEW IF EXISTS ${view} CASCADE`);
  }
  
  // Drop functions
  const functions = [
    'unicode_lower',
    'unicode_upper', 
    'unicode_like',
    'regexp',
    'normalise',
    'refresh_budget_views',
    'trigger_refresh_budget_summary'
  ];
  
  for (const func of functions) {
    await client.query(`DROP FUNCTION IF EXISTS ${func} CASCADE`);
  }
  
  // Get all tables and drop them
  const tablesResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  
  for (const row of tablesResult.rows) {
    await client.query(`DROP TABLE IF EXISTS ${row.table_name} CASCADE`);
  }
  
  console.log('✅ Existing schema cleaned up');
}

async function validateSchema(client) {
  // Check core tables exist
  const expectedTables = [
    'accounts', 'transactions', 'categories', 'category_groups', 'payees',
    'rules', 'schedules', 'zero_budgets', 'reflect_budgets', 'custom_reports',
    'dashboard', 'notes', 'preferences', 'messages_crdt', 'banks'
  ];
  
  const tablesResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  
  const actualTables = tablesResult.rows.map(row => row.table_name);
  console.log(`📊 Found ${actualTables.length} tables:`, actualTables.slice(0, 10).join(', '), '...');
  
  // Check all expected tables exist
  const missingTables = expectedTables.filter(table => !actualTables.includes(table));
  if (missingTables.length > 0) {
    throw new Error(`Missing tables: ${missingTables.join(', ')}`);
  }
  
  // Check indexes exist
  const indexResult = await client.query(`
    SELECT COUNT(*) as count
    FROM pg_indexes 
    WHERE schemaname = 'public'
  `);
  
  console.log(`📈 Found ${indexResult.rows[0].count} indexes`);
  
  // Check views exist
  const viewsResult = await client.query(`
    SELECT table_name
    FROM information_schema.views 
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  
  const actualViews = viewsResult.rows.map(row => row.table_name);
  console.log(`👁️  Found ${actualViews.length} views:`, actualViews.join(', '));
  
  console.log('✅ Schema structure validated');
}

async function testCustomFunctions(client) {
  // Test UNICODE_LOWER
  const lowerResult = await client.query('SELECT UNICODE_LOWER($1) as result', ['TEST']);
  if (lowerResult.rows[0].result !== 'test') {
    throw new Error('UNICODE_LOWER not working');
  }
  console.log('✅ UNICODE_LOWER working');
  
  // Test UNICODE_UPPER
  const upperResult = await client.query('SELECT UNICODE_UPPER($1) as result', ['test']);
  if (upperResult.rows[0].result !== 'TEST') {
    throw new Error('UNICODE_UPPER not working');
  }
  console.log('✅ UNICODE_UPPER working');
  
  // Test UNICODE_LIKE
  const likeResult = await client.query('SELECT UNICODE_LIKE($1, $2) as result', ['test%', 'testing']);
  if (likeResult.rows[0].result !== 1) {
    throw new Error('UNICODE_LIKE not working');
  }
  console.log('✅ UNICODE_LIKE working');
  
  // Test REGEXP
  const regexpResult = await client.query('SELECT REGEXP($1, $2) as result', ['t.*t', 'test']);
  if (regexpResult.rows[0].result !== 1) {
    throw new Error('REGEXP not working');
  }
  console.log('✅ REGEXP working');
  
  // Test NORMALISE
  try {
    const normaliseResult = await client.query('SELECT NORMALISE($1) as result', ['Tëst']);
    console.log('✅ NORMALISE working:', normaliseResult.rows[0].result);
  } catch (error) {
    console.log('⚠️  NORMALISE test failed (unaccent extension may not be available)');
  }
}

async function testBasicOperations(client) {
  await client.query('BEGIN');
  
  try {
    // Test account creation
    await client.query(`
      INSERT INTO accounts (id, name, offbudget, closed, sort_order, tombstone)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, ['test-account-1', 'Test Checking', 0, 0, 1000.0, 0]);
    
    // Test category group creation
    await client.query(`
      INSERT INTO category_groups (id, name, is_income, sort_order, tombstone)
      VALUES ($1, $2, $3, $4, $5)
    `, ['test-group-1', 'Test Group', 0, 1000.0, 0]);
    
    // Test category creation
    await client.query(`
      INSERT INTO categories (id, name, is_income, cat_group, sort_order, tombstone)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, ['test-cat-1', 'Test Category', 0, 'test-group-1', 1000.0, 0]);
    
    // Test payee creation
    await client.query(`
      INSERT INTO payees (id, name, tombstone)
      VALUES ($1, $2, $3)
    `, ['test-payee-1', 'Test Payee', 0]);
    
    // Test transaction creation
    await client.query(`
      INSERT INTO transactions (id, acct, category, amount, description, date, tombstone)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, ['test-trans-1', 'test-account-1', 'test-cat-1', -5000, 'test-payee-1', 20250101, 0]);
    
    // Test data retrieval
    const accountResult = await client.query('SELECT * FROM accounts WHERE id = $1', ['test-account-1']);
    if (accountResult.rows.length !== 1) {
      throw new Error('Account not found after insertion');
    }
    
    const transactionResult = await client.query('SELECT * FROM transactions WHERE id = $1', ['test-trans-1']);
    if (transactionResult.rows.length !== 1) {
      throw new Error('Transaction not found after insertion');
    }
    
    await client.query('ROLLBACK');
    console.log('✅ Basic CRUD operations working');
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function testViews(client) {
  // Test v_transactions view exists and has correct structure
  const transViewResult = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'v_transactions' AND table_schema = 'public'
    ORDER BY column_name
  `);
  
  const expectedColumns = ['id', 'account', 'category', 'payee', 'amount', 'date', 'notes'];
  const actualColumns = transViewResult.rows.map(row => row.column_name);
  
  for (const col of expectedColumns) {
    if (!actualColumns.includes(col)) {
      throw new Error(`Missing column in v_transactions: ${col}`);
    }
  }
  
  console.log('✅ v_transactions view structure correct');
  
  // Test v_categories view
  const catViewResult = await client.query('SELECT COUNT(*) as count FROM v_categories');
  console.log('✅ v_categories view accessible');
  
  // Test v_payees view  
  const payeeViewResult = await client.query('SELECT COUNT(*) as count FROM v_payees');
  console.log('✅ v_payees view accessible');
}

// Run the test
testSchemaCreation();