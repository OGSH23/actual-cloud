// Data migration utilities for SQLite to PostgreSQL migration
// @ts-strict-ignore

import * as fs from '../../platform/server/fs';
import * as sqlite from '../../platform/server/sqlite';
import { getDatabaseConfig, getPostgresConnectionString } from './config';

export interface MigrationProgress {
  totalTables: number;
  completedTables: number;
  currentTable: string;
  totalRows: number;
  migratedRows: number;
  errors: string[];
  startTime: Date;
  estimatedTimeRemaining?: number;
}

export interface MigrationOptions {
  sourceDbPath?: string;
  batchSize?: number;
  skipTables?: string[];
  onlyTables?: string[];
  dryRun?: boolean;
  onProgress?: (progress: MigrationProgress) => void;
  validateData?: boolean;
}

export interface MigrationResult {
  success: boolean;
  migratedTables: string[];
  totalRows: number;
  duration: number;
  errors: string[];
}

/**
 * Get list of tables from SQLite database
 */
async function getSqliteTables(sqliteDb: any): Promise<string[]> {
  const result = await sqlite.runQuery(
    sqliteDb,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    [],
    true,
  );
  return (result as { name: string }[]).map(row => row.name);
}

/**
 * Get table schema from SQLite
 */
async function getSqliteTableSchema(sqliteDb: any, tableName: string): Promise<string> {
  const result = await sqlite.runQuery(
    sqliteDb,
    'SELECT sql FROM sqlite_master WHERE type="table" AND name = ?',
    [tableName],
    true,
  ) as { sql: string }[];
  
  return result.length > 0 ? result[0].sql : '';
}

/**
 * Get row count for a table
 */
async function getTableRowCount(db: any, tableName: string, isPostgres = false): Promise<number> {
  const sql = `SELECT COUNT(*) as count FROM ${tableName}`;
  
  if (isPostgres) {
    const pgModule = await import('../../platform/server/postgres');
    const result = await pgModule.runQuery(db, sql, [], true) as { count: number }[];
    return result[0]?.count || 0;
  } else {
    const result = sqlite.runQuery(db, sql, [], true) as { count: number }[];
    return result[0]?.count || 0;
  }
}

/**
 * Convert SQLite schema to PostgreSQL-compatible schema
 */
function convertSchemaToPostgres(sqliteSchema: string): string {
  if (!sqliteSchema) return '';
  
  let pgSchema = sqliteSchema;
  
  // Convert SQLite types to PostgreSQL types
  pgSchema = pgSchema.replace(/INTEGER/gi, 'INTEGER');
  pgSchema = pgSchema.replace(/TEXT/gi, 'TEXT');
  pgSchema = pgSchema.replace(/REAL/gi, 'REAL');
  pgSchema = pgSchema.replace(/BLOB/gi, 'BYTEA');
  pgSchema = pgSchema.replace(/BOOLEAN/gi, 'BOOLEAN');
  
  // Handle PRIMARY KEY AUTO INCREMENT
  pgSchema = pgSchema.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
  pgSchema = pgSchema.replace(/INTEGER PRIMARY KEY/gi, 'SERIAL PRIMARY KEY');
  
  // Handle DATETIME and TIMESTAMP
  pgSchema = pgSchema.replace(/DATETIME/gi, 'TIMESTAMP');
  
  // Handle UNIQUE constraints
  pgSchema = pgSchema.replace(/UNIQUE\s*\(/gi, 'UNIQUE (');
  
  // Handle CHECK constraints
  pgSchema = pgSchema.replace(/CHECK\s*\(/gi, 'CHECK (');
  
  // Handle foreign key constraints
  pgSchema = pgSchema.replace(/REFERENCES\s+(\w+)\s*\(/gi, 'REFERENCES $1 (');
  
  // Add IF NOT EXISTS for PostgreSQL compatibility
  pgSchema = pgSchema.replace(/CREATE TABLE (\w+)/gi, 'CREATE TABLE IF NOT EXISTS $1');
  
  return pgSchema;
}

/**
 * Migrate data from one table
 */
async function migrateTable(
  sqliteDb: any,
  pgDb: any,
  tableName: string,
  options: MigrationOptions,
  progress: MigrationProgress,
): Promise<{ success: boolean; rowsMigrated: number; errors: string[] }> {
  const errors: string[] = [];
  let rowsMigrated = 0;
  
  try {
    console.log(`🔄 Migrating table: ${tableName}`);
    progress.currentTable = tableName;
    
    // Get table row count
    const totalRows = await getTableRowCount(sqliteDb, tableName, false);
    progress.totalRows = totalRows;
    progress.migratedRows = 0;
    
    if (totalRows === 0) {
      console.log(`  ✅ Table ${tableName} is empty, skipping data migration`);
      return { success: true, rowsMigrated: 0, errors: [] };
    }
    
    // Create table schema in PostgreSQL if it doesn't exist
    if (!options.dryRun) {
      const schema = await getSqliteTableSchema(sqliteDb, tableName);
      const pgSchema = convertSchemaToPostgres(schema);
      
      if (pgSchema) {
        const pgModule = await import('../../platform/server/postgres');
        try {
          await pgModule.execQuery(pgDb, pgSchema);
        } catch (error) {
          // Table might already exist, which is okay
          if (!error.message.includes('already exists')) {
            errors.push(`Schema creation failed for ${tableName}: ${error.message}`);
          }
        }
      }
    }
    
    // Migrate data in batches
    const batchSize = options.batchSize || 1000;
    let offset = 0;
    
    while (offset < totalRows) {
      // Fetch batch from SQLite
      const rows = sqlite.runQuery(
        sqliteDb,
        `SELECT * FROM ${tableName} LIMIT ${batchSize} OFFSET ${offset}`,
        [],
        true,
      ) as any[];
      
      if (rows.length === 0) break;
      
      if (!options.dryRun) {
        // Insert batch into PostgreSQL
        const pgModule = await import('../../platform/server/postgres');
        
        for (const row of rows) {
          try {
            const columns = Object.keys(row);
            const values = Object.values(row);
            const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
            
            const insertSql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
            
            await pgModule.runQuery(pgDb, insertSql, values, false);
            rowsMigrated++;
            
          } catch (error) {
            errors.push(`Insert failed for ${tableName} row: ${error.message}`);
            if (errors.length > 100) {
              // Stop if too many errors
              throw new Error(`Too many errors migrating ${tableName}`);
            }
          }
        }
      } else {
        rowsMigrated += rows.length;
      }
      
      offset += rows.length;
      progress.migratedRows = rowsMigrated;
      
      // Report progress
      if (options.onProgress) {
        options.onProgress(progress);
      }
      
      // Small delay to prevent overwhelming the databases
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    console.log(`  ✅ Migrated ${rowsMigrated} rows from ${tableName}`);
    return { success: true, rowsMigrated, errors };
    
  } catch (error) {
    const errorMsg = `Failed to migrate table ${tableName}: ${error.message}`;
    console.error(`  ❌ ${errorMsg}`);
    errors.push(errorMsg);
    return { success: false, rowsMigrated, errors };
  }
}

/**
 * Validate migrated data
 */
async function validateMigration(
  sqliteDb: any,
  pgDb: any,
  tableName: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    // Compare row counts
    const sqliteCount = await getTableRowCount(sqliteDb, tableName, false);
    const pgCount = await getTableRowCount(pgDb, tableName, true);
    
    if (sqliteCount !== pgCount) {
      errors.push(`Row count mismatch for ${tableName}: SQLite=${sqliteCount}, PostgreSQL=${pgCount}`);
    }
    
    // TODO: Add more sophisticated data validation
    // - Sample data comparison
    // - Checksum validation
    // - Foreign key constraint validation
    
    return { valid: errors.length === 0, errors };
    
  } catch (error) {
    errors.push(`Validation failed for ${tableName}: ${error.message}`);
    return { valid: false, errors };
  }
}

/**
 * Migrate data from SQLite to PostgreSQL
 */
export async function migrateFromSqliteToPostgres(options: MigrationOptions = {}): Promise<MigrationResult> {
  const startTime = new Date();
  const allErrors: string[] = [];
  const migratedTables: string[] = [];
  let totalRows = 0;
  
  try {
    console.log('🚀 Starting SQLite to PostgreSQL migration...');
    
    // Get database configuration
    const config = getDatabaseConfig();
    if (!config.postgres) {
      throw new Error('PostgreSQL configuration not found');
    }
    
    // Open SQLite database
    const sqliteDbPath = options.sourceDbPath || fs.join(fs.getBudgetDir(), 'db.sqlite');
    if (!fs.existsSync(sqliteDbPath)) {
      throw new Error(`SQLite database not found at: ${sqliteDbPath}`);
    }
    
    const sqliteDb = await sqlite.openDatabase(sqliteDbPath);
    
    // Open PostgreSQL database
    const pgModule = await import('../../platform/server/postgres');
    const pgDb = pgModule.openDatabase({
      connectionString: config.postgres.connectionString,
      maxConnections: config.postgres.maxConnections,
      idleTimeoutMs: config.postgres.idleTimeoutMs,
      connectionTimeoutMs: config.postgres.connectionTimeoutMs,
    });
    
    try {
      // Initialize PostgreSQL schema
      await pgModule.initializePostgresSchema(pgDb);
      console.log('✅ PostgreSQL schema initialized');
      
      // Get list of tables to migrate
      const allTables = await getSqliteTables(sqliteDb);
      let tablesToMigrate = allTables;
      
      if (options.onlyTables) {
        tablesToMigrate = tablesToMigrate.filter(table => options.onlyTables!.includes(table));
      }
      
      if (options.skipTables) {
        tablesToMigrate = tablesToMigrate.filter(table => !options.skipTables!.includes(table));
      }
      
      console.log(`📋 Found ${tablesToMigrate.length} tables to migrate:`, tablesToMigrate);
      
      if (options.dryRun) {
        console.log('🧪 Running in DRY RUN mode - no data will be modified');
      }
      
      // Initialize progress tracking
      const progress: MigrationProgress = {
        totalTables: tablesToMigrate.length,
        completedTables: 0,
        currentTable: '',
        totalRows: 0,
        migratedRows: 0,
        errors: [],
        startTime,
      };
      
      // Migrate each table
      for (const tableName of tablesToMigrate) {
        const result = await migrateTable(sqliteDb, pgDb, tableName, options, progress);
        
        if (result.success) {
          migratedTables.push(tableName);
          totalRows += result.rowsMigrated;
        }
        
        allErrors.push(...result.errors);
        progress.completedTables++;
        progress.errors = allErrors;
        
        // Validate data if requested
        if (options.validateData && result.success && !options.dryRun) {
          const validation = await validateMigration(sqliteDb, pgDb, tableName);
          if (!validation.valid) {
            allErrors.push(...validation.errors);
          }
        }
        
        if (options.onProgress) {
          options.onProgress(progress);
        }
      }
      
    } finally {
      // Close database connections
      await sqlite.closeDatabase(sqliteDb);
      await pgModule.closeDatabase(pgDb);
    }
    
    const duration = Date.now() - startTime.getTime();
    const success = allErrors.length === 0;
    
    console.log(`${success ? '✅' : '⚠️'} Migration completed in ${duration}ms`);
    console.log(`📊 Migrated ${migratedTables.length} tables with ${totalRows} total rows`);
    
    if (allErrors.length > 0) {
      console.log(`❌ Found ${allErrors.length} errors during migration`);
      allErrors.slice(0, 10).forEach(error => console.log(`  - ${error}`));
      if (allErrors.length > 10) {
        console.log(`  ... and ${allErrors.length - 10} more errors`);
      }
    }
    
    return {
      success,
      migratedTables,
      totalRows,
      duration,
      errors: allErrors,
    };
    
  } catch (error) {
    const errorMsg = `Migration failed: ${error.message}`;
    console.error(`❌ ${errorMsg}`);
    allErrors.push(errorMsg);
    
    return {
      success: false,
      migratedTables,
      totalRows,
      duration: Date.now() - startTime.getTime(),
      errors: allErrors,
    };
  }
}

/**
 * Create a backup of SQLite database before migration
 */
export async function createSqliteBackup(backupPath?: string): Promise<string> {
  const sourcePath = fs.join(fs.getBudgetDir(), 'db.sqlite');
  const targetPath = backupPath || fs.join(fs.getBudgetDir(), `db_backup_${Date.now()}.sqlite`);
  
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`SQLite database not found at: ${sourcePath}`);
  }
  
  await fs.copyFile(sourcePath, targetPath);
  console.log(`✅ Created SQLite backup at: ${targetPath}`);
  
  return targetPath;
}

/**
 * Export PostgreSQL data back to SQLite (reverse migration)
 */
export async function exportPostgresToSqlite(options: MigrationOptions = {}): Promise<MigrationResult> {
  // TODO: Implement reverse migration
  throw new Error('PostgreSQL to SQLite migration not yet implemented');
}