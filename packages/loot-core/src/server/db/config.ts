// Database configuration and feature flags for adapter switching
// @ts-strict-ignore

export type DatabaseAdapter = 'sqlite' | 'postgres';

export interface DatabaseConfig {
  adapter: DatabaseAdapter;
  sqlite?: {
    path?: string;
    pragmas?: Record<string, string | number>;
  };
  postgres?: {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    ssl?: boolean;
    maxConnections?: number;
    connectionTimeoutMs?: number;
    idleTimeoutMs?: number;
  };
}

// Environment variable mappings for feature flags
const ENV_FLAGS = {
  // Primary feature flag
  ENABLE_POSTGRES: process.env.ENABLE_POSTGRES === 'true',
  
  // Database adapter selection (can override ENABLE_POSTGRES)
  DATABASE_ADAPTER: process.env.DATABASE_ADAPTER as DatabaseAdapter,
  
  // PostgreSQL connection settings
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_HOST: process.env.POSTGRES_HOST || 'localhost',
  POSTGRES_PORT: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  POSTGRES_DATABASE: process.env.POSTGRES_DATABASE || 'actual',
  POSTGRES_USERNAME: process.env.POSTGRES_USERNAME || 'actual_user',
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || '1234567890',
  POSTGRES_SSL: process.env.POSTGRES_SSL === 'true',
  POSTGRES_MAX_CONNECTIONS: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '20', 10),
  POSTGRES_CONNECTION_TIMEOUT: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT || '2000', 10),
  POSTGRES_IDLE_TIMEOUT: parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '30000', 10),
  
  // Development and testing flags
  FORCE_POSTGRES_MIGRATION: process.env.FORCE_POSTGRES_MIGRATION === 'true',
  POSTGRES_SCHEMA_VALIDATION: process.env.POSTGRES_SCHEMA_VALIDATION !== 'false',
  ENABLE_DATABASE_HEALTH_CHECKS: process.env.ENABLE_DATABASE_HEALTH_CHECKS !== 'false',
  
  // Fallback behavior
  POSTGRES_FALLBACK_TO_SQLITE: process.env.POSTGRES_FALLBACK_TO_SQLITE !== 'false',
};

/**
 * Determine the active database adapter based on environment flags
 */
export function getActiveAdapter(): DatabaseAdapter {
  // Explicit adapter override takes precedence
  if (ENV_FLAGS.DATABASE_ADAPTER) {
    if (ENV_FLAGS.DATABASE_ADAPTER === 'postgres' || ENV_FLAGS.DATABASE_ADAPTER === 'sqlite') {
      return ENV_FLAGS.DATABASE_ADAPTER;
    }
    console.warn(`Invalid DATABASE_ADAPTER value: ${ENV_FLAGS.DATABASE_ADAPTER}, falling back to feature flag detection`);
  }
  
  // PostgreSQL feature flag
  if (ENV_FLAGS.ENABLE_POSTGRES) {
    return 'postgres';
  }
  
  // Default to SQLite
  return 'sqlite';
}

/**
 * Check if PostgreSQL is enabled via feature flags
 */
export function isPostgresEnabled(): boolean {
  return getActiveAdapter() === 'postgres';
}

/**
 * Check if SQLite fallback is enabled
 */
export function isFallbackToSqliteEnabled(): boolean {
  return ENV_FLAGS.POSTGRES_FALLBACK_TO_SQLITE;
}

/**
 * Check if PostgreSQL migration is forced
 */
export function isPostgresMigrationForced(): boolean {
  return ENV_FLAGS.FORCE_POSTGRES_MIGRATION;
}

/**
 * Check if schema validation is enabled
 */
export function isSchemaValidationEnabled(): boolean {
  return ENV_FLAGS.POSTGRES_SCHEMA_VALIDATION;
}

/**
 * Check if database health checks are enabled
 */
export function areHealthChecksEnabled(): boolean {
  return ENV_FLAGS.ENABLE_DATABASE_HEALTH_CHECKS;
}

/**
 * Generate database configuration based on environment flags
 */
export function getDatabaseConfig(): DatabaseConfig {
  const adapter = getActiveAdapter();
  
  const config: DatabaseConfig = {
    adapter,
    sqlite: {
      pragmas: {
        journal_mode: 'WAL',
        synchronous: 'NORMAL',
        cache_size: 1000,
        foreign_keys: 1,
        temp_store: 'MEMORY',
      },
    },
  };
  
  if (adapter === 'postgres') {
    config.postgres = {
      connectionString: ENV_FLAGS.DATABASE_URL,
      host: ENV_FLAGS.POSTGRES_HOST,
      port: ENV_FLAGS.POSTGRES_PORT,
      database: ENV_FLAGS.POSTGRES_DATABASE,
      username: ENV_FLAGS.POSTGRES_USERNAME,
      password: ENV_FLAGS.POSTGRES_PASSWORD,
      ssl: ENV_FLAGS.POSTGRES_SSL,
      maxConnections: ENV_FLAGS.POSTGRES_MAX_CONNECTIONS,
      connectionTimeoutMs: ENV_FLAGS.POSTGRES_CONNECTION_TIMEOUT,
      idleTimeoutMs: ENV_FLAGS.POSTGRES_IDLE_TIMEOUT,
    };
  }
  
  return config;
}

/**
 * Validate PostgreSQL configuration
 */
export function validatePostgresConfig(config: DatabaseConfig): string[] {
  const errors: string[] = [];
  
  if (!config.postgres) {
    errors.push('PostgreSQL configuration is missing');
    return errors;
  }
  
  const pg = config.postgres;
  
  // Check for connection string or individual connection parameters
  if (!pg.connectionString && (!pg.host || !pg.database || !pg.username)) {
    errors.push('PostgreSQL connection requires either DATABASE_URL or host/database/username');
  }
  
  // Validate numeric values
  if (pg.port && (pg.port < 1 || pg.port > 65535)) {
    errors.push('PostgreSQL port must be between 1 and 65535');
  }
  
  if (pg.maxConnections && pg.maxConnections < 1) {
    errors.push('PostgreSQL max connections must be at least 1');
  }
  
  if (pg.connectionTimeoutMs && pg.connectionTimeoutMs < 1000) {
    errors.push('PostgreSQL connection timeout should be at least 1000ms');
  }
  
  return errors;
}

/**
 * Get connection string for PostgreSQL
 */
export function getPostgresConnectionString(config: DatabaseConfig): string {
  if (!config.postgres) {
    throw new Error('PostgreSQL configuration not found');
  }
  
  const pg = config.postgres;
  
  // Use explicit connection string if provided
  if (pg.connectionString) {
    return pg.connectionString;
  }
  
  // Build connection string from components
  const protocol = pg.ssl ? 'postgres' : 'postgres';
  const auth = pg.password ? `${pg.username}:${pg.password}` : pg.username;
  const host = pg.port && pg.port !== 5432 ? `${pg.host}:${pg.port}` : pg.host;
  
  return `${protocol}://${auth}@${host}/${pg.database}`;
}

/**
 * Display current database configuration (safe for logging)
 */
export function getConfigSummary(): string {
  const config = getDatabaseConfig();
  const adapter = config.adapter;
  
  let summary = `Database Adapter: ${adapter}`;
  
  if (adapter === 'postgres' && config.postgres) {
    const pg = config.postgres;
    summary += `\n  Host: ${pg.host}:${pg.port}`;
    summary += `\n  Database: ${pg.database}`;
    summary += `\n  Username: ${pg.username}`;
    summary += `\n  SSL: ${pg.ssl ? 'enabled' : 'disabled'}`;
    summary += `\n  Max Connections: ${pg.maxConnections}`;
    summary += `\n  Fallback to SQLite: ${isFallbackToSqliteEnabled() ? 'enabled' : 'disabled'}`;
  }
  
  summary += `\n  Health Checks: ${areHealthChecksEnabled() ? 'enabled' : 'disabled'}`;
  summary += `\n  Schema Validation: ${isSchemaValidationEnabled() ? 'enabled' : 'disabled'}`;
  
  return summary;
}

// Export environment flags for external access
export { ENV_FLAGS };