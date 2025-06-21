// @ts-strict-ignore
import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

import { removeFile, writeFile, readFile } from '../fs/index.electron';

// Connection pool for PostgreSQL
let pgPool: Pool | null = null;

// Prepared statement cache
const preparedStatements = new Map<string, string>();

// Transaction depth tracking for nested transactions
let transactionDepth = 0;

// Type definitions
export interface Database {
  pool: Pool;
  client?: PoolClient;
}

interface PreparedStatement {
  sql: string;
  paramCount: number;
}

function verifyParamTypes(sql: string, arr: (string | number | null)[]) {
  arr.forEach(val => {
    if (typeof val !== 'string' && typeof val !== 'number' && val !== null) {
      console.log(sql, arr);
      throw new Error('Invalid field type ' + val + ' for sql ' + sql);
    }
  });
}

// Convert SQLite ? parameters to PostgreSQL $1, $2, etc.
function convertParameterBinding(sql: string): {
  sql: string;
  paramCount: number;
} {
  let paramCount = 0;
  const convertedSql = sql.replace(/\?/g, () => {
    paramCount++;
    return `$${paramCount}`;
  });
  return { sql: convertedSql, paramCount };
}

// PostgreSQL custom functions (equivalent to SQLite custom functions)
const POSTGRES_CUSTOM_FUNCTIONS = `
-- Unicode-aware LOWER function
CREATE OR REPLACE FUNCTION UNICODE_LOWER(text_input TEXT)
RETURNS TEXT AS $$
BEGIN
  IF text_input IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN LOWER(text_input);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Unicode-aware UPPER function
CREATE OR REPLACE FUNCTION UNICODE_UPPER(text_input TEXT)
RETURNS TEXT AS $$
BEGIN
  IF text_input IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN UPPER(text_input);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Unicode-aware LIKE function with pattern caching
CREATE OR REPLACE FUNCTION UNICODE_LIKE(pattern TEXT, text_value TEXT)
RETURNS INTEGER AS $$
DECLARE
  regex_pattern TEXT;
BEGIN
  IF pattern IS NULL THEN
    RETURN 0;
  END IF;
  
  IF text_value IS NULL THEN
    text_value := '';
  END IF;
  
  -- Convert SQL LIKE pattern to regex pattern
  -- Escape regex special chars except % and ?
  -- Convert % to .* and ? to .
  regex_pattern := regexp_replace(pattern, '[.\\*\\+\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\]', '\\\\&', 'g');
  regex_pattern := replace(regex_pattern, '?', '.');
  regex_pattern := replace(regex_pattern, '%', '.*');
  
  RETURN CASE WHEN text_value ~* regex_pattern THEN 1 ELSE 0 END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Regular expression function
CREATE OR REPLACE FUNCTION REGEXP(pattern TEXT, text_input TEXT)
RETURNS INTEGER AS $$
BEGIN
  IF text_input IS NULL THEN
    text_input := '';
  END IF;
  
  RETURN CASE WHEN text_input ~ pattern THEN 1 ELSE 0 END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Text normalization function
CREATE OR REPLACE FUNCTION NORMALISE(text_input TEXT)
RETURNS TEXT AS $$
BEGIN
  IF text_input IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Convert to lowercase and normalize Unicode
  -- PostgreSQL doesn't have built-in diacritic removal, so we approximate
  RETURN LOWER(unaccent(text_input));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
`;

export async function init() {
  // Initialize PostgreSQL connection and custom functions
  if (!pgPool) {
    throw new Error('Database not opened. Call openDatabase first.');
  }
  
  const client = await pgPool.connect();
  try {
    // Install unaccent extension for NORMALISE function
    await client.query('CREATE EXTENSION IF NOT EXISTS unaccent;');
    
    // Create custom functions
    await client.query(POSTGRES_CUSTOM_FUNCTIONS);
    
    console.log('✅ PostgreSQL custom functions initialized');
  } catch (error) {
    console.warn('Some custom functions may not have been created:', error.message);
  } finally {
    client.release();
  }
}

export function prepare(db: Database, sql: string): PreparedStatement {
  const converted = convertParameterBinding(sql);
  const statementId = uuidv4();
  preparedStatements.set(statementId, converted.sql);
  
  return {
    sql: statementId,
    paramCount: converted.paramCount
  };
}

export async function runQuery(
  db: Database,
  sql: string | PreparedStatement,
  params: (string | number | null)[] = [],
  fetchAll = false,
) {
  if (params) {
    verifyParamTypes(typeof sql === 'string' ? sql : sql.sql, params);
  }

  let finalSql: string;
  if (typeof sql === 'string') {
    const converted = convertParameterBinding(sql);
    finalSql = converted.sql;
  } else {
    finalSql = preparedStatements.get(sql.sql) || sql.sql;
  }

  const client = db.client || await db.pool.connect();
  const shouldRelease = !db.client;
  
  try {
    const result = await client.query(finalSql, params);
    
    if (fetchAll) {
      return result.rows;
    } else {
      return { 
        changes: result.rowCount || 0, 
        insertId: result.rows[0]?.id || null 
      };
    }
  } catch (e) {
    console.log('error', finalSql, params);
    throw e;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

export async function execQuery(db: Database, sql: string) {
  const converted = convertParameterBinding(sql);
  const client = db.client || await db.pool.connect();
  const shouldRelease = !db.client;
  
  try {
    await client.query(converted.sql);
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

export async function transaction(db: Database, fn: () => void | Promise<void>) {
  const client = await db.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Set client on database object for transaction queries
    const originalClient = db.client;
    db.client = client;
    
    try {
      await fn();
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      db.client = originalClient;
    }
  } finally {
    client.release();
  }
}

// Async transaction with nested support using savepoints
export async function asyncTransaction(
  db: Database,
  fn: () => Promise<void>,
) {
  const client = db.client || await db.pool.connect();
  const shouldRelease = !db.client;
  const savepointName = `sp_${transactionDepth}`;
  
  if (transactionDepth === 0) {
    await client.query('BEGIN');
  } else {
    await client.query(`SAVEPOINT ${savepointName}`);
  }
  
  transactionDepth++;
  
  // Set client on database object for transaction queries
  const originalClient = db.client;
  if (!db.client) {
    db.client = client;
  }

  try {
    await fn();
  } catch (error) {
    if (transactionDepth === 1) {
      await client.query('ROLLBACK');
    } else {
      await client.query(`ROLLBACK TO ${savepointName}`);
    }
    throw error;
  } finally {
    transactionDepth--;
    
    if (transactionDepth === 0) {
      await client.query('COMMIT');
      if (!originalClient) {
        db.client = originalClient;
      }
    } else {
      await client.query(`RELEASE ${savepointName}`);
    }
    
    if (shouldRelease && transactionDepth === 0) {
      client.release();
    }
  }
}

export function openDatabase(config?: any): Database {
  // Use configuration or fall back to environment variables
  const connectionString = config?.connectionString || 
    process.env.DATABASE_URL || 
    'postgresql://actual_user:1234567890@localhost:5432/actual';

  const poolConfig = {
    connectionString,
    max: config?.maxConnections || 20,
    idleTimeoutMillis: config?.idleTimeoutMs || 30000,
    connectionTimeoutMillis: config?.connectionTimeoutMs || 2000,
  };

  console.log('🐘 Opening PostgreSQL connection...', {
    maxConnections: poolConfig.max,
    idleTimeout: poolConfig.idleTimeoutMillis,
    connectionTimeout: poolConfig.connectionTimeoutMillis,
  });

  pgPool = new Pool(poolConfig);

  const db: Database = { pool: pgPool };

  // Initialize custom functions asynchronously
  init().catch(error => {
    console.warn('PostgreSQL initialization warning:', error.message);
  });

  return db;
}

export function closeDatabase(db: Database) {
  if (db.pool) {
    db.pool.end().catch(error => {
      console.warn('PostgreSQL close warning:', error.message);
    });
  }
  if (pgPool) {
    pgPool.end().catch(error => {
      console.warn('PostgreSQL pool close warning:', error.message);
    });
    pgPool = null;
  }
}

// Re-export functions from init-schema for convenience
export { initializePostgresSchema, isSchemaInitialized, dropSchema } from './init-schema';

export async function exportDatabase(db: Database): Promise<Uint8Array> {
  // PostgreSQL doesn't have direct binary export like SQLite
  // Use pg_dump to create SQL dump and return as binary
  const dumpFileName = `${process.env.ACTUAL_DATA_DIR}/backup-for-export-${uuidv4()}.sql`;
  
  try {
    // This would require pg_dump to be available
    // For now, we'll create a basic export of key tables
    const client = await db.pool.connect();
    
    try {
      // Get list of tables
      const tablesResult = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
      `);
      
      let sqlDump = '-- PostgreSQL database dump\\n';
      
      for (const row of tablesResult.rows) {
        const tableName = row.table_name;
        
        // Export table structure
        const createTableResult = await client.query(
          'SELECT pg_get_tabledef($1) as table_def',
          [tableName],
        );
        
        if (createTableResult.rows.length > 0) {
          sqlDump += `\\n-- Table: ${tableName}\\n`;
          sqlDump += createTableResult.rows[0].table_def + ';\\n';
        }
        
        // Export data
        const dataResult = await client.query('SELECT * FROM ' + tableName);
        if (dataResult.rows.length > 0) {
          sqlDump += `\\n-- Data for table: ${tableName}\\n`;
          for (const dataRow of dataResult.rows) {
            const values = Object.values(dataRow)
              .map(val =>
                val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`,
              )
              .join(', ');
            const columns = Object.keys(dataRow).join(', ');
            sqlDump += `INSERT INTO ${tableName} (${columns}) VALUES (${values});\\n`;
          }
        }
      }
      
      await writeFile(dumpFileName, sqlDump);
      const data = await readFile(dumpFileName, 'binary');
      await removeFile(dumpFileName);
      
      return data;
    } finally {
      client.release();
    }
  } catch (error) {
    // Clean up dump file if it exists
    try {
      await removeFile(dumpFileName);
    } catch {}
    throw error;
  }
}