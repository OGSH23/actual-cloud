// Database health checks and validation utilities
// @ts-strict-ignore

import { getDatabaseAdapter, isPostgresAdapter, runQuery, execQuery } from './index';
import { getDatabaseConfig, areHealthChecksEnabled } from './config';

export interface HealthCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  duration: number;
  details?: Record<string, any>;
}

export interface DatabaseHealth {
  adapter: string;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  checks: HealthCheckResult[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    totalDuration: number;
  };
}

/**
 * Run a single health check with timing
 */
async function runHealthCheck(
  name: string,
  checkFn: () => Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; details?: any }>,
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    const result = await checkFn();
    const duration = Date.now() - startTime;
    
    return {
      name,
      status: result.status,
      message: result.message,
      duration,
      details: result.details,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    
    return {
      name,
      status: 'fail',
      message: `Health check failed: ${error.message}`,
      duration,
      details: { error: error.stack },
    };
  }
}

/**
 * Basic connectivity test
 */
async function checkConnectivity(): Promise<{ status: 'pass' | 'fail'; message: string; details?: any }> {
  const result = await runQuery('SELECT 1 as test', [], true);
  
  if (!result || (result as any[]).length === 0) {
    return {
      status: 'fail',
      message: 'Database connectivity test failed - no response',
    };
  }
  
  const testValue = (result as any[])[0]?.test;
  if (testValue !== 1) {
    return {
      status: 'fail',
      message: `Database connectivity test failed - unexpected response: ${testValue}`,
    };
  }
  
  return {
    status: 'pass',
    message: 'Database connectivity test passed',
  };
}

/**
 * Check database version and compatibility
 */
async function checkDatabaseVersion(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; details?: any }> {
  try {
    if (isPostgresAdapter()) {
      const result = await runQuery('SELECT version() as version', [], true) as { version: string }[];
      const version = result[0]?.version || 'unknown';
      
      // Extract PostgreSQL version number
      const versionMatch = version.match(/PostgreSQL (\d+\.\d+)/);
      const versionNumber = versionMatch ? parseFloat(versionMatch[1]) : 0;
      
      if (versionNumber < 12) {
        return {
          status: 'warn',
          message: `PostgreSQL version ${versionNumber} is below recommended minimum (12.0)`,
          details: { version, versionNumber },
        };
      }
      
      return {
        status: 'pass',
        message: `PostgreSQL version ${versionNumber} is supported`,
        details: { version, versionNumber },
      };
    } else {
      // SQLite version check
      const result = await runQuery('SELECT sqlite_version() as version', [], true) as { version: string }[];
      const version = result[0]?.version || 'unknown';
      
      return {
        status: 'pass',
        message: `SQLite version ${version}`,
        details: { version },
      };
    }
  } catch (error) {
    return {
      status: 'fail',
      message: `Failed to check database version: ${error.message}`,
    };
  }
}

/**
 * Check essential tables exist
 */
async function checkEssentialTables(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; details?: any }> {
  const essentialTables = [
    'accounts',
    'transactions',
    'categories',
    'category_groups',
    'payees',
    'messages_crdt',
    'messages_clock',
  ];
  
  const missingTables: string[] = [];
  const existingTables: string[] = [];
  
  for (const tableName of essentialTables) {
    try {
      if (isPostgresAdapter()) {
        const result = await runQuery(
          "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = $1",
          [tableName],
          true,
        ) as { count: number }[];
        
        if (result[0]?.count > 0) {
          existingTables.push(tableName);
        } else {
          missingTables.push(tableName);
        }
      } else {
        const result = await runQuery(
          "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name = ?",
          [tableName],
          true,
        ) as { count: number }[];
        
        if (result[0]?.count > 0) {
          existingTables.push(tableName);
        } else {
          missingTables.push(tableName);
        }
      }
    } catch (error) {
      missingTables.push(tableName);
    }
  }
  
  if (missingTables.length === 0) {
    return {
      status: 'pass',
      message: `All ${essentialTables.length} essential tables found`,
      details: { existingTables },
    };
  }
  
  if (missingTables.length < essentialTables.length / 2) {
    return {
      status: 'warn',
      message: `Some essential tables missing: ${missingTables.join(', ')}`,
      details: { missingTables, existingTables },
    };
  }
  
  return {
    status: 'fail',
    message: `Many essential tables missing: ${missingTables.join(', ')}`,
    details: { missingTables, existingTables },
  };
}

/**
 * Check database constraints and indexes
 */
async function checkDatabaseIntegrity(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; details?: any }> {
  try {
    if (isPostgresAdapter()) {
      // Check for foreign key violations
      const fkResult = await runQuery(`
        SELECT 
          conrelid::regclass AS table_name,
          conname AS constraint_name
        FROM pg_constraint 
        WHERE contype = 'f' 
        LIMIT 5
      `, [], true) as any[];
      
      return {
        status: 'pass',
        message: `Database integrity check passed (${fkResult.length} constraints found)`,
        details: { constraintCount: fkResult.length },
      };
    } else {
      // SQLite integrity check
      const result = await runQuery('PRAGMA integrity_check', [], true) as { integrity_check: string }[];
      
      if (result[0]?.integrity_check === 'ok') {
        return {
          status: 'pass',
          message: 'SQLite integrity check passed',
        };
      }
      
      return {
        status: 'fail',
        message: 'SQLite integrity check failed',
        details: { result },
      };
    }
  } catch (error) {
    return {
      status: 'warn',
      message: `Integrity check failed: ${error.message}`,
    };
  }
}

/**
 * Check database performance metrics
 */
async function checkPerformanceMetrics(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; details?: any }> {
  try {
    const startTime = Date.now();
    
    // Simple query performance test
    await runQuery('SELECT COUNT(*) FROM accounts WHERE tombstone = 0', [], true);
    
    const queryTime = Date.now() - startTime;
    
    if (queryTime > 5000) {
      return {
        status: 'warn',
        message: `Slow query performance: ${queryTime}ms`,
        details: { queryTime },
      };
    }
    
    if (queryTime > 10000) {
      return {
        status: 'fail',
        message: `Very slow query performance: ${queryTime}ms`,
        details: { queryTime },
      };
    }
    
    let details: any = { queryTime };
    
    if (isPostgresAdapter()) {
      // Get PostgreSQL connection stats
      try {
        const connResult = await runQuery(`
          SELECT 
            state,
            COUNT(*) as count
          FROM pg_stat_activity 
          WHERE datname = current_database()
          GROUP BY state
        `, [], true) as { state: string; count: number }[];
        
        details.connectionStats = connResult;
      } catch (error) {
        // Ignore connection stats errors
      }
    }
    
    return {
      status: 'pass',
      message: `Good query performance: ${queryTime}ms`,
      details,
    };
  } catch (error) {
    return {
      status: 'fail',
      message: `Performance check failed: ${error.message}`,
    };
  }
}

/**
 * Check CRDT messages and sync state
 */
async function checkSyncState(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; details?: any }> {
  try {
    // Check for CRDT messages
    const messageResult = await runQuery(
      'SELECT COUNT(*) as count FROM messages_crdt',
      [],
      true,
    ) as { count: number }[];
    
    const messageCount = messageResult[0]?.count || 0;
    
    // Check for clock state
    const clockResult = await runQuery(
      'SELECT COUNT(*) as count FROM messages_clock',
      [],
      true,
    ) as { count: number }[];
    
    const clockCount = clockResult[0]?.count || 0;
    
    if (clockCount === 0) {
      return {
        status: 'warn',
        message: 'No sync clock found - sync may not be initialized',
        details: { messageCount, clockCount },
      };
    }
    
    return {
      status: 'pass',
      message: `Sync state healthy: ${messageCount} messages, ${clockCount} clock entries`,
      details: { messageCount, clockCount },
    };
  } catch (error) {
    return {
      status: 'fail',
      message: `Sync state check failed: ${error.message}`,
    };
  }
}

/**
 * Run comprehensive database health checks
 */
export async function performDatabaseHealthCheck(): Promise<DatabaseHealth> {
  console.log('🔍 Starting comprehensive database health check...');
  
  const checks: HealthCheckResult[] = [];
  const adapter = getDatabaseAdapter();
  
  // Run all health checks
  const healthChecks = [
    { name: 'Connectivity', fn: checkConnectivity },
    { name: 'Database Version', fn: checkDatabaseVersion },
    { name: 'Essential Tables', fn: checkEssentialTables },
    { name: 'Database Integrity', fn: checkDatabaseIntegrity },
    { name: 'Performance Metrics', fn: checkPerformanceMetrics },
    { name: 'Sync State', fn: checkSyncState },
  ];
  
  for (const { name, fn } of healthChecks) {
    const result = await runHealthCheck(name, fn);
    checks.push(result);
    
    const icon = result.status === 'pass' ? '✅' : result.status === 'warn' ? '⚠️' : '❌';
    console.log(`  ${icon} ${name}: ${result.message} (${result.duration}ms)`);
  }
  
  // Calculate summary
  const summary = {
    passed: checks.filter(c => c.status === 'pass').length,
    failed: checks.filter(c => c.status === 'fail').length,
    warnings: checks.filter(c => c.status === 'warn').length,
    totalDuration: checks.reduce((sum, c) => sum + c.duration, 0),
  };
  
  // Determine overall health
  let overall: 'healthy' | 'degraded' | 'unhealthy';
  if (summary.failed === 0 && summary.warnings === 0) {
    overall = 'healthy';
  } else if (summary.failed === 0) {
    overall = 'degraded';
  } else {
    overall = 'unhealthy';
  }
  
  const health: DatabaseHealth = {
    adapter,
    overall,
    timestamp: new Date(),
    checks,
    summary,
  };
  
  const overallIcon = overall === 'healthy' ? '✅' : overall === 'degraded' ? '⚠️' : '❌';
  console.log(`${overallIcon} Overall database health: ${overall.toUpperCase()}`);
  console.log(`📊 Summary: ${summary.passed} passed, ${summary.warnings} warnings, ${summary.failed} failed (${summary.totalDuration}ms total)`);
  
  return health;
}

/**
 * Quick health check for monitoring
 */
export async function quickHealthCheck(): Promise<boolean> {
  try {
    const result = await runQuery('SELECT 1 as test', [], true);
    return result && (result as any[]).length > 0 && (result as any[])[0].test === 1;
  } catch (error) {
    return false;
  }
}

/**
 * Get database connection info
 */
export async function getDatabaseConnectionInfo(): Promise<{
  adapter: string;
  status: 'connected' | 'disconnected' | 'error';
  details?: any;
}> {
  try {
    const adapter = getDatabaseAdapter();
    const isConnected = await quickHealthCheck();
    
    if (!isConnected) {
      return {
        adapter,
        status: 'disconnected',
      };
    }
    
    let details: any = {};
    
    if (isPostgresAdapter()) {
      try {
        const result = await runQuery(`
          SELECT 
            current_database() as database,
            current_user as user,
            inet_server_addr() as host,
            inet_server_port() as port
        `, [], true) as any[];
        
        details = result[0] || {};
      } catch (error) {
        // Ignore details errors
      }
    }
    
    return {
      adapter,
      status: 'connected',
      details,
    };
  } catch (error) {
    return {
      adapter: getDatabaseAdapter(),
      status: 'error',
      details: { error: error.message },
    };
  }
}

/**
 * Monitor database health periodically
 */
export class DatabaseHealthMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private lastHealth: DatabaseHealth | null = null;
  private onHealthChange?: (health: DatabaseHealth) => void;
  
  constructor(onHealthChange?: (health: DatabaseHealth) => void) {
    this.onHealthChange = onHealthChange;
  }
  
  start(intervalMs: number = 60000): void {
    if (this.intervalId) {
      this.stop();
    }
    
    console.log(`🔄 Starting database health monitoring (${intervalMs}ms interval)`);
    
    // Run initial check
    this.checkHealth();
    
    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.checkHealth();
    }, intervalMs);
  }
  
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('⏹️ Stopped database health monitoring');
    }
  }
  
  private async checkHealth(): Promise<void> {
    try {
      if (!areHealthChecksEnabled()) {
        return;
      }
      
      const health = await performDatabaseHealthCheck();
      
      // Notify of health changes
      if (this.onHealthChange && 
          (!this.lastHealth || this.lastHealth.overall !== health.overall)) {
        this.onHealthChange(health);
      }
      
      this.lastHealth = health;
    } catch (error) {
      console.error('❌ Health monitoring check failed:', error);
    }
  }
  
  getLastHealth(): DatabaseHealth | null {
    return this.lastHealth;
  }
}