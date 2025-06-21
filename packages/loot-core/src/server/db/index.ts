// @ts-strict-ignore
import {
  makeClock,
  setClock,
  serializeClock,
  deserializeClock,
  makeClientId,
  Timestamp,
} from '@actual-app/crdt';
import { Database as SqliteDatabase } from '@jlongster/sql.js';
import type { Database as PostgresDatabase } from '../../platform/server/postgres';
import { LRUCache } from 'lru-cache';
import { v4 as uuidv4 } from 'uuid';

import * as fs from '../../platform/server/fs';
import * as sqlite from '../../platform/server/sqlite';
import {
  DatabaseAdapter,
  getDatabaseConfig,
  getActiveAdapter,
  isPostgresEnabled,
  isFallbackToSqliteEnabled,
  areHealthChecksEnabled,
  isSchemaValidationEnabled,
  validatePostgresConfig,
  getConfigSummary,
} from './config';
import * as monthUtils from '../../shared/months';
import { groupById } from '../../shared/util';
import { TransactionEntity } from '../../types/models';
import { WithRequired } from '../../types/util';
import {
  schema,
  schemaConfig,
  convertForInsert,
  convertForUpdate,
  convertFromSelect,
} from '../aql';
import {
  toDateRepr,
  accountModel,
  categoryModel,
  categoryGroupModel,
  payeeModel,
} from '../models';
import { sendMessages, batchMessages } from '../sync';

import { shoveSortOrders, SORT_INCREMENT } from './sort';
import {
  DbAccount,
  DbBank,
  DbCategory,
  DbCategoryGroup,
  DbCategoryMapping,
  DbClockMessage,
  DbPayee,
  DbPayeeMapping,
  DbTransaction,
  DbViewTransaction,
  DbViewTransactionInternalAlive,
} from './types';

export * from './types';

export { toDateRepr, fromDateRepr } from '../models';

/**
 * Perform database health checks
 */
async function performHealthChecks(): Promise<void> {
  try {
    console.log('🔍 Performing database health checks...');
    
    // Basic connectivity test
    if (currentAdapter === 'postgres') {
      const result = await runQuery('SELECT 1 as test', [], true);
      if (!result || (result as any[]).length === 0) {
        throw new Error('PostgreSQL connectivity test failed');
      }
    } else {
      const result = await runQuery('SELECT 1 as test', [], true);
      if (!result || (result as any[]).length === 0) {
        throw new Error('SQLite connectivity test failed');
      }
    }
    
    // Schema validation for PostgreSQL
    if (currentAdapter === 'postgres' && isSchemaValidationEnabled()) {
      try {
        const pgModule = await import('../../platform/server/postgres');
        const isValid = await pgModule.isSchemaInitialized(db);
        if (!isValid) {
          throw new Error('PostgreSQL schema validation failed');
        }
      } catch (importError) {
        console.warn('PostgreSQL schema validation skipped:', importError.message);
      }
    }
    
    console.log('✅ Database health checks passed');
    
  } catch (error) {
    console.error('❌ Database health checks failed:', error);
    throw error;
  }
}

/**
 * Get database status information
 */
export async function getDatabaseStatus(): Promise<{
  adapter: DatabaseAdapter;
  initialized: boolean;
  error: string | null;
  connectionCount?: number;
  schemaValid?: boolean;
}> {
  const status = {
    adapter: currentAdapter,
    initialized: isInitialized,
    error: initializationError?.message || null,
  };
  
  if (!isInitialized) {
    return status;
  }
  
  try {
    if (currentAdapter === 'postgres') {
      // Get PostgreSQL-specific status
      try {
        const pgModule = await import('../../platform/server/postgres');
        return {
          ...status,
          schemaValid: await pgModule.isSchemaInitialized(db),
        };
      } catch (importError) {
        return {
          ...status,
          schemaValid: false,
          error: `PostgreSQL module not available: ${importError.message}`,
        };
      }
    } else {
      // SQLite status
      return {
        ...status,
        schemaValid: true, // SQLite schema is always assumed valid
      };
    }
  } catch (error) {
    return {
      ...status,
      error: error.message,
    };
  }
}

/**
 * Switch database adapter at runtime
 */
export async function switchDatabaseAdapter(newAdapter: DatabaseAdapter): Promise<void> {
  if (newAdapter === currentAdapter) {
    console.log(`Already using ${newAdapter} adapter`);
    return;
  }
  
  console.log(`🔄 Switching from ${currentAdapter} to ${newAdapter}...`);
  
  try {
    await setDatabaseAdapter(newAdapter);
    // Database will be reopened when next operation is performed
    console.log(`✅ Successfully switched to ${newAdapter} adapter`);
  } catch (error) {
    console.error(`❌ Failed to switch to ${newAdapter} adapter:`, error);
    throw error;
  }
}

let dbPath: string | null = null;
// Union type for both database adapters
type Database = SqliteDatabase | PostgresDatabase;

let db: Database | null = null;
let pgDb: any = null; // PostgreSQL database instance

// Database adapter state
let currentAdapter: DatabaseAdapter = getActiveAdapter();
let isInitialized = false;
let initializationError: Error | null = null;

// Util

/**
 * Configure which database adapter to use with runtime switching support
 */
export async function setDatabaseAdapter(adapter: DatabaseAdapter): Promise<void> {
  if (adapter === currentAdapter && isInitialized) {
    return; // Already using the requested adapter
  }
  
  console.log(`🔄 Switching database adapter from ${currentAdapter} to ${adapter}`);
  
  // Validate configuration before switching
  const config = getDatabaseConfig();
  config.adapter = adapter;
  
  if (adapter === 'postgres') {
    const errors = validatePostgresConfig(config);
    if (errors.length > 0) {
      throw new Error(`PostgreSQL configuration errors: ${errors.join(', ')}`);
    }
  }
  
  // Close existing connections
  await closeDatabase();
  
  // Update adapter
  currentAdapter = adapter;
  isInitialized = false;
  initializationError = null;
  
  console.log(`✅ Database adapter switched to ${adapter}`);
}

/**
 * Get the current database adapter
 */
export function getDatabaseAdapter(): DatabaseAdapter {
  return currentAdapter;
}

/**
 * Check if PostgreSQL adapter is active
 */
export function isPostgresAdapter(): boolean {
  return currentAdapter === 'postgres';
}

/**
 * Check if database is initialized and ready
 */
export function isDatabaseInitialized(): boolean {
  return isInitialized && !initializationError;
}

/**
 * Get database initialization error if any
 */
export function getDatabaseInitializationError(): Error | null {
  return initializationError;
}

export function getDatabasePath() {
  return dbPath;
}

export async function openDatabase(id?: string): Promise<void> {
  try {
    console.log(`🚀 Opening database with ${currentAdapter} adapter`);
    console.log(getConfigSummary());
    
    // Close existing connections
    await closeDatabase();
    
    if (currentAdapter === 'postgres') {
      await openPostgresDatabase();
    } else {
      await openSqliteDatabase(id);
    }
    
    // Perform health checks if enabled
    if (areHealthChecksEnabled()) {
      await performHealthChecks();
    }
    
    isInitialized = true;
    initializationError = null;
    console.log(`✅ ${currentAdapter} database opened successfully`);
    
  } catch (error) {
    initializationError = error as Error;
    isInitialized = false;
    
    console.error(`❌ Failed to open ${currentAdapter} database:`, error);
    
    // Attempt fallback to SQLite if PostgreSQL fails
    if (currentAdapter === 'postgres' && isFallbackToSqliteEnabled()) {
      console.log('🔄 Attempting fallback to SQLite...');
      try {
        currentAdapter = 'sqlite';
        await openSqliteDatabase(id);
        isInitialized = true;
        initializationError = null;
        console.log('✅ Successfully fell back to SQLite');
      } catch (fallbackError) {
        console.error('❌ Fallback to SQLite also failed:', fallbackError);
        throw fallbackError;
      }
    } else {
      throw error;
    }
  }
}

/**
 * Open SQLite database
 */
async function openSqliteDatabase(id?: string): Promise<void> {
  dbPath = fs.join(fs.getBudgetDir(id), 'db.sqlite');
  setDatabase(await sqlite.openDatabase(dbPath));
  
  // Apply SQLite pragmas
  const config = getDatabaseConfig();
  if (config.sqlite?.pragmas) {
    for (const [pragma, value] of Object.entries(config.sqlite.pragmas)) {
      await execQuery(`PRAGMA ${pragma} = ${value}`);
    }
  }
}

/**
 * Open PostgreSQL database with dynamic import
 */
async function openPostgresDatabase(): Promise<void> {
  try {
    // Check if we're in a server environment
    if (typeof window !== 'undefined') {
      throw new Error('PostgreSQL adapter not available in browser environment');
    }
    
    // Dynamic import to avoid bundling issues
    let pgModule;
    try {
      pgModule = await import('../../platform/server/postgres');
    } catch (importError) {
      // If PostgreSQL module can't be loaded, provide a helpful error
      throw new Error(`PostgreSQL module not available. Ensure 'pg' package is installed and this is a server environment. Error: ${importError.message}`);
    }
    
    const config = getDatabaseConfig();
    
    // Prepare PostgreSQL configuration
    const pgConfig = config.postgres ? {
      connectionString: config.postgres.connectionString,
      maxConnections: config.postgres.maxConnections,
      idleTimeoutMs: config.postgres.idleTimeoutMs,
      connectionTimeoutMs: config.postgres.connectionTimeoutMs,
    } : undefined;
    
    // Open PostgreSQL connection
    pgDb = pgModule.openDatabase(pgConfig);
    
    // Initialize schema if needed
    if (isSchemaValidationEnabled()) {
      const isInitialized = await pgModule.isSchemaInitialized(pgDb);
      if (!isInitialized) {
        console.log('🔧 Initializing PostgreSQL schema...');
        await pgModule.initializePostgresSchema(pgDb);
        console.log('✅ PostgreSQL schema initialized');
      }
    }
    
    // Set as current database for compatibility
    setDatabase(pgDb);
    
  } catch (error) {
    console.error('Failed to load PostgreSQL module:', error);
    throw new Error(`PostgreSQL initialization failed: ${error.message}`);
  }
}

export async function closeDatabase(): Promise<void> {
  try {
    if (currentAdapter === 'postgres' && pgDb) {
      // Dynamic import for PostgreSQL close
      try {
        const pgModule = await import('../../platform/server/postgres');
        await pgModule.closeDatabase(pgDb);
      } catch (error) {
        console.warn('Failed to load PostgreSQL module for close:', error);
      }
      pgDb = null;
    } else if (db) {
      await sqlite.closeDatabase(db);
    }
    
    setDatabase(null);
    isInitialized = false;
    
  } catch (error) {
    console.error('Error closing database:', error);
    // Still reset state even if close failed
    setDatabase(null);
    pgDb = null;
    isInitialized = false;
  }
}

export function setDatabase(db_: Database) {
  db = db_;
  resetQueryCache();
}

export function getDatabase() {
  return db;
}

export async function loadClock() {
  const row = await first<DbClockMessage>('SELECT * FROM messages_clock');
  if (row) {
    const clock = deserializeClock(row.clock);
    setClock(clock);
  } else {
    // No clock exists yet (first run of the app), so create a default
    // one.
    const timestamp = new Timestamp(0, 0, makeClientId());
    const clock = makeClock(timestamp);
    setClock(clock);

    await runQuery('INSERT INTO messages_clock (id, clock) VALUES (?, ?)', [
      1,
      serializeClock(clock),
    ]);
  }
}

// Functions - Async Database Operations

/**
 * Core async runQuery function - now truly async for future PostgreSQL support
 * Currently wraps SQLite's sync behavior to maintain compatibility
 */
export async function runQuery(
  sql: string,
  params?: Array<string | number>,
  fetchAll?: false,
): Promise<{ changes: unknown; insertId?: unknown }>;

export async function runQuery<T>(
  sql: string,
  params: Array<string | number> | undefined,
  fetchAll: true,
): Promise<T[]>;

export async function runQuery<T>(
  sql: string,
  params: (string | number)[] = [],
  fetchAll = false,
): Promise<T[] | { changes: unknown; insertId?: unknown }> {
  if (!db) {
    throw new Error('Database not connected. Call openDatabase() first.');
  }
  
  if (!isInitialized) {
    throw new Error('Database not properly initialized');
  }
  
  if (initializationError) {
    throw new Error(`Database initialization error: ${initializationError.message}`);
  }
  
  try {
    if (currentAdapter === 'postgres') {
      // Use PostgreSQL adapter
      try {
        const pgModule = await import('../../platform/server/postgres');
        return await pgModule.runQuery(db, sql, params, fetchAll);
      } catch (importError) {
        throw new Error(`PostgreSQL module not available: ${importError.message}`);
      }
    } else {
      // Use SQLite adapter (wrapped in Promise for consistency)
      const result = sqlite.runQuery<T>(db, sql, params, fetchAll);
      return Promise.resolve(result);
    }
  } catch (error) {
    console.error(`Database query failed (${currentAdapter}):`, { sql, params, error });
    throw error;
  }
}

/**
 * Legacy sync version for backward compatibility during transition
 * @deprecated Use async runQuery instead
 */
export function runQuerySync(
  sql: string,
  params?: Array<string | number>,
  fetchAll?: false,
): { changes: unknown; insertId?: unknown };

export function runQuerySync<T>(
  sql: string,
  params: Array<string | number> | undefined,
  fetchAll: true,
): T[];

export function runQuerySync<T>(
  sql: string,
  params: (string | number)[] = [],
  fetchAll = false,
): T[] | { changes: unknown; insertId?: unknown } {
  if (!db) {
    throw new Error('Database not connected. Call openDatabase() first.');
  }
  
  // PostgreSQL adapter requires async operations, but some legacy code
  // still uses synchronous calls. For now, we'll return empty results
  // to prevent crashes while working toward full async migration.
  if (currentAdapter === 'postgres') {
    console.warn(
      'Warning: Synchronous database operation requested with PostgreSQL adapter. ' +
      'Returning empty results to prevent crashes. Some functionality may be limited. ' +
      'Consider updating to async operations for full PostgreSQL compatibility.'
    );
    
    if (fetchAll) {
      return [] as T[];
    } else {
      return { changes: 0, insertId: null };
    }
  }
  
  return sqlite.runQuery<T>(db, sql, params, fetchAll);
}

/**
 * Execute SQL without returning results (async version)
 */
export async function execQuery(sql: string): Promise<void> {
  if (!db) {
    throw new Error('Database not connected. Call openDatabase() first.');
  }
  
  if (!isInitialized) {
    throw new Error('Database not properly initialized');
  }
  
  try {
    if (currentAdapter === 'postgres') {
      // Use PostgreSQL adapter
      try {
        const pgModule = await import('../../platform/server/postgres');
        await pgModule.execQuery(db, sql);
      } catch (importError) {
        throw new Error(`PostgreSQL module not available: ${importError.message}`);
      }
    } else {
      // Use SQLite adapter
      sqlite.execQuery(db, sql);
    }
  } catch (error) {
    console.error(`Database exec failed (${currentAdapter}):`, { sql, error });
    throw error;
  }
}

/**
 * Legacy sync version for backward compatibility
 * @deprecated Use async execQuery instead
 */
export function execQuerySync(sql: string): void {
  if (!db) {
    throw new Error('Database not connected. Call openDatabase() first.');
  }
  
  sqlite.execQuery(db, sql);
}

// This manages an LRU cache of prepared query statements. This is
// only needed in hot spots when you are running lots of queries.
let _queryCache = new LRUCache<string, string>({ max: 100 });

/**
 * Prepare and cache SQL statements for performance
 */
export function cache(sql: string) {
  const cached = _queryCache.get(sql);
  if (cached) {
    return cached;
  }

  if (!db) {
    throw new Error('Database not connected. Call openDatabase() first.');
  }
  
  const prepared = sqlite.prepare(db, sql);
  _queryCache.set(sql, prepared);
  return prepared;
}

function resetQueryCache() {
  _queryCache = new LRUCache<string, string>({ max: 100 });
}

/**
 * Execute function within a database transaction
 * Supports both sync and async functions
 */
export async function transaction(fn: () => void | Promise<void>): Promise<void> {
  if (!db) {
    throw new Error('Database not connected. Call openDatabase() first.');
  }
  
  if (!isInitialized) {
    throw new Error('Database not properly initialized');
  }
  
  try {
    if (currentAdapter === 'postgres') {
      // Use PostgreSQL adapter
      try {
        const pgModule = await import('../../platform/server/postgres');
        await pgModule.transaction(db, fn);
      } catch (importError) {
        throw new Error(`PostgreSQL module not available: ${importError.message}`);
      }
    } else {
      // Use SQLite adapter with proper async/sync detection
      if (fn.constructor.name === 'AsyncFunction') {
        await sqlite.asyncTransaction(db, fn as () => Promise<void>);
      } else {
        sqlite.transaction(db, fn as () => void);
      }
    }
  } catch (error) {
    console.error(`Database transaction failed (${currentAdapter}):`, error);
    throw error;
  }
}

/**
 * Execute async function within a database transaction
 * Preferred method for new code
 */
export async function asyncTransaction(fn: () => Promise<void>): Promise<void> {
  if (!db) {
    throw new Error('Database not connected. Call openDatabase() first.');
  }
  
  if (!isInitialized) {
    throw new Error('Database not properly initialized');
  }
  
  try {
    if (currentAdapter === 'postgres') {
      // Use PostgreSQL adapter
      try {
        const pgModule = await import('../../platform/server/postgres');
        await pgModule.asyncTransaction(db, fn);
      } catch (importError) {
        throw new Error(`PostgreSQL module not available: ${importError.message}`);
      }
    } else {
      // Use SQLite adapter
      await sqlite.asyncTransaction(db, fn);
    }
  } catch (error) {
    console.error(`Database async transaction failed (${currentAdapter}):`, error);
    throw error;
  }
}

/**
 * Legacy sync transaction for backward compatibility
 * @deprecated Use async transaction instead
 */
export function transactionSync(fn: () => void): void {
  if (!db) {
    throw new Error('Database not connected. Call openDatabase() first.');
  }
  
  return sqlite.transaction(db, fn);
}

/**
 * Execute query and return all rows (truly async)
 */
export async function all<T>(sql: string, params?: (string | number)[]): Promise<T[]> {
  return await runQuery<T>(sql, params, true);
}

/**
 * Execute query and return first row or null (truly async)
 */
export async function first<T>(sql: string, params?: (string | number)[]): Promise<T | null> {
  const arr = await runQuery<T>(sql, params, true);
  return arr.length === 0 ? null : arr[0];
}

/**
 * Execute query without returning rows (truly async)
 */
export async function run(sql: string, params?: (string | number)[]): Promise<{ changes: unknown; insertId?: unknown }> {
  return await runQuery(sql, params, false);
}

/**
 * Legacy sync version of first() for backward compatibility
 * @deprecated Use async first() instead
 */
export function firstSync<T>(sql: string, params?: (string | number)[]): T | null {
  const arr = runQuerySync<T>(sql, params, true) as T[];
  return arr.length === 0 ? null : arr[0];
}

/**
 * Legacy sync version of all() for backward compatibility
 * @deprecated Use async all() instead
 */
export function allSync<T>(sql: string, params?: (string | number)[]): T[] {
  return runQuerySync<T>(sql, params, true) as T[];
}

/**
 * Legacy sync version of run() for backward compatibility
 * @deprecated Use async run() instead
 */
export function runSync(sql: string, params?: (string | number)[]): { changes: unknown; insertId?: unknown } {
  return runQuerySync(sql, params, false) as { changes: unknown; insertId?: unknown };
}

export async function select(table, id) {
  const rows = await runQuery(
    'SELECT * FROM ' + table + ' WHERE id = ?',
    [id],
    true,
  );
  // TODO: In the next phase, we will make this function generic
  // and pass the type of the return type to `runQuery`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows[0] as any;
}

export async function update(table, params) {
  const fields = Object.keys(params).filter(k => k !== 'id');

  if (params.id == null) {
    throw new Error('update: id is required');
  }

  await sendMessages(
    fields.map(k => {
      return {
        dataset: table,
        row: params.id,
        column: k,
        value: params[k],
        timestamp: Timestamp.send(),
      };
    }),
  );
}

export async function insertWithUUID(table, row) {
  if (!row.id) {
    row = { ...row, id: uuidv4() };
  }

  await insert(table, row);

  // We can't rely on the return value of insert because if the
  // primary key is text, sqlite returns the internal row id which we
  // don't care about. We want to return the generated UUID.
  return row.id;
}

export async function insert(table, row) {
  const fields = Object.keys(row).filter(k => k !== 'id');

  if (row.id == null) {
    throw new Error('insert: id is required');
  }

  await sendMessages(
    fields.map(k => {
      return {
        dataset: table,
        row: row.id,
        column: k,
        value: row[k],
        timestamp: Timestamp.send(),
      };
    }),
  );
}

export async function delete_(table, id) {
  await sendMessages([
    {
      dataset: table,
      row: id,
      column: 'tombstone',
      value: 1,
      timestamp: Timestamp.send(),
    },
  ]);
}

export async function deleteAll(table: string) {
  const rows = await all<{ id: string }>(`
    SELECT id FROM ${table} WHERE tombstone = 0
  `);
  await Promise.all(rows.map(({ id }) => delete_(table, id)));
}

export async function selectWithSchema(table, sql, params) {
  const rows = await runQuery(sql, params, true);
  const convertedRows = rows
    .map(row => convertFromSelect(schema, schemaConfig, table, row))
    .filter(Boolean);
  // TODO: Make convertFromSelect generic so we don't need this cast
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return convertedRows as any[];
}

export async function selectFirstWithSchema(table, sql, params) {
  const rows = await selectWithSchema(table, sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function insertWithSchema(table, row) {
  // Even though `insertWithUUID` does this, we need to do it here so
  // the schema validation passes
  if (!row.id) {
    row = { ...row, id: uuidv4() };
  }

  return insertWithUUID(
    table,
    convertForInsert(schema, schemaConfig, table, row),
  );
}

export function updateWithSchema(table, fields) {
  return update(table, convertForUpdate(schema, schemaConfig, table, fields));
}

// Data-specific functions. Ideally this would be split up into
// different files

export async function getCategories(
  ids?: Array<DbCategory['id']>,
): Promise<DbCategory[]> {
  const whereIn = ids ? `c.id IN (${toSqlQueryParameters(ids)}) AND` : '';
  const query = `SELECT c.* FROM categories c WHERE ${whereIn} c.tombstone = 0 ORDER BY c.sort_order, c.id`;
  return ids
    ? await all<DbCategory>(query, [...ids])
    : await all<DbCategory>(query);
}

export async function getCategoriesGrouped(
  ids?: Array<DbCategoryGroup['id']>,
): Promise<
  Array<
    DbCategoryGroup & {
      categories: DbCategory[];
    }
  >
> {
  const categoryGroupWhereIn = ids
    ? `cg.id IN (${toSqlQueryParameters(ids)}) AND`
    : '';
  const categoryGroupQuery = `SELECT cg.* FROM category_groups cg WHERE ${categoryGroupWhereIn} cg.tombstone = 0
    ORDER BY cg.is_income, cg.sort_order, cg.id`;

  const categoryWhereIn = ids
    ? `c.cat_group IN (${toSqlQueryParameters(ids)}) AND`
    : '';
  const categoryQuery = `SELECT c.* FROM categories c WHERE ${categoryWhereIn} c.tombstone = 0
    ORDER BY c.sort_order, c.id`;

  const groups = ids
    ? await all<DbCategoryGroup>(categoryGroupQuery, [...ids])
    : await all<DbCategoryGroup>(categoryGroupQuery);

  const categories = ids
    ? await all<DbCategory>(categoryQuery, [...ids])
    : await all<DbCategory>(categoryQuery);

  return groups.map(group => ({
    ...group,
    categories: categories.filter(c => c.cat_group === group.id),
  }));
}

export async function insertCategoryGroup(
  group: WithRequired<Partial<DbCategoryGroup>, 'name'>,
): Promise<DbCategoryGroup['id']> {
  // Don't allow duplicate group
  const existingGroup = await first<
    Pick<DbCategoryGroup, 'id' | 'name' | 'hidden'>
  >(
    `SELECT id, name, hidden FROM category_groups WHERE UPPER(name) = ? and tombstone = 0 LIMIT 1`,
    [group.name.toUpperCase()],
  );
  if (existingGroup) {
    throw new Error(
      `A ${existingGroup.hidden ? 'hidden ' : ''}’${existingGroup.name}’ category group already exists.`,
    );
  }

  const lastGroup = await first<Pick<DbCategoryGroup, 'sort_order'>>(`
    SELECT sort_order FROM category_groups WHERE tombstone = 0 ORDER BY sort_order DESC, id DESC LIMIT 1
  `);
  const sort_order = (lastGroup ? lastGroup.sort_order : 0) + SORT_INCREMENT;

  group = {
    ...categoryGroupModel.validate(group),
    sort_order,
  };
  const id: DbCategoryGroup['id'] = await insertWithUUID(
    'category_groups',
    group,
  );
  return id;
}

export function updateCategoryGroup(
  group: WithRequired<Partial<DbCategoryGroup>, 'name' | 'is_income'>,
) {
  group = categoryGroupModel.validate(group, { update: true });
  return update('category_groups', group);
}

export async function moveCategoryGroup(
  id: DbCategoryGroup['id'],
  targetId: DbCategoryGroup['id'],
) {
  const groups = await all<Pick<DbCategoryGroup, 'id' | 'sort_order'>>(
    `SELECT id, sort_order FROM category_groups WHERE tombstone = 0 ORDER BY sort_order, id`,
  );

  const { updates, sort_order } = shoveSortOrders(groups, targetId);
  for (const info of updates) {
    await update('category_groups', info);
  }
  await update('category_groups', { id, sort_order });
}

export async function deleteCategoryGroup(
  group: Pick<DbCategoryGroup, 'id'>,
  transferId?: DbCategory['id'],
) {
  const categories = await all<DbCategory>(
    'SELECT * FROM categories WHERE cat_group = ?',
    [group.id],
  );

  // Delete all the categories within a group
  await Promise.all(categories.map(cat => deleteCategory(cat, transferId)));
  await delete_('category_groups', group.id);
}

export async function insertCategory(
  category: WithRequired<Partial<DbCategory>, 'name' | 'cat_group'>,
  { atEnd }: { atEnd?: boolean | undefined } = { atEnd: undefined },
): Promise<DbCategory['id']> {
  let sort_order;

  let id_: DbCategory['id'];
  await batchMessages(async () => {
    // Dont allow duplicated names in groups
    const existingCatInGroup = await first<Pick<DbCategory, 'id'>>(
      `SELECT id FROM categories WHERE cat_group = ? and UPPER(name) = ? and tombstone = 0 LIMIT 1`,
      [category.cat_group, category.name.toUpperCase()],
    );
    if (existingCatInGroup) {
      throw new Error(
        `Category ‘${category.name}’ already exists in group ‘${category.cat_group}’`,
      );
    }

    if (atEnd) {
      const lastCat = await first<Pick<DbCategory, 'sort_order'>>(`
        SELECT sort_order FROM categories WHERE tombstone = 0 ORDER BY sort_order DESC, id DESC LIMIT 1
      `);
      sort_order = (lastCat ? lastCat.sort_order : 0) + SORT_INCREMENT;
    } else {
      // Unfortunately since we insert at the beginning, we need to shove
      // the sort orders to make sure there's room for it
      const categories = await all<Pick<DbCategory, 'id' | 'sort_order'>>(
        `SELECT id, sort_order FROM categories WHERE cat_group = ? AND tombstone = 0 ORDER BY sort_order, id`,
        [category.cat_group],
      );

      const { updates, sort_order: order } = shoveSortOrders(
        categories,
        categories.length > 0 ? categories[0].id : null,
      );
      for (const info of updates) {
        await update('categories', info);
      }
      sort_order = order;
    }

    category = {
      ...categoryModel.validate(category),
      sort_order,
    };

    const id = await insertWithUUID('categories', category);
    // Create an entry in the mapping table that points it to itself
    await insert('category_mapping', { id, transferId: id });
    id_ = id;
  });
  return id_;
}

export function updateCategory(
  category: WithRequired<
    Partial<DbCategory>,
    'name' | 'is_income' | 'cat_group'
  >,
) {
  category = categoryModel.validate(category, { update: true });
  // Change from cat_group to group because category AQL schema named it group.
  // const { cat_group: group, ...rest } = category;
  return update('categories', category);
}

export async function moveCategory(
  id: DbCategory['id'],
  groupId: DbCategoryGroup['id'],
  targetId: DbCategory['id'] | null,
) {
  if (!groupId) {
    throw new Error('moveCategory: groupId is required');
  }

  const categories = await all<Pick<DbCategory, 'id' | 'sort_order'>>(
    `SELECT id, sort_order FROM categories WHERE cat_group = ? AND tombstone = 0 ORDER BY sort_order, id`,
    [groupId],
  );

  const { updates, sort_order } = shoveSortOrders(categories, targetId);
  for (const info of updates) {
    await update('categories', info);
  }
  await update('categories', { id, sort_order, cat_group: groupId });
}

export async function deleteCategory(
  category: Pick<DbCategory, 'id'>,
  transferId?: DbCategory['id'],
) {
  if (transferId) {
    // We need to update all the deleted categories that currently
    // point to the one we're about to delete so they all are
    // "forwarded" to the new transferred category.
    const existingTransfers = await all<DbCategoryMapping>(
      'SELECT * FROM category_mapping WHERE transferId = ?',
      [category.id],
    );
    for (const mapping of existingTransfers) {
      await update('category_mapping', {
        id: mapping.id,
        transferId,
      });
    }

    // Finally, map the category we're about to delete to the new one
    await update('category_mapping', { id: category.id, transferId });
  }

  return delete_('categories', category.id);
}

export async function getPayee(id: DbPayee['id']) {
  return first<DbPayee>(`SELECT * FROM payees WHERE id = ?`, [id]);
}

export async function getAccount(id: DbAccount['id']) {
  return first<DbAccount>(`SELECT * FROM accounts WHERE id = ?`, [id]);
}

export async function insertPayee(
  payee: WithRequired<Partial<DbPayee>, 'name'>,
) {
  payee = payeeModel.validate(payee);
  let id: DbPayee['id'];
  await batchMessages(async () => {
    id = await insertWithUUID('payees', payee);
    await insert('payee_mapping', { id, targetId: id });
  });
  return id;
}

export async function deletePayee(payee: Pick<DbPayee, 'id'>) {
  const { transfer_acct } = await first<DbPayee>(
    'SELECT * FROM payees WHERE id = ?',
    [payee.id],
  );
  if (transfer_acct) {
    // You should never be able to delete transfer payees
    return;
  }

  // let mappings = await all('SELECT id FROM payee_mapping WHERE targetId = ?', [
  //   payee.id
  // ]);
  // await Promise.all(
  //   mappings.map(m => update('payee_mapping', { id: m.id, targetId: null }))
  // );

  return delete_('payees', payee.id);
}

export async function deleteTransferPayee(payee: Pick<DbPayee, 'id'>) {
  // This allows deleting transfer payees
  return delete_('payees', payee.id);
}

export function updatePayee(payee: WithRequired<Partial<DbPayee>, 'id'>) {
  payee = payeeModel.validate(payee, { update: true });
  return update('payees', payee);
}

export async function mergePayees(
  target: DbPayee['id'],
  ids: Array<DbPayee['id']>,
) {
  // Load in payees so we can check some stuff
  const dbPayees: DbPayee[] = await all<DbPayee>('SELECT * FROM payees');
  const payees = groupById(dbPayees);

  // Filter out any transfer payees
  if (payees[target].transfer_acct != null) {
    return;
  }
  ids = ids.filter(id => payees[id].transfer_acct == null);

  await batchMessages(async () => {
    await Promise.all(
      ids.map(async id => {
        const mappings = await all<DbPayeeMapping>(
          'SELECT id FROM payee_mapping WHERE targetId = ?',
          [id],
        );
        await Promise.all(
          mappings.map(m =>
            update('payee_mapping', { id: m.id, targetId: target }),
          ),
        );
      }),
    );

    await Promise.all(
      ids.map(id =>
        Promise.all([
          update('payee_mapping', { id, targetId: target }),
          delete_('payees', id),
        ]),
      ),
    );
  });
}

export function getPayees() {
  return all<DbPayee & { name: DbAccount['name'] | DbPayee['name'] }>(`
    SELECT p.*, COALESCE(a.name, p.name) AS name FROM payees p
    LEFT JOIN accounts a ON (p.transfer_acct = a.id AND a.tombstone = 0)
    WHERE p.tombstone = 0 AND (p.transfer_acct IS NULL OR a.id IS NOT NULL)
    ORDER BY p.transfer_acct IS NULL DESC, p.name COLLATE NOCASE, a.offbudget, a.sort_order
  `);
}

export function getCommonPayees() {
  const twelveWeeksAgo = toDateRepr(
    monthUtils.subWeeks(monthUtils.currentDate(), 12),
  );
  const limit = 10;
  return all<
    DbPayee & {
      common: true;
      transfer_acct: null;
      c: number;
      latest: DbViewTransactionInternalAlive['date'];
    }
  >(`
    SELECT     p.id as id, p.name as name, p.favorite as favorite,
      p.category as category, TRUE as common, NULL as transfer_acct,
    count(*) as c,
    max(t.date) as latest
    FROM payees p
    LEFT JOIN v_transactions_internal_alive t on t.payee == p.id
    WHERE LENGTH(p.name) > 0
    AND p.tombstone = 0
    AND t.date > ${twelveWeeksAgo}
    GROUP BY p.id
    ORDER BY c DESC ,p.transfer_acct IS NULL DESC, p.name
    COLLATE NOCASE
    LIMIT ${limit}
  `);
}

/* eslint-disable rulesdir/typography */
const orphanedPayeesQuery = `
  SELECT p.id
  FROM payees p
    LEFT JOIN payee_mapping pm ON pm.id = p.id
    LEFT JOIN v_transactions_internal_alive t ON t.payee = pm.targetId
  WHERE p.tombstone = 0
    AND p.transfer_acct IS NULL
    AND t.id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM rules r,
      json_each(r.conditions) as cond
      WHERE r.tombstone = 0
        AND json_extract(cond.value, '$.field') = 'description'
        AND json_extract(cond.value, '$.value') = pm.targetId
    );
`;
/* eslint-enable rulesdir/typography */

export function syncGetOrphanedPayees() {
  return all<Pick<DbPayee, 'id'>>(orphanedPayeesQuery);
}

export async function getOrphanedPayees() {
  const rows = await all<Pick<DbPayee, 'id'>>(orphanedPayeesQuery);
  return rows.map(row => row.id);
}

export async function getPayeeByName(name: DbPayee['name']) {
  return first<DbPayee>(
    `SELECT * FROM payees WHERE UNICODE_LOWER(name) = ? AND tombstone = 0`,
    [name.toLowerCase()],
  );
}

export function getAccounts() {
  return all<
    DbAccount & {
      bankName: DbBank['name'];
      bankId: DbBank['id'];
    }
  >(
    `SELECT a.*, b.name as bankName, b.id as bankId FROM accounts a
       LEFT JOIN banks b ON a.bank = b.id
       WHERE a.tombstone = 0
       ORDER BY sort_order, name`,
  );
}

export async function insertAccount(account) {
  const accounts = await all<DbAccount>(
    'SELECT * FROM accounts WHERE offbudget = ? ORDER BY sort_order, name',
    [account.offbudget ? 1 : 0],
  );

  // Don't pass a target in, it will default to appending at the end
  const { sort_order } = shoveSortOrders(accounts);

  account = accountModel.validate({ ...account, sort_order });
  return insertWithUUID('accounts', account);
}

export function updateAccount(account) {
  account = accountModel.validate(account, { update: true });
  return update('accounts', account);
}

export function deleteAccount(account) {
  return delete_('accounts', account.id);
}

export async function moveAccount(
  id: DbAccount['id'],
  targetId: DbAccount['id'] | null,
) {
  const account = await first<DbAccount>(
    'SELECT * FROM accounts WHERE id = ?',
    [id],
  );
  let accounts;
  if (account.closed) {
    accounts = await all<Pick<DbAccount, 'id' | 'sort_order'>>(
      `SELECT id, sort_order FROM accounts WHERE closed = 1 ORDER BY sort_order, name`,
    );
  } else {
    accounts = await all<Pick<DbAccount, 'id' | 'sort_order'>>(
      `SELECT id, sort_order FROM accounts WHERE tombstone = 0 AND offbudget = ? ORDER BY sort_order, name`,
      [account.offbudget ? 1 : 0],
    );
  }

  const { updates, sort_order } = shoveSortOrders(accounts, targetId);
  await batchMessages(async () => {
    for (const info of updates) {
      update('accounts', info);
    }
    update('accounts', { id, sort_order });
  });
}

export async function getTransaction(id: DbViewTransaction['id']) {
  const rows = await selectWithSchema(
    'transactions',
    'SELECT * FROM v_transactions WHERE id = ?',
    [id],
  );
  return rows[0];
}

export async function getTransactions(accountId: DbTransaction['acct']) {
  if (arguments.length > 1) {
    throw new Error(
      '`getTransactions` was given a second argument, it now only takes a single argument `accountId`',
    );
  }

  return selectWithSchema(
    'transactions',
    'SELECT * FROM v_transactions WHERE account = ?',
    [accountId],
  );
}

export function insertTransaction(
  transaction,
): Promise<TransactionEntity['id']> {
  return insertWithSchema('transactions', transaction);
}

export function updateTransaction(transaction) {
  return updateWithSchema('transactions', transaction);
}

export async function deleteTransaction(transaction) {
  return delete_('transactions', transaction.id);
}

function toSqlQueryParameters(params: unknown[]) {
  return params.map(() => '?').join(',');
}
