// Comprehensive End-to-End PostgreSQL Integration Test Suite
// @ts-strict-ignore

import { v4 as uuidv4 } from 'uuid';
import * as fs from '../../platform/server/fs';
import {
  getDatabaseAdapter,
  setDatabaseAdapter,
  switchDatabaseAdapter,
  openDatabase,
  closeDatabase,
  runQuery,
  transaction,
  getDatabaseStatus,
  all,
  first,
  run,
} from './index';
import {
  getDatabaseConfig,
  isPostgresEnabled,
  getConfigSummary,
} from './config';
import {
  performDatabaseHealthCheck,
  quickHealthCheck,
  DatabaseHealthMonitor,
} from './health';
import {
  migrateFromSqliteToPostgres,
  createSqliteBackup,
  MigrationProgress,
} from './migration';
import {
  initializePostgresIntegration,
  switchToPostgres,
  switchToSqlite,
  getIntegrationStatus,
} from './postgres-integration';
import { batchMessages, applyMessages, receiveMessages } from '../sync';
import { Timestamp } from '@actual-app/crdt';

export interface E2ETestResult {
  testSuite: string;
  testName: string;
  status: 'pass' | 'fail' | 'skip';
  duration: number;
  message: string;
  error?: string;
  details?: any;
}

export interface E2ETestSuite {
  name: string;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
  tests: E2ETestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
}

export interface E2ETestEnvironment {
  testDbPath: string;
  backupPath?: string;
  postgresAvailable: boolean;
  originalAdapter: string;
  testData: {
    accounts: any[];
    categories: any[];
    transactions: any[];
    crdtMessages: any[];
  };
}

/**
 * Test runner with comprehensive error handling and timing
 */
async function runE2ETest(
  testSuite: string,
  testName: string,
  testFn: (env: E2ETestEnvironment) => Promise<void>,
  environment: E2ETestEnvironment,
  skipCondition?: () => boolean,
): Promise<E2ETestResult> {
  const startTime = Date.now();

  if (skipCondition && skipCondition()) {
    return {
      testSuite,
      testName,
      status: 'skip',
      duration: 0,
      message: 'Test skipped due to configuration',
    };
  }

  try {
    await testFn(environment);
    const duration = Date.now() - startTime;

    return {
      testSuite,
      testName,
      status: 'pass',
      duration,
      message: 'Test passed successfully',
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      testSuite,
      testName,
      status: 'fail',
      duration,
      message: `Test failed: ${error.message}`,
      error: error.stack,
    };
  }
}

/**
 * Setup test environment with sample data
 */
async function setupTestEnvironment(): Promise<E2ETestEnvironment> {
  console.log('🔧 Setting up E2E test environment...');

  // Create test database path
  const testDbPath = fs.join(fs.getBudgetDir(), `test_e2e_${Date.now()}.sqlite`);

  // Check PostgreSQL availability
  let postgresAvailable = false;
  try {
    if (isPostgresEnabled()) {
      await setDatabaseAdapter('postgres');
      await openDatabase();
      postgresAvailable = await quickHealthCheck();
      await closeDatabase();
    }
  } catch (error) {
    console.log('PostgreSQL not available for testing:', error.message);
  }

  // Store original adapter
  const originalAdapter = getDatabaseAdapter();

  // Setup SQLite for initial data creation
  await setDatabaseAdapter('sqlite');
  await openDatabase();

  // Create sample test data
  const testData = {
    accounts: [
      {
        id: uuidv4(),
        name: 'Test Checking Account',
        type: 'checking',
        offbudget: 0,
        balance_current: 150000, // $1500.00
        sort_order: 1000,
        tombstone: 0,
      },
      {
        id: uuidv4(),
        name: 'Test Savings Account',
        type: 'savings',
        offbudget: 0,
        balance_current: 500000, // $5000.00
        sort_order: 2000,
        tombstone: 0,
      },
      {
        id: uuidv4(),
        name: 'Test Credit Card',
        type: 'credit',
        offbudget: 0,
        balance_current: -25000, // -$250.00
        sort_order: 3000,
        tombstone: 0,
      },
    ],
    categories: [
      {
        id: uuidv4(),
        name: 'Groceries',
        cat_group: 'test-group-1',
        is_income: 0,
        sort_order: 1000,
        tombstone: 0,
      },
      {
        id: uuidv4(),
        name: 'Transportation',
        cat_group: 'test-group-1',
        is_income: 0,
        sort_order: 2000,
        tombstone: 0,
      },
      {
        id: uuidv4(),
        name: 'Salary',
        cat_group: 'test-group-2',
        is_income: 1,
        sort_order: 1000,
        tombstone: 0,
      },
    ],
    transactions: [
      {
        id: uuidv4(),
        acct: '', // Will be set to test account ID
        amount: -5000, // -$50.00
        description: 'Grocery Store Purchase',
        date: 20241201,
        category: '', // Will be set to groceries category ID
        cleared: 1,
        tombstone: 0,
      },
      {
        id: uuidv4(),
        acct: '', // Will be set to test account ID
        amount: -12000, // -$120.00
        description: 'Gas Station',
        date: 20241202,
        category: '', // Will be set to transportation category ID
        cleared: 1,
        tombstone: 0,
      },
      {
        id: uuidv4(),
        acct: '', // Will be set to test account ID
        amount: 250000, // $2500.00
        description: 'Monthly Salary',
        date: 20241201,
        category: '', // Will be set to salary category ID
        cleared: 1,
        tombstone: 0,
      },
    ],
    crdtMessages: [], // Will be populated during CRDT tests
  };

  // Set account and category references
  testData.transactions[0].acct = testData.accounts[0].id;
  testData.transactions[1].acct = testData.accounts[0].id;
  testData.transactions[2].acct = testData.accounts[1].id;
  testData.transactions[0].category = testData.categories[0].id;
  testData.transactions[1].category = testData.categories[1].id;
  testData.transactions[2].category = testData.categories[2].id;

  // Insert test data into SQLite
  await transaction(async () => {
    // Insert accounts
    for (const account of testData.accounts) {
      await runQuery(
        'INSERT INTO accounts (id, name, type, offbudget, balance_current, sort_order, tombstone) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [account.id, account.name, account.type, account.offbudget, account.balance_current, account.sort_order, account.tombstone],
      );
    }

    // Create category group
    await runQuery(
      'INSERT INTO category_groups (id, name, is_income, sort_order, tombstone) VALUES (?, ?, ?, ?, ?)',
      ['test-group-1', 'Test Group 1', 0, 1000, 0],
    );
    await runQuery(
      'INSERT INTO category_groups (id, name, is_income, sort_order, tombstone) VALUES (?, ?, ?, ?, ?)',
      ['test-group-2', 'Test Group 2', 1, 2000, 0],
    );

    // Insert categories
    for (const category of testData.categories) {
      await runQuery(
        'INSERT INTO categories (id, name, cat_group, is_income, sort_order, tombstone) VALUES (?, ?, ?, ?, ?, ?)',
        [category.id, category.name, category.cat_group, category.is_income, category.sort_order, category.tombstone],
      );
    }

    // Insert transactions
    for (const transaction of testData.transactions) {
      await runQuery(
        'INSERT INTO transactions (id, acct, amount, description, date, category, cleared, tombstone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [transaction.id, transaction.acct, transaction.amount, transaction.description, transaction.date, transaction.category, transaction.cleared, transaction.tombstone],
      );
    }
  });

  await closeDatabase();

  console.log('✅ E2E test environment setup complete');
  console.log(`📊 Test data: ${testData.accounts.length} accounts, ${testData.categories.length} categories, ${testData.transactions.length} transactions`);
  console.log(`🐘 PostgreSQL available: ${postgresAvailable}`);

  return {
    testDbPath,
    postgresAvailable,
    originalAdapter,
    testData,
  };
}

/**
 * Cleanup test environment
 */
async function cleanupTestEnvironment(env: E2ETestEnvironment): Promise<void> {
  try {
    await closeDatabase();
    
    // Restore original adapter
    await setDatabaseAdapter(env.originalAdapter as any);
    
    // Cleanup test files
    if (env.testDbPath && fs.existsSync(env.testDbPath)) {
      await fs.removeFile(env.testDbPath);
    }
    
    if (env.backupPath && fs.existsSync(env.backupPath)) {
      await fs.removeFile(env.backupPath);
    }
    
    console.log('🧹 E2E test environment cleaned up');
  } catch (error) {
    console.warn('⚠️ Cleanup warning:', error.message);
  }
}

/**
 * Test Suite 1: Basic Adapter Switching
 */
export async function testAdapterSwitching(env: E2ETestEnvironment): Promise<E2ETestSuite> {
  console.log('🧪 Running Adapter Switching Tests...');
  
  const tests: E2ETestResult[] = [];
  
  // Test 1: SQLite adapter initialization
  tests.push(await runE2ETest('Adapter Switching', 'SQLite Initialization', async (env) => {
    await setDatabaseAdapter('sqlite');
    await openDatabase();
    
    const adapter = getDatabaseAdapter();
    if (adapter !== 'sqlite') {
      throw new Error(`Expected sqlite, got ${adapter}`);
    }
    
    const status = await getDatabaseStatus();
    if (!status.initialized) {
      throw new Error('SQLite should be initialized');
    }
    
    // Test basic query
    const result = await runQuery('SELECT COUNT(*) as count FROM accounts', [], true) as { count: number }[];
    if (result[0].count !== 3) {
      throw new Error(`Expected 3 accounts, got ${result[0].count}`);
    }
    
    await closeDatabase();
  }, env));
  
  // Test 2: PostgreSQL adapter initialization
  tests.push(await runE2ETest('Adapter Switching', 'PostgreSQL Initialization', async (env) => {
    await setDatabaseAdapter('postgres');
    await openDatabase();
    
    const adapter = getDatabaseAdapter();
    if (adapter !== 'postgres') {
      throw new Error(`Expected postgres, got ${adapter}`);
    }
    
    const status = await getDatabaseStatus();
    if (!status.initialized) {
      throw new Error('PostgreSQL should be initialized');
    }
    
    // Test basic query
    const result = await runQuery('SELECT 1 as test', [], true) as { test: number }[];
    if (result[0].test !== 1) {
      throw new Error('PostgreSQL connectivity test failed');
    }
    
    await closeDatabase();
  }, env, () => !env.postgresAvailable));
  
  // Test 3: Runtime adapter switching
  tests.push(await runE2ETest('Adapter Switching', 'Runtime Switching', async (env) => {
    // Start with SQLite
    await switchDatabaseAdapter('sqlite');
    await openDatabase();
    
    let adapter = getDatabaseAdapter();
    if (adapter !== 'sqlite') {
      throw new Error(`Expected sqlite, got ${adapter}`);
    }
    
    await closeDatabase();
    
    // Switch to PostgreSQL
    await switchDatabaseAdapter('postgres');
    await openDatabase();
    
    adapter = getDatabaseAdapter();
    if (adapter !== 'postgres') {
      throw new Error(`Expected postgres, got ${adapter}`);
    }
    
    await closeDatabase();
    
    // Switch back to SQLite
    await switchDatabaseAdapter('sqlite');
    await openDatabase();
    
    adapter = getDatabaseAdapter();
    if (adapter !== 'sqlite') {
      throw new Error(`Expected sqlite, got ${adapter}`);
    }
    
    await closeDatabase();
  }, env, () => !env.postgresAvailable));
  
  const summary = {
    total: tests.length,
    passed: tests.filter(t => t.status === 'pass').length,
    failed: tests.filter(t => t.status === 'fail').length,
    skipped: tests.filter(t => t.status === 'skip').length,
    duration: tests.reduce((sum, t) => sum + t.duration, 0),
  };
  
  return {
    name: 'Adapter Switching',
    tests,
    summary,
  };
}

/**
 * Test Suite 2: Data Migration
 */
export async function testDataMigration(env: E2ETestEnvironment): Promise<E2ETestSuite> {
  console.log('🧪 Running Data Migration Tests...');
  
  const tests: E2ETestResult[] = [];
  
  // Test 1: Backup creation
  tests.push(await runE2ETest('Data Migration', 'Backup Creation', async (env) => {
    env.backupPath = await createSqliteBackup();
    
    if (!env.backupPath || !fs.existsSync(env.backupPath)) {
      throw new Error('Backup file was not created');
    }
    
    // Verify backup contains data
    const { openDatabase: openSqliteDb } = await import('../../platform/server/sqlite');
    const backupDb = await openSqliteDb(env.backupPath);
    
    try {
      const { runQuery: runSqliteQuery } = await import('../../platform/server/sqlite');
      const result = runSqliteQuery(backupDb, 'SELECT COUNT(*) as count FROM accounts', [], true) as { count: number }[];
      
      if (result[0].count !== 3) {
        throw new Error(`Backup should contain 3 accounts, got ${result[0].count}`);
      }
    } finally {
      const { closeDatabase: closeSqliteDb } = await import('../../platform/server/sqlite');
      await closeSqliteDb(backupDb);
    }
  }, env));
  
  // Test 2: Migration dry run
  tests.push(await runE2ETest('Data Migration', 'Migration Dry Run', async (env) => {
    const result = await migrateFromSqliteToPostgres({
      dryRun: true,
      batchSize: 10,
      validateData: false,
    });
    
    if (!result.success) {
      throw new Error(`Dry run failed: ${result.errors.join(', ')}`);
    }
    
    if (result.migratedTables.length === 0) {
      throw new Error('Dry run should report tables to migrate');
    }
  }, env, () => !env.postgresAvailable));
  
  // Test 3: Full migration
  tests.push(await runE2ETest('Data Migration', 'Full Migration', async (env) => {
    let progressCalls = 0;
    
    const result = await migrateFromSqliteToPostgres({
      batchSize: 10,
      validateData: true,
      onProgress: (progress: MigrationProgress) => {
        progressCalls++;
        console.log(`Migration progress: ${progress.completedTables}/${progress.totalTables} tables`);
      },
    });
    
    if (!result.success) {
      throw new Error(`Migration failed: ${result.errors.join(', ')}`);
    }
    
    if (result.migratedTables.length === 0) {
      throw new Error('No tables were migrated');
    }
    
    if (progressCalls === 0) {
      throw new Error('Progress callback was not called');
    }
    
    // Verify data in PostgreSQL
    await setDatabaseAdapter('postgres');
    await openDatabase();
    
    const accountCount = await runQuery('SELECT COUNT(*) as count FROM accounts', [], true) as { count: number }[];
    if (parseInt(accountCount[0].count.toString()) !== 3) {
      throw new Error(`Expected 3 accounts in PostgreSQL, got ${accountCount[0].count}`);
    }
    
    const transactionCount = await runQuery('SELECT COUNT(*) as count FROM transactions', [], true) as { count: number }[];
    if (parseInt(transactionCount[0].count.toString()) !== 3) {
      throw new Error(`Expected 3 transactions in PostgreSQL, got ${transactionCount[0].count}`);
    }
    
    await closeDatabase();
  }, env, () => !env.postgresAvailable));
  
  const summary = {
    total: tests.length,
    passed: tests.filter(t => t.status === 'pass').length,
    failed: tests.filter(t => t.status === 'fail').length,
    skipped: tests.filter(t => t.status === 'skip').length,
    duration: tests.reduce((sum, t) => sum + t.duration, 0),
  };
  
  return {
    name: 'Data Migration',
    tests,
    summary,
  };
}

/**
 * Test Suite 3: CRDT Sync Operations
 */
export async function testCRDTSync(env: E2ETestEnvironment): Promise<E2ETestSuite> {
  console.log('🧪 Running CRDT Sync Tests...');
  
  const tests: E2ETestResult[] = [];
  
  // Test 1: CRDT message application in SQLite
  tests.push(await runE2ETest('CRDT Sync', 'SQLite CRDT Messages', async (env) => {
    await setDatabaseAdapter('sqlite');
    await openDatabase();
    
    const testMessages = [
      {
        dataset: 'accounts',
        row: uuidv4(),
        column: 'name',
        value: 'New Test Account',
        timestamp: Timestamp.send(),
      },
      {
        dataset: 'accounts',
        row: env.testData.accounts[0].id,
        column: 'name',
        value: 'Updated Account Name',
        timestamp: Timestamp.send(),
      },
    ];
    
    // Apply CRDT messages
    await receiveMessages(testMessages);
    
    // Verify changes
    const result = await runQuery('SELECT COUNT(*) as count FROM accounts WHERE tombstone = 0', [], true) as { count: number }[];
    if (result[0].count !== 4) { // 3 original + 1 new
      throw new Error(`Expected 4 accounts after CRDT update, got ${result[0].count}`);
    }
    
    const updatedAccount = await runQuery(
      'SELECT name FROM accounts WHERE id = ?', 
      [env.testData.accounts[0].id], 
      true
    ) as { name: string }[];
    
    if (updatedAccount[0].name !== 'Updated Account Name') {
      throw new Error(`Account name not updated via CRDT: ${updatedAccount[0].name}`);
    }
    
    env.testData.crdtMessages = testMessages;
    await closeDatabase();
  }, env));
  
  // Test 2: CRDT message application in PostgreSQL
  tests.push(await runE2ETest('CRDT Sync', 'PostgreSQL CRDT Messages', async (env) => {
    await setDatabaseAdapter('postgres');
    await openDatabase();
    
    // Apply the same CRDT messages
    await receiveMessages(env.testData.crdtMessages);
    
    // Verify changes in PostgreSQL
    const result = await runQuery('SELECT COUNT(*) as count FROM accounts WHERE tombstone = 0', [], true) as { count: number }[];
    if (parseInt(result[0].count.toString()) !== 4) { // 3 original + 1 new
      throw new Error(`Expected 4 accounts in PostgreSQL after CRDT update, got ${result[0].count}`);
    }
    
    const updatedAccount = await runQuery(
      'SELECT name FROM accounts WHERE id = $1', 
      [env.testData.accounts[0].id], 
      true
    ) as { name: string }[];
    
    if (updatedAccount[0].name !== 'Updated Account Name') {
      throw new Error(`Account name not updated via CRDT in PostgreSQL: ${updatedAccount[0].name}`);
    }
    
    await closeDatabase();
  }, env, () => !env.postgresAvailable));
  
  // Test 3: Cross-adapter CRDT consistency
  tests.push(await runE2ETest('CRDT Sync', 'Cross-Adapter Consistency', async (env) => {
    // Create new CRDT message in SQLite
    await setDatabaseAdapter('sqlite');
    await openDatabase();
    
    const crossAdapterMessage = [
      {
        dataset: 'transactions',
        row: uuidv4(),
        column: 'description',
        value: 'Cross-Adapter Test Transaction',
        timestamp: Timestamp.send(),
      },
    ];
    
    await receiveMessages(crossAdapterMessage);
    
    const sqliteResult = await runQuery('SELECT COUNT(*) as count FROM transactions WHERE description LIKE ?', ['%Cross-Adapter%'], true) as { count: number }[];
    
    await closeDatabase();
    
    // Apply same message in PostgreSQL
    await setDatabaseAdapter('postgres');
    await openDatabase();
    
    await receiveMessages(crossAdapterMessage);
    
    const postgresResult = await runQuery('SELECT COUNT(*) as count FROM transactions WHERE description LIKE $1', ['%Cross-Adapter%'], true) as { count: number }[];
    
    await closeDatabase();
    
    // Verify consistency
    if (sqliteResult[0].count !== parseInt(postgresResult[0].count.toString())) {
      throw new Error(`CRDT consistency failure: SQLite=${sqliteResult[0].count}, PostgreSQL=${postgresResult[0].count}`);
    }
  }, env, () => !env.postgresAvailable));
  
  const summary = {
    total: tests.length,
    passed: tests.filter(t => t.status === 'pass').length,
    failed: tests.filter(t => t.status === 'fail').length,
    skipped: tests.filter(t => t.status === 'skip').length,
    duration: tests.reduce((sum, t) => sum + t.duration, 0),
  };
  
  return {
    name: 'CRDT Sync',
    tests,
    summary,
  };
}

/**
 * Test Suite 4: Integration API
 */
export async function testIntegrationAPI(env: E2ETestEnvironment): Promise<E2ETestSuite> {
  console.log('🧪 Running Integration API Tests...');
  
  const tests: E2ETestResult[] = [];
  
  // Test 1: Integration status
  tests.push(await runE2ETest('Integration API', 'Integration Status', async (env) => {
    const status = await getIntegrationStatus();
    
    if (!status.sqlite.available) {
      throw new Error('SQLite should always be available');
    }
    
    if (env.postgresAvailable && !status.postgres.enabled) {
      throw new Error('PostgreSQL should be enabled when available');
    }
    
    if (status.adapter !== 'sqlite' && status.adapter !== 'postgres') {
      throw new Error(`Invalid adapter in status: ${status.adapter}`);
    }
  }, env));
  
  // Test 2: PostgreSQL integration initialization
  tests.push(await runE2ETest('Integration API', 'PostgreSQL Integration Init', async (env) => {
    const result = await initializePostgresIntegration({
      testConnection: true,
      runHealthChecks: true,
      autoMigrate: false,
      createBackup: false,
    });
    
    if (!result.success) {
      throw new Error(`Integration init failed: ${result.errors.join(', ')}`);
    }
    
    if (result.adapter !== 'postgres') {
      throw new Error(`Expected postgres adapter, got ${result.adapter}`);
    }
  }, env, () => !env.postgresAvailable));
  
  // Test 3: Graceful switching
  tests.push(await runE2ETest('Integration API', 'Graceful Switching', async (env) => {
    // Switch to PostgreSQL
    const pgResult = await switchToPostgres({
      createBackup: false,
      migrateData: false,
    });
    
    if (!pgResult.success) {
      throw new Error(`Switch to PostgreSQL failed: ${pgResult.errors.join(', ')}`);
    }
    
    // Switch back to SQLite
    const sqliteResult = await switchToSqlite();
    
    if (!sqliteResult.success) {
      throw new Error(`Switch to SQLite failed: ${sqliteResult.errors.join(', ')}`);
    }
    
    if (sqliteResult.adapter !== 'sqlite') {
      throw new Error(`Expected sqlite adapter after switch, got ${sqliteResult.adapter}`);
    }
  }, env, () => !env.postgresAvailable));
  
  const summary = {
    total: tests.length,
    passed: tests.filter(t => t.status === 'pass').length,
    failed: tests.filter(t => t.status === 'fail').length,
    skipped: tests.filter(t => t.status === 'skip').length,
    duration: tests.reduce((sum, t) => sum + t.duration, 0),
  };
  
  return {
    name: 'Integration API',
    tests,
    summary,
  };
}

/**
 * Test Suite 5: Health Monitoring
 */
export async function testHealthMonitoring(env: E2ETestEnvironment): Promise<E2ETestSuite> {
  console.log('🧪 Running Health Monitoring Tests...');
  
  const tests: E2ETestResult[] = [];
  
  // Test 1: SQLite health checks
  tests.push(await runE2ETest('Health Monitoring', 'SQLite Health Checks', async (env) => {
    await setDatabaseAdapter('sqlite');
    await openDatabase();
    
    const isHealthy = await quickHealthCheck();
    if (!isHealthy) {
      throw new Error('SQLite quick health check failed');
    }
    
    const health = await performDatabaseHealthCheck();
    if (health.overall === 'unhealthy') {
      throw new Error(`SQLite comprehensive health check failed: ${health.summary.failed} checks failed`);
    }
    
    if (health.adapter !== 'sqlite') {
      throw new Error(`Health check adapter mismatch: expected sqlite, got ${health.adapter}`);
    }
    
    await closeDatabase();
  }, env));
  
  // Test 2: PostgreSQL health checks
  tests.push(await runE2ETest('Health Monitoring', 'PostgreSQL Health Checks', async (env) => {
    await setDatabaseAdapter('postgres');
    await openDatabase();
    
    const isHealthy = await quickHealthCheck();
    if (!isHealthy) {
      throw new Error('PostgreSQL quick health check failed');
    }
    
    const health = await performDatabaseHealthCheck();
    if (health.overall === 'unhealthy') {
      throw new Error(`PostgreSQL comprehensive health check failed: ${health.summary.failed} checks failed`);
    }
    
    if (health.adapter !== 'postgres') {
      throw new Error(`Health check adapter mismatch: expected postgres, got ${health.adapter}`);
    }
    
    await closeDatabase();
  }, env, () => !env.postgresAvailable));
  
  // Test 3: Health monitoring
  tests.push(await runE2ETest('Health Monitoring', 'Continuous Monitoring', async (env) => {
    await setDatabaseAdapter('sqlite');
    await openDatabase();
    
    let healthCallbacks = 0;
    const monitor = new DatabaseHealthMonitor((health) => {
      healthCallbacks++;
      console.log(`Health callback ${healthCallbacks}: ${health.overall}`);
    });
    
    // Start monitoring with short interval for testing
    monitor.start(1000);
    
    // Wait for at least 2 health checks
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    monitor.stop();
    
    if (healthCallbacks < 2) {
      throw new Error(`Expected at least 2 health callbacks, got ${healthCallbacks}`);
    }
    
    const lastHealth = monitor.getLastHealth();
    if (!lastHealth) {
      throw new Error('Monitor should have recorded health status');
    }
    
    await closeDatabase();
  }, env));
  
  const summary = {
    total: tests.length,
    passed: tests.filter(t => t.status === 'pass').length,
    failed: tests.filter(t => t.status === 'fail').length,
    skipped: tests.filter(t => t.status === 'skip').length,
    duration: tests.reduce((sum, t) => sum + t.duration, 0),
  };
  
  return {
    name: 'Health Monitoring',
    tests,
    summary,
  };
}

/**
 * Run complete end-to-end test suite
 */
export async function runCompleteE2ETest(): Promise<{
  suites: E2ETestSuite[];
  environment: E2ETestEnvironment;
  summary: {
    totalTests: number;
    totalPassed: number;
    totalFailed: number;
    totalSkipped: number;
    totalDuration: number;
    overallStatus: 'pass' | 'fail';
  };
}> {
  console.log('🚀 Starting Comprehensive PostgreSQL E2E Test Suite...');
  console.log('📋 Configuration:', getConfigSummary());
  
  let environment: E2ETestEnvironment;
  const suites: E2ETestSuite[] = [];
  
  try {
    // Setup test environment
    environment = await setupTestEnvironment();
    
    // Run all test suites
    suites.push(await testAdapterSwitching(environment));
    suites.push(await testDataMigration(environment));
    suites.push(await testCRDTSync(environment));
    suites.push(await testIntegrationAPI(environment));
    suites.push(await testHealthMonitoring(environment));
    
  } catch (error) {
    console.error('❌ E2E test setup failed:', error);
    throw error;
  } finally {
    // Cleanup
    if (environment!) {
      await cleanupTestEnvironment(environment);
    }
  }
  
  // Calculate overall summary
  const summary = {
    totalTests: suites.reduce((sum, s) => sum + s.summary.total, 0),
    totalPassed: suites.reduce((sum, s) => sum + s.summary.passed, 0),
    totalFailed: suites.reduce((sum, s) => sum + s.summary.failed, 0),
    totalSkipped: suites.reduce((sum, s) => sum + s.summary.skipped, 0),
    totalDuration: suites.reduce((sum, s) => sum + s.summary.duration, 0),
    overallStatus: 'pass' as 'pass' | 'fail',
  };
  
  summary.overallStatus = summary.totalFailed === 0 ? 'pass' : 'fail';
  
  // Print detailed results
  console.log('\n📊 End-to-End Test Results:');
  for (const suite of suites) {
    const status = suite.summary.failed === 0 ? '✅' : '❌';
    console.log(`  ${status} ${suite.name}: ${suite.summary.passed}/${suite.summary.total} passed (${suite.summary.duration}ms)`);
    
    // Show failed tests
    const failedTests = suite.tests.filter(t => t.status === 'fail');
    for (const test of failedTests) {
      console.log(`    ❌ ${test.testName}: ${test.message}`);
    }
    
    // Show skipped tests
    const skippedTests = suite.tests.filter(t => t.status === 'skip');
    for (const test of skippedTests) {
      console.log(`    ⏭️ ${test.testName}: ${test.message}`);
    }
  }
  
  const overallIcon = summary.overallStatus === 'pass' ? '✅' : '❌';
  console.log(`\n${overallIcon} Overall E2E Results: ${summary.totalPassed}/${summary.totalTests} passed, ${summary.totalSkipped} skipped (${summary.totalDuration}ms)`);
  
  if (summary.totalSkipped > 0) {
    console.log(`ℹ️ ${summary.totalSkipped} tests were skipped due to PostgreSQL not being available`);
    console.log('   To run full tests, ensure PostgreSQL is running and configured');
  }
  
  return { suites, environment: environment!, summary };
}