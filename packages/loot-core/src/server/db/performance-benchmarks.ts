// Performance benchmarking suite for PostgreSQL vs SQLite comparison
// @ts-strict-ignore

import { 
  runQuery, 
  transaction, 
  getDatabaseAdapter, 
  setDatabaseAdapter, 
  switchDatabaseAdapter,
  openDatabase,
  closeDatabase 
} from './index';
import { v4 as uuidv4 } from 'uuid';

export interface BenchmarkResult {
  name: string;
  adapter: string;
  operations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  throughput: number; // operations per second
  memoryUsage?: number;
  details?: any;
}

export interface BenchmarkSuite {
  name: string;
  results: BenchmarkResult[];
  comparison: {
    sqlite: BenchmarkResult;
    postgres: BenchmarkResult;
    performance_ratio: number; // postgres/sqlite performance ratio
    winner: 'sqlite' | 'postgres' | 'tie';
  }[];
}

export interface ComprehensiveBenchmarkResults {
  suites: BenchmarkSuite[];
  summary: {
    totalTests: number;
    sqliteWins: number;
    postgresWins: number;
    ties: number;
    overallWinner: 'sqlite' | 'postgres' | 'tie';
    avgPerformanceRatio: number;
  };
  systemInfo: {
    nodeVersion: string;
    platform: string;
    cpus: number;
    totalMemory: number;
    timestamp: string;
  };
}

/**
 * Run a single benchmark operation with timing
 */
async function runBenchmark(
  name: string,
  operations: number,
  operationFn: () => Promise<void>
): Promise<BenchmarkResult> {
  const adapter = getDatabaseAdapter();
  const times: number[] = [];
  
  console.log(`  🔄 Running ${name} (${operations} operations) on ${adapter}...`);
  
  // Warm up
  for (let i = 0; i < Math.min(5, operations); i++) {
    await operationFn();
  }
  
  // Collect memory usage before
  const memBefore = process.memoryUsage().heapUsed;
  const totalStartTime = Date.now();
  
  // Run benchmark operations
  for (let i = 0; i < operations; i++) {
    const startTime = process.hrtime.bigint();
    await operationFn();
    const endTime = process.hrtime.bigint();
    
    times.push(Number(endTime - startTime) / 1_000_000); // Convert to milliseconds
    
    if (i % Math.max(1, Math.floor(operations / 10)) === 0) {
      const progress = Math.floor((i / operations) * 100);
      process.stdout.write(`\r    Progress: ${progress}%`);
    }
  }
  
  const totalTime = Date.now() - totalStartTime;
  const memAfter = process.memoryUsage().heapUsed;
  
  console.log(`\r    ✅ Completed in ${totalTime}ms`);
  
  return {
    name,
    adapter,
    operations,
    totalTime,
    avgTime: times.reduce((sum, time) => sum + time, 0) / times.length,
    minTime: Math.min(...times),
    maxTime: Math.max(...times),
    throughput: (operations / totalTime) * 1000, // ops per second
    memoryUsage: memAfter - memBefore
  };
}

/**
 * Simple read operations benchmark
 */
export async function benchmarkSimpleReads(): Promise<BenchmarkSuite> {
  console.log('📖 Benchmarking simple read operations...');
  
  const results: BenchmarkResult[] = [];
  const adapters: ('sqlite' | 'postgres')[] = ['sqlite', 'postgres'];
  
  for (const adapter of adapters) {
    await switchDatabaseAdapter(adapter);
    await openDatabase();
    
    // Benchmark: Count all accounts
    results.push(await runBenchmark(
      'Count Accounts',
      100,
      async () => {
        await runQuery('SELECT COUNT(*) FROM accounts WHERE tombstone = 0', [], true);
      }
    ));
    
    // Benchmark: Select all transactions
    results.push(await runBenchmark(
      'Select All Transactions',
      50,
      async () => {
        await runQuery('SELECT * FROM transactions WHERE tombstone = 0 LIMIT 100', [], true);
      }
    ));
    
    // Benchmark: Complex join query
    results.push(await runBenchmark(
      'Complex Join Query',
      30,
      async () => {
        await runQuery(`
          SELECT t.*, a.name as account_name, c.name as category_name, p.name as payee_name
          FROM transactions t
          LEFT JOIN accounts a ON t.acct = a.id
          LEFT JOIN categories c ON t.category = c.id  
          LEFT JOIN payees p ON t.payee = p.id
          WHERE t.tombstone = 0
          ORDER BY t.date DESC
          LIMIT 50
        `, [], true);
      }
    ));
    
    await closeDatabase();
  }
  
  return createBenchmarkSuite('Simple Read Operations', results);
}

/**
 * Write operations benchmark
 */
export async function benchmarkWriteOperations(): Promise<BenchmarkSuite> {
  console.log('✏️ Benchmarking write operations...');
  
  const results: BenchmarkResult[] = [];
  const adapters: ('sqlite' | 'postgres')[] = ['sqlite', 'postgres'];
  
  for (const adapter of adapters) {
    await switchDatabaseAdapter(adapter);
    await openDatabase();
    
    // Benchmark: Insert transactions
    results.push(await runBenchmark(
      'Insert Transactions',
      100,
      async () => {
        const id = uuidv4();
        const accounts = await runQuery('SELECT id FROM accounts LIMIT 1', [], true) as { id: string }[];
        const categories = await runQuery('SELECT id FROM categories LIMIT 1', [], true) as { id: string }[];
        
        await runQuery(
          'INSERT INTO transactions (id, acct, amount, description, date, category, tombstone) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, accounts[0]?.id, -5000, 'Benchmark test transaction', 20241201, categories[0]?.id, 0]
        );
      }
    ));
    
    // Benchmark: Update transactions
    results.push(await runBenchmark(
      'Update Transactions',
      100,
      async () => {
        const transactions = await runQuery('SELECT id FROM transactions WHERE description LIKE ? LIMIT 1', ['%Benchmark%'], true) as { id: string }[];
        if (transactions.length > 0) {
          await runQuery(
            'UPDATE transactions SET amount = ? WHERE id = ?',
            [-6000, transactions[0].id]
          );
        }
      }
    ));
    
    // Benchmark: Transaction with multiple operations
    results.push(await runBenchmark(
      'Transaction Batch Operations',
      20,
      async () => {
        await transaction(async () => {
          for (let i = 0; i < 5; i++) {
            const id = uuidv4();
            const accounts = await runQuery('SELECT id FROM accounts LIMIT 1', [], true) as { id: string }[];
            const categories = await runQuery('SELECT id FROM categories LIMIT 1', [], true) as { id: string }[];
            
            await runQuery(
              'INSERT INTO transactions (id, acct, amount, description, date, category, tombstone) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [id, accounts[0]?.id, -1000, `Batch transaction ${i}`, 20241201, categories[0]?.id, 0]
            );
          }
        });
      }
    ));
    
    await closeDatabase();
  }
  
  return createBenchmarkSuite('Write Operations', results);
}

/**
 * Complex query benchmark
 */
export async function benchmarkComplexQueries(): Promise<BenchmarkSuite> {
  console.log('🔍 Benchmarking complex queries...');
  
  const results: BenchmarkResult[] = [];
  const adapters: ('sqlite' | 'postgres')[] = ['sqlite', 'postgres'];
  
  for (const adapter of adapters) {
    await switchDatabaseAdapter(adapter);
    await openDatabase();
    
    // Benchmark: Aggregation query
    results.push(await runBenchmark(
      'Monthly Spending Analysis',
      20,
      async () => {
        await runQuery(`
          SELECT 
            substr(cast(date as text), 1, 6) as month,
            c.name as category,
            COUNT(*) as transaction_count,
            SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) as total_spent,
            AVG(CASE WHEN amount < 0 THEN -amount ELSE 0 END) as avg_spent
          FROM transactions t
          LEFT JOIN categories c ON t.category = c.id
          WHERE t.tombstone = 0 AND amount < 0
          GROUP BY month, c.name
          ORDER BY month DESC, total_spent DESC
          LIMIT 100
        `, [], true);
      }
    ));
    
    // Benchmark: Account balance calculation
    results.push(await runBenchmark(
      'Account Balance Calculation',
      30,
      async () => {
        await runQuery(`
          SELECT 
            a.name,
            a.balance_current,
            COALESCE(SUM(t.amount), 0) as transaction_total,
            (a.balance_current + COALESCE(SUM(t.amount), 0)) as calculated_balance
          FROM accounts a
          LEFT JOIN transactions t ON a.id = t.acct AND t.tombstone = 0
          WHERE a.tombstone = 0
          GROUP BY a.id, a.name, a.balance_current
          ORDER BY calculated_balance DESC
        `, [], true);
      }
    ));
    
    // Benchmark: Category spending trends
    results.push(await runBenchmark(
      'Category Spending Trends',
      15,
      async () => {
        await runQuery(`
          WITH monthly_spending AS (
            SELECT 
              c.name as category,
              substr(cast(t.date as text), 1, 6) as month,
              SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END) as spent
            FROM transactions t
            JOIN categories c ON t.category = c.id
            WHERE t.tombstone = 0 AND c.is_income = 0
            GROUP BY c.name, month
          )
          SELECT 
            category,
            COUNT(DISTINCT month) as months_with_spending,
            AVG(spent) as avg_monthly_spending,
            MIN(spent) as min_monthly_spending,
            MAX(spent) as max_monthly_spending,
            (MAX(spent) - MIN(spent)) as spending_variance
          FROM monthly_spending
          WHERE spent > 0
          GROUP BY category
          ORDER BY avg_monthly_spending DESC
          LIMIT 20
        `, [], true);
      }
    ));
    
    await closeDatabase();
  }
  
  return createBenchmarkSuite('Complex Queries', results);
}

/**
 * Concurrent operations benchmark
 */
export async function benchmarkConcurrentOperations(): Promise<BenchmarkSuite> {
  console.log('⚡ Benchmarking concurrent operations...');
  
  const results: BenchmarkResult[] = [];
  const adapters: ('sqlite' | 'postgres')[] = ['sqlite', 'postgres'];
  
  for (const adapter of adapters) {
    await switchDatabaseAdapter(adapter);
    await openDatabase();
    
    // Benchmark: Concurrent reads
    results.push(await runBenchmark(
      'Concurrent Read Operations',
      10,
      async () => {
        const promises = [];
        for (let i = 0; i < 5; i++) {
          promises.push(
            runQuery('SELECT COUNT(*) FROM transactions WHERE tombstone = 0', [], true)
          );
        }
        await Promise.all(promises);
      }
    ));
    
    // Benchmark: Mixed read/write operations
    results.push(await runBenchmark(
      'Mixed Read/Write Operations',
      10,
      async () => {
        const promises = [];
        
        // Add some read operations
        for (let i = 0; i < 3; i++) {
          promises.push(
            runQuery('SELECT * FROM accounts WHERE tombstone = 0 LIMIT 5', [], true)
          );
        }
        
        // Add a write operation
        const id = uuidv4();
        const accounts = await runQuery('SELECT id FROM accounts LIMIT 1', [], true) as { id: string }[];
        promises.push(
          runQuery(
            'INSERT INTO transactions (id, acct, amount, description, date, tombstone) VALUES (?, ?, ?, ?, ?, ?)',
            [id, accounts[0]?.id, -1000, 'Concurrent test', 20241201, 0]
          )
        );
        
        await Promise.all(promises);
      }
    ));
    
    await closeDatabase();
  }
  
  return createBenchmarkSuite('Concurrent Operations', results);
}

/**
 * Database switching performance benchmark
 */
export async function benchmarkAdapterSwitching(): Promise<BenchmarkSuite> {
  console.log('🔄 Benchmarking adapter switching performance...');
  
  const results: BenchmarkResult[] = [];
  
  // Benchmark switching from SQLite to PostgreSQL
  results.push(await runBenchmark(
    'Switch SQLite to PostgreSQL',
    5,
    async () => {
      await switchDatabaseAdapter('postgres');
      await openDatabase();
      await closeDatabase();
    }
  ));
  
  // Benchmark switching from PostgreSQL to SQLite
  results.push(await runBenchmark(
    'Switch PostgreSQL to SQLite',
    5,
    async () => {
      await switchDatabaseAdapter('sqlite');
      await openDatabase();
      await closeDatabase();
    }
  ));
  
  // Benchmark rapid switching
  results.push(await runBenchmark(
    'Rapid Adapter Switching',
    10,
    async () => {
      const currentAdapter = getDatabaseAdapter();
      const newAdapter = currentAdapter === 'sqlite' ? 'postgres' : 'sqlite';
      
      await switchDatabaseAdapter(newAdapter);
      await openDatabase();
      await runQuery('SELECT 1', [], true);
      await closeDatabase();
      
      await switchDatabaseAdapter(currentAdapter);
      await openDatabase();
      await closeDatabase();
    }
  ));
  
  return createBenchmarkSuite('Adapter Switching', results);
}

/**
 * Create a benchmark suite with comparison analysis
 */
function createBenchmarkSuite(name: string, results: BenchmarkResult[]): BenchmarkSuite {
  const suite: BenchmarkSuite = {
    name,
    results,
    comparison: []
  };
  
  // Group results by operation name
  const resultsByOperation = new Map<string, BenchmarkResult[]>();
  
  for (const result of results) {
    if (!resultsByOperation.has(result.name)) {
      resultsByOperation.set(result.name, []);
    }
    resultsByOperation.get(result.name)!.push(result);
  }
  
  // Create comparisons
  for (const [operation, operationResults] of resultsByOperation) {
    const sqliteResult = operationResults.find(r => r.adapter === 'sqlite');
    const postgresResult = operationResults.find(r => r.adapter === 'postgres');
    
    if (sqliteResult && postgresResult) {
      const performanceRatio = sqliteResult.avgTime / postgresResult.avgTime;
      let winner: 'sqlite' | 'postgres' | 'tie';
      
      if (performanceRatio > 1.1) {
        winner = 'postgres'; // PostgreSQL is significantly faster
      } else if (performanceRatio < 0.9) {
        winner = 'sqlite'; // SQLite is significantly faster
      } else {
        winner = 'tie'; // Performance is similar
      }
      
      suite.comparison.push({
        sqlite: sqliteResult,
        postgres: postgresResult,
        performance_ratio: performanceRatio,
        winner
      });
    }
  }
  
  return suite;
}

/**
 * Run comprehensive performance benchmarks
 */
export async function runComprehensiveBenchmarks(): Promise<ComprehensiveBenchmarkResults> {
  console.log('🚀 Starting comprehensive performance benchmarks...');
  
  const startTime = Date.now();
  const suites: BenchmarkSuite[] = [];
  
  try {
    // Run all benchmark suites
    suites.push(await benchmarkSimpleReads());
    suites.push(await benchmarkWriteOperations());
    suites.push(await benchmarkComplexQueries());
    suites.push(await benchmarkConcurrentOperations());
    suites.push(await benchmarkAdapterSwitching());
    
    // Calculate summary statistics
    let sqliteWins = 0;
    let postgresWins = 0;
    let ties = 0;
    let totalComparisons = 0;
    let totalPerformanceRatio = 0;
    
    for (const suite of suites) {
      for (const comparison of suite.comparison) {
        totalComparisons++;
        totalPerformanceRatio += comparison.performance_ratio;
        
        switch (comparison.winner) {
          case 'sqlite':
            sqliteWins++;
            break;
          case 'postgres':
            postgresWins++;
            break;
          case 'tie':
            ties++;
            break;
        }
      }
    }
    
    const avgPerformanceRatio = totalPerformanceRatio / totalComparisons;
    let overallWinner: 'sqlite' | 'postgres' | 'tie';
    
    if (postgresWins > sqliteWins + ties / 2) {
      overallWinner = 'postgres';
    } else if (sqliteWins > postgresWins + ties / 2) {
      overallWinner = 'sqlite';
    } else {
      overallWinner = 'tie';
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`✅ Comprehensive benchmarks completed in ${totalTime}ms`);
    
    return {
      suites,
      summary: {
        totalTests: totalComparisons,
        sqliteWins,
        postgresWins,
        ties,
        overallWinner,
        avgPerformanceRatio
      },
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        cpus: require('os').cpus().length,
        totalMemory: require('os').totalmem(),
        timestamp: new Date().toISOString()
      }
    };
    
  } catch (error) {
    console.error('❌ Benchmark execution failed:', error);
    throw error;
  }
}

/**
 * Print benchmark results in a formatted way
 */
export function printBenchmarkResults(results: ComprehensiveBenchmarkResults): void {
  console.log('\n📊 COMPREHENSIVE PERFORMANCE BENCHMARK RESULTS');
  console.log('================================================\n');
  
  // System info
  console.log('🖥️ System Information:');
  console.log(`   Node.js: ${results.systemInfo.nodeVersion}`);
  console.log(`   Platform: ${results.systemInfo.platform}`);
  console.log(`   CPUs: ${results.systemInfo.cpus}`);
  console.log(`   Memory: ${(results.systemInfo.totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`   Timestamp: ${results.systemInfo.timestamp}\n`);
  
  // Summary
  console.log('🏆 Overall Summary:');
  console.log(`   Total Tests: ${results.summary.totalTests}`);
  console.log(`   SQLite Wins: ${results.summary.sqliteWins}`);
  console.log(`   PostgreSQL Wins: ${results.summary.postgresWins}`);
  console.log(`   Ties: ${results.summary.ties}`);
  console.log(`   Overall Winner: ${results.summary.overallWinner.toUpperCase()}`);
  console.log(`   Avg Performance Ratio: ${results.summary.avgPerformanceRatio.toFixed(2)}x (SQLite/PostgreSQL)\n`);
  
  // Detailed results by suite
  for (const suite of results.suites) {
    console.log(`📋 ${suite.name}:`);
    console.log('-'.repeat(suite.name.length + 4));
    
    for (const comparison of suite.comparison) {
      const sqliteTime = comparison.sqlite.avgTime.toFixed(2);
      const postgresTime = comparison.postgres.avgTime.toFixed(2);
      const ratio = comparison.performance_ratio.toFixed(2);
      const winner = comparison.winner.toUpperCase();
      const winnerIcon = comparison.winner === 'sqlite' ? '🔷' : 
                        comparison.winner === 'postgres' ? '🐘' : '🤝';
      
      console.log(`   ${winnerIcon} ${comparison.sqlite.name}:`);
      console.log(`      SQLite:     ${sqliteTime}ms avg (${comparison.sqlite.throughput.toFixed(1)} ops/sec)`);
      console.log(`      PostgreSQL: ${postgresTime}ms avg (${comparison.postgres.throughput.toFixed(1)} ops/sec)`);
      console.log(`      Ratio:      ${ratio}x | Winner: ${winner}\n`);
    }
  }
}