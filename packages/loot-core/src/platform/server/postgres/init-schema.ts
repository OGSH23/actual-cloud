// @ts-strict-ignore
import { readFile } from '../fs/index.electron';
import { Database } from './index';

/**
 * Initialize PostgreSQL schema for Actual Budget
 * This function creates all necessary tables, indexes, views, and functions
 */
export async function initializePostgresSchema(db: Database): Promise<void> {
  console.log('Initializing PostgreSQL schema for Actual Budget...');
  
  const client = await db.pool.connect();
  
  try {
    // Begin transaction for schema creation
    await client.query('BEGIN');
    
    // Read the schema SQL file
    const schemaPath = require.resolve('./schema.sql');
    const schemaSql = await readFile(schemaPath, 'utf8');
    
    console.log('Creating PostgreSQL schema...');
    
    // Execute the schema creation SQL
    await client.query(schemaSql);
    
    console.log('✅ PostgreSQL schema created successfully');
    
    // Verify schema by checking core tables exist
    const tableCheckResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name IN ('accounts', 'transactions', 'categories', 'payees')
      ORDER BY table_name
    `);
    
    const expectedTables = ['accounts', 'categories', 'payees', 'transactions'];
    const actualTables = tableCheckResult.rows.map(row => row.table_name).sort();
    
    console.log('Core tables found:', actualTables);
    
    // Verify all expected tables exist
    const missingTables = expectedTables.filter(table => !actualTables.includes(table));
    if (missingTables.length > 0) {
      throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
    }
    
    // Check custom functions exist
    const functionCheckResult = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
        AND routine_type = 'FUNCTION'
        AND routine_name IN ('unicode_lower', 'unicode_upper', 'unicode_like', 'regexp', 'normalise')
      ORDER BY routine_name
    `);
    
    const expectedFunctions = ['normalise', 'regexp', 'unicode_like', 'unicode_lower', 'unicode_upper'];
    const actualFunctions = functionCheckResult.rows.map(row => row.routine_name).sort();
    
    console.log('Custom functions found:', actualFunctions);
    
    // Verify all expected functions exist
    const missingFunctions = expectedFunctions.filter(func => !actualFunctions.includes(func));
    if (missingFunctions.length > 0) {
      throw new Error(`Missing required functions: ${missingFunctions.join(', ')}`);
    }
    
    // Test custom functions work correctly
    console.log('Testing custom functions...');
    
    // Test UNICODE_LOWER
    const lowerTest = await client.query('SELECT UNICODE_LOWER($1) as result', ['TEST']);
    if (lowerTest.rows[0].result !== 'test') {
      throw new Error('UNICODE_LOWER function not working correctly');
    }
    
    // Test UNICODE_UPPER
    const upperTest = await client.query('SELECT UNICODE_UPPER($1) as result', ['test']);
    if (upperTest.rows[0].result !== 'TEST') {
      throw new Error('UNICODE_UPPER function not working correctly');
    }
    
    // Test UNICODE_LIKE
    const likeTest = await client.query('SELECT UNICODE_LIKE($1, $2) as result', ['test%', 'testing']);
    if (likeTest.rows[0].result !== 1) {
      throw new Error('UNICODE_LIKE function not working correctly');
    }
    
    // Test REGEXP
    const regexpTest = await client.query('SELECT REGEXP($1, $2) as result', ['t.*t', 'test']);
    if (regexpTest.rows[0].result !== 1) {
      throw new Error('REGEXP function not working correctly');
    }
    
    // Test NORMALISE (if unaccent extension is available)
    try {
      const normaliseTest = await client.query('SELECT NORMALISE($1) as result', ['Tëst']);
      if (normaliseTest.rows[0].result !== 'test') {
        console.warn('NORMALISE function may not be working optimally (unaccent extension issues)');
      } else {
        console.log('✅ NORMALISE function working correctly');
      }
    } catch (error) {
      console.warn('NORMALISE function test failed:', error.message);
    }
    
    console.log('✅ All custom functions verified');
    
    // Set up initial data if needed
    await setupInitialData(client);
    
    // Commit the transaction
    await client.query('COMMIT');
    
    console.log('🎉 PostgreSQL schema initialization completed successfully!');
    
  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('❌ PostgreSQL schema initialization failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Set up initial data required for Actual Budget to function
 */
async function setupInitialData(client: any): Promise<void> {
  console.log('Setting up initial data...');
  
  // Check if database is already initialized
  const versionCheck = await client.query('SELECT COUNT(*) as count FROM db_version');
  if (parseInt(versionCheck.rows[0].count) > 0) {
    console.log('Database already has version data, skipping initial setup');
    return;
  }
  
  // Insert initial database version
  await client.query(
    "INSERT INTO db_version (version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
    ['1.0.0']
  );
  
  // Insert initial migration marker
  await client.query(
    "INSERT INTO __migrations__ (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
    [0]
  );
  
  // Insert messages clock if not exists
  await client.query(
    "INSERT INTO messages_clock (id, clock) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [1, '{}']
  );
  
  console.log('✅ Initial data setup completed');
}

/**
 * Check if PostgreSQL schema is properly initialized
 */
export async function isSchemaInitialized(db: Database): Promise<boolean> {
  const client = await db.pool.connect();
  
  try {
    // Check if core tables exist
    const tableCheck = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name IN ('accounts', 'transactions', 'categories', 'payees')
    `);
    
    return parseInt(tableCheck.rows[0].count) === 4;
  } catch (error) {
    return false;
  } finally {
    client.release();
  }
}

/**
 * Drop all Actual Budget tables and views (for development/testing)
 * WARNING: This will delete all data!
 */
export async function dropSchema(db: Database): Promise<void> {
  console.warn('⚠️  Dropping all Actual Budget schema objects...');
  
  const client = await db.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Drop views first (they depend on tables)
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
    
    // Drop tables in reverse dependency order
    const tables = [
      'pending_transactions',
      'transactions',
      'schedules_json_paths',
      'schedules_next_date',
      'schedules',
      'rules',
      'category_mapping',
      'categories',
      'category_groups',
      'payee_mapping',
      'payees',
      'accounts',
      'banks',
      'zero_budgets',
      'reflect_budgets',
      'zero_budget_months',
      'created_budgets',
      'custom_reports',
      'transaction_filters',
      'dashboard',
      'notes',
      'preferences',
      'messages_crdt',
      'messages_clock',
      'spreadsheet_cells',
      'kvcache',
      'kvcache_key',
      '__meta__',
      'db_version',
      '__migrations__'
    ];
    
    for (const table of tables) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    
    await client.query('COMMIT');
    
    console.log('✅ Schema dropped successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to drop schema:', error.message);
    throw error;
  } finally {
    client.release();
  }
}