# PostgreSQL Integration - Contributor Guide

## 🎯 Overview

Welcome to the PostgreSQL integration contributor guide! This document provides comprehensive information for developers who want to contribute to, extend, or adopt the PostgreSQL functionality in Actual Budget. Whether you're fixing bugs, adding features, or integrating this solution into your own projects, this guide will help you get started.

## 📋 Table of Contents

1. [Getting Started](#getting-started)
2. [Development Environment Setup](#development-environment-setup)
3. [Architecture Overview](#architecture-overview)
4. [Contributing Guidelines](#contributing-guidelines)
5. [Testing Framework](#testing-framework)
6. [Performance Optimization](#performance-optimization)
7. [Deployment and Operations](#deployment-and-operations)
8. [Community and Support](#community-and-support)

---

## 🚀 Getting Started

### Prerequisites

**System Requirements**
- Node.js 18+ with npm 8+
- PostgreSQL 13+ (for development and testing)
- Docker and Docker Compose (recommended)
- Git for version control

**Knowledge Requirements**
- TypeScript/JavaScript proficiency
- Database concepts (SQL, transactions, migrations)
- Basic understanding of Node.js and npm
- Familiarity with PostgreSQL and SQLite

### Quick Start

**1. Clone and Setup**
```bash
# Clone the repository
git clone https://github.com/actualbudget/actual-server.git
cd actual-server

# Install dependencies
npm install

# Install PostgreSQL client
npm install pg @types/pg
```

**2. Environment Configuration**
```bash
# Copy environment template
cp .env.example .env

# Edit .env with PostgreSQL settings
export ENABLE_POSTGRES=true
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_DATABASE=actual_dev
export POSTGRES_USER=actual_user
export POSTGRES_PASSWORD=dev_password
```

**3. Database Setup**
```bash
# Option 1: Docker (Recommended)
docker-compose -f docker-compose.postgres-test.yml up -d postgres-test

# Option 2: Local PostgreSQL
sudo -u postgres createdb actual_dev
sudo -u postgres createuser actual_user
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE actual_dev TO actual_user;"
```

**4. Verify Setup**
```bash
# Test database connectivity
npm run postgres:test-connection

# Run health checks
npm run postgres:health

# Execute basic tests
npm run test:postgres
```

---

## 🛠️ Development Environment Setup

### Database Configuration

**PostgreSQL Development Server**
```yaml
# docker-compose.dev.yml
version: '3.8'
services:
  postgres-dev:
    image: postgres:15
    environment:
      POSTGRES_DB: actual_dev
      POSTGRES_USER: actual_user
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_dev_data:/var/lib/postgresql/data
    command: >
      postgres
      -c log_statement=all
      -c log_min_duration_statement=100
      -c track_activities=on
      -c track_counts=on
```

**Environment Variables**
```bash
# Development settings
export NODE_ENV=development
export ENABLE_POSTGRES=true
export DATABASE_ADAPTER=postgres
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_DATABASE=actual_dev
export POSTGRES_USER=actual_user
export POSTGRES_PASSWORD=dev_password
export POSTGRES_SSL=false

# Feature flags
export ENABLE_DATABASE_HEALTH_CHECKS=true
export POSTGRES_FALLBACK_TO_SQLITE=true
export POSTGRES_SCHEMA_VALIDATION=true

# Development helpers
export LOG_LEVEL=debug
export POSTGRES_LOG_QUERIES=true
```

### IDE Configuration

**VS Code Settings (.vscode/settings.json)**
```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.codeActionsOnSave": {
    "source.organizeImports": true
  },
  "files.associations": {
    "*.sql": "sql"
  },
  "sql.connections": [
    {
      "name": "Actual PostgreSQL Dev",
      "server": "localhost",
      "port": 5432,
      "database": "actual_dev",
      "username": "actual_user",
      "password": "dev_password"
    }
  ]
}
```

**Useful Extensions**
- PostgreSQL (ms-ossdata.vscode-postgresql)
- SQLTools (mtxr.sqltools)
- Docker (ms-azuretools.vscode-docker)
- TypeScript Importer (pmneo.tsimporter)

### Development Scripts

**Package.json Scripts**
```json
{
  "scripts": {
    "postgres:setup": "node scripts/setup-postgres-dev.js",
    "postgres:migrate": "node scripts/migrate-to-postgres.js",
    "postgres:health": "node scripts/check-postgres-health.js",
    "postgres:test-connection": "node scripts/test-postgres-connection.js",
    "postgres:benchmark": "node scripts/run-postgres-benchmarks.js",
    "postgres:e2e": "node scripts/run-postgres-e2e-tests.js",
    "postgres:reset": "node scripts/reset-postgres-dev.js",
    "dev:postgres": "ENABLE_POSTGRES=true npm run dev",
    "test:postgres": "npm run test -- --grep 'postgres'",
    "lint:postgres": "eslint packages/loot-core/src/server/db/ --ext .ts"
  }
}
```

---

## 🏗️ Architecture Overview

### Core Components

**1. Database Abstraction Layer**
```typescript
// packages/loot-core/src/server/db/index.ts
export interface DatabaseAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  query(sql: string, params: any[]): Promise<any>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export async function switchDatabaseAdapter(adapter: 'sqlite' | 'postgres'): Promise<void> {
  // Implementation handles graceful switching
}
```

**2. Configuration Management**
```typescript
// packages/loot-core/src/server/db/config.ts
export interface DatabaseConfig {
  adapter: 'sqlite' | 'postgres';
  sqlite?: SqliteConfig;
  postgres?: PostgresConfig;
}

export function getDatabaseConfig(): DatabaseConfig {
  // Environment-based configuration resolution
}
```

**3. Health Monitoring**
```typescript
// packages/loot-core/src/server/db/health.ts
export interface HealthCheck {
  name: string;
  check(): Promise<HealthResult>;
  threshold?: number;
}

export class DatabaseHealthMonitor {
  constructor(private callback: (health: DatabaseHealth) => void) {}
  start(interval: number): void;
  stop(): void;
}
```

**4. Migration System**
```typescript
// packages/loot-core/src/server/db/migration.ts
export interface MigrationOptions {
  batchSize?: number;
  validateData?: boolean;
  dryRun?: boolean;
  onProgress?: (progress: MigrationProgress) => void;
}

export async function migrateFromSqliteToPostgres(
  options: MigrationOptions = {}
): Promise<MigrationResult>;
```

### Data Flow Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Application   │    │   Database      │    │   Health        │
│   Layer         │◄──►│   Adapter       │◄──►│   Monitor       │
│                 │    │   Layer         │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Configuration │    │   Migration     │    │   Performance   │
│   Management    │    │   System        │    │   Monitoring    │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SQLite        │    │   PostgreSQL    │    │   Monitoring    │
│   Database      │    │   Database      │    │   Dashboard     │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Extension Points

**1. Custom Database Adapters**
```typescript
// Add support for additional databases
export class MySQLAdapter implements DatabaseAdapter {
  async connect(): Promise<void> { /* implementation */ }
  async disconnect(): Promise<void> { /* implementation */ }
  async query(sql: string, params: any[]): Promise<any> { /* implementation */ }
  async transaction<T>(fn: () => Promise<T>): Promise<T> { /* implementation */ }
}

// Register new adapter
registerDatabaseAdapter('mysql', MySQLAdapter);
```

**2. Custom Health Checks**
```typescript
// Add custom health monitoring
export class CustomHealthCheck implements HealthCheck {
  name = 'Custom Database Check';
  
  async check(): Promise<HealthResult> {
    // Custom health check logic
    return {
      status: 'healthy',
      message: 'Custom check passed',
      duration: 10
    };
  }
}

// Register custom check
healthMonitor.addCheck(new CustomHealthCheck());
```

**3. Migration Extensions**
```typescript
// Custom migration procedures
export class CustomMigrationStep implements MigrationStep {
  name = 'Custom Data Transformation';
  
  async execute(context: MigrationContext): Promise<void> {
    // Custom migration logic
  }
  
  async validate(context: MigrationContext): Promise<boolean> {
    // Custom validation logic
  }
}

// Register custom migration step
migrationSystem.addStep(new CustomMigrationStep());
```

---

## 🤝 Contributing Guidelines

### Code Style and Standards

**TypeScript Configuration**
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": [
    "packages/loot-core/src/server/db/**/*"
  ]
}
```

**ESLint Configuration**
```json
// .eslintrc.js
module.exports = {
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/prefer-const": "error",
    "@typescript-eslint/no-unused-vars": "error",
    "prefer-const": "error",
    "no-var": "error"
  }
};
```

**Code Formatting**
```json
// .prettierrc
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

### Contribution Workflow

**1. Fork and Branch**
```bash
# Fork the repository
gh repo fork actualbudget/actual-server

# Create feature branch
git checkout -b feature/postgres-enhancement

# Make changes
# ... your improvements ...

# Commit with conventional commits
git commit -m "feat(postgres): add connection pooling optimization"
```

**2. Testing Requirements**
```bash
# Run all PostgreSQL tests
npm run test:postgres

# Run specific test suite
npm run test -- --grep "adapter switching"

# Run performance benchmarks
npm run postgres:benchmark

# Run end-to-end tests
npm run postgres:e2e
```

**3. Documentation Updates**
```bash
# Update relevant documentation
docs/
├── POSTGRES_DEPLOYMENT_GUIDE.md
├── TROUBLESHOOTING_GUIDE.md
└── API_REFERENCE.md

# Update code comments
# Add JSDoc for public APIs
/**
 * Switches the database adapter at runtime
 * @param adapter - The target database adapter
 * @returns Promise that resolves when switch is complete
 */
export async function switchDatabaseAdapter(adapter: DatabaseAdapter): Promise<void>
```

**4. Pull Request Process**
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Performance benchmarks run
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes without version bump
```

### Areas for Contribution

**High Priority**
- 🔴 **Performance Optimization**: Query optimization, connection pooling tuning
- 🔴 **Advanced Features**: JSON support, full-text search, materialized views
- 🔴 **Monitoring**: Prometheus metrics, Grafana dashboards
- 🔴 **Security**: SSL/TLS improvements, audit logging

**Medium Priority**
- 🟡 **Additional Adapters**: MySQL, MariaDB, Oracle support
- 🟡 **Cloud Integration**: AWS RDS, Google Cloud SQL, Azure Database
- 🟡 **Migration Tools**: Advanced migration utilities, rollback capabilities
- 🟡 **Testing**: Additional test scenarios, load testing frameworks

**Low Priority**
- 🟢 **Documentation**: API documentation, tutorials, examples
- 🟢 **Tooling**: Development scripts, debugging utilities
- 🟢 **Examples**: Sample applications, integration examples

---

## 🧪 Testing Framework

### Test Structure

```
packages/loot-core/src/server/db/
├── __tests__/
│   ├── adapter-switching.test.ts     # Runtime switching tests
│   ├── migration.test.ts             # Migration process tests
│   ├── health-monitoring.test.ts     # Health check tests
│   ├── performance.test.ts           # Performance benchmarks
│   └── integration.test.ts           # End-to-end integration tests
├── __mocks__/
│   ├── postgres.ts                   # PostgreSQL mocks
│   └── sqlite.ts                     # SQLite mocks
└── test-utils/
    ├── test-data-generator.ts         # Test data utilities
    ├── performance-helpers.ts         # Benchmarking utilities
    └── database-helpers.ts            # Database test utilities
```

### Unit Testing

**Test Example: Adapter Switching**
```typescript
// __tests__/adapter-switching.test.ts
import { switchDatabaseAdapter, getDatabaseAdapter } from '../index';

describe('Database Adapter Switching', () => {
  beforeEach(async () => {
    // Setup test environment
  });

  afterEach(async () => {
    // Cleanup test environment
  });

  it('should switch from SQLite to PostgreSQL', async () => {
    // Arrange
    await setDatabaseAdapter('sqlite');
    expect(getDatabaseAdapter()).toBe('sqlite');

    // Act
    await switchDatabaseAdapter('postgres');

    // Assert
    expect(getDatabaseAdapter()).toBe('postgres');
  });

  it('should handle switching errors gracefully', async () => {
    // Test error scenarios
  });
});
```

**Test Example: Migration Process**
```typescript
// __tests__/migration.test.ts
import { migrateFromSqliteToPostgres } from '../migration';
import { generateTestData } from '../test-utils/test-data-generator';

describe('PostgreSQL Migration', () => {
  it('should migrate sample data successfully', async () => {
    // Arrange
    const testData = await generateTestData({
      transactions: 1000,
      accounts: 5,
      categories: 20
    });

    // Act
    const result = await migrateFromSqliteToPostgres({
      batchSize: 100,
      validateData: true
    });

    // Assert
    expect(result.success).toBe(true);
    expect(result.migratedTables.length).toBeGreaterThan(0);
    expect(result.totalRows).toBe(1025); // 1000 + 5 + 20
  });
});
```

### Integration Testing

**End-to-End Test Suite**
```typescript
// __tests__/integration.test.ts
import { runCompleteE2ETest } from '../e2e-postgres-test';

describe('PostgreSQL Integration E2E', () => {
  it('should pass comprehensive integration tests', async () => {
    const results = await runCompleteE2ETest();
    
    expect(results.summary.overallStatus).toBe('pass');
    expect(results.summary.totalFailed).toBe(0);
    
    // Verify all test suites passed
    for (const suite of results.suites) {
      expect(suite.summary.failed).toBe(0);
    }
  });
});
```

### Performance Testing

**Benchmark Test Example**
```typescript
// __tests__/performance.test.ts
import { runComprehensiveBenchmarks } from '../performance-benchmarks';

describe('PostgreSQL Performance', () => {
  it('should meet performance benchmarks', async () => {
    const results = await runComprehensiveBenchmarks();
    
    // Assert performance requirements
    const concurrentSuite = results.suites.find(s => s.name === 'Concurrent Operations');
    const postgresResult = concurrentSuite?.comparison.find(c => 
      c.postgres.name === 'Concurrent Read Operations'
    );
    
    expect(postgresResult?.postgres.avgTime).toBeLessThan(100); // < 100ms
    expect(postgresResult?.postgres.throughput).toBeGreaterThan(10); // > 10 ops/sec
  });
});
```

### Test Data Management

**Test Data Generator**
```typescript
// test-utils/test-data-generator.ts
export interface TestDataConfig {
  accounts?: number;
  categories?: number;
  transactions?: number;
  timeSpan?: number; // months
}

export async function generateTestData(config: TestDataConfig): Promise<TestData> {
  // Generate realistic test data
  return {
    accounts: generateAccounts(config.accounts || 3),
    categories: generateCategories(config.categories || 15),
    transactions: generateTransactions(config.transactions || 1000),
    metadata: {
      generatedAt: new Date(),
      config
    }
  };
}
```

### Running Tests

**Test Commands**
```bash
# Run all PostgreSQL tests
npm run test:postgres

# Run specific test file
npm test __tests__/adapter-switching.test.ts

# Run tests with coverage
npm run test:coverage

# Run performance benchmarks
npm run postgres:benchmark

# Run end-to-end tests
npm run postgres:e2e

# Run tests in watch mode
npm run test:watch
```

**Continuous Integration**
```yaml
# .github/workflows/postgres-tests.yml
name: PostgreSQL Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test_password
          POSTGRES_DB: actual_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run PostgreSQL tests
        run: npm run test:postgres
        env:
          POSTGRES_HOST: localhost
          POSTGRES_PORT: 5432
          POSTGRES_DATABASE: actual_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: test_password
```

---

## ⚡ Performance Optimization

### Query Optimization

**Index Strategy**
```sql
-- Recommended indexes for PostgreSQL
CREATE INDEX CONCURRENTLY idx_transactions_date_acct 
ON transactions(date, acct) WHERE tombstone = 0;

CREATE INDEX CONCURRENTLY idx_transactions_category 
ON transactions(category) WHERE tombstone = 0;

CREATE INDEX CONCURRENTLY idx_transactions_payee 
ON transactions(payee) WHERE tombstone = 0;

-- Composite index for common queries
CREATE INDEX CONCURRENTLY idx_transactions_search 
ON transactions(date DESC, amount, description) WHERE tombstone = 0;
```

**Query Patterns**
```typescript
// Optimized query patterns
export class PostgresOptimizations {
  // Use prepared statements for frequent queries
  static async getTransactionsByAccount(accountId: string) {
    return runQuery(`
      SELECT t.*, a.name as account_name, c.name as category_name
      FROM transactions t
      JOIN accounts a ON t.acct = a.id
      LEFT JOIN categories c ON t.category = c.id
      WHERE t.acct = $1 AND t.tombstone = 0
      ORDER BY t.date DESC, t.id DESC
      LIMIT 1000
    `, [accountId]);
  }

  // Use window functions for analytics
  static async getSpendingTrends() {
    return runQuery(`
      SELECT 
        date_trunc('month', to_date(date::text, 'YYYYMMDD')) as month,
        category,
        SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) as spent,
        LAG(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END)) 
          OVER (PARTITION BY category ORDER BY date_trunc('month', to_date(date::text, 'YYYYMMDD'))) as prev_month
      FROM transactions
      WHERE tombstone = 0
      GROUP BY month, category
      ORDER BY month DESC, spent DESC
    `);
  }
}
```

### Connection Pool Optimization

**Pool Configuration**
```typescript
// packages/loot-core/src/server/db/postgres-pool.ts
export interface PoolConfig {
  min: number;          // Minimum connections
  max: number;          // Maximum connections
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  acquireTimeoutMillis: number;
}

export function getOptimalPoolConfig(): PoolConfig {
  const cpuCount = require('os').cpus().length;
  
  return {
    min: Math.max(2, Math.floor(cpuCount / 2)),
    max: Math.max(10, cpuCount * 2),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    acquireTimeoutMillis: 60000
  };
}
```

**Connection Monitoring**
```typescript
// Monitor connection pool health
export class ConnectionPoolMonitor {
  private pool: Pool;
  
  constructor(pool: Pool) {
    this.pool = pool;
  }
  
  getStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      utilization: (this.pool.totalCount - this.pool.idleCount) / this.pool.totalCount
    };
  }
  
  async checkHealth(): Promise<PoolHealth> {
    const stats = this.getStats();
    const startTime = Date.now();
    
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      
      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        utilization: stats.utilization,
        stats
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        stats
      };
    }
  }
}
```

### Caching Strategies

**Query Result Caching**
```typescript
// packages/loot-core/src/server/db/cache.ts
export class QueryCache {
  private cache = new Map<string, CacheEntry>();
  private ttl: number;
  
  constructor(ttlMs: number = 300000) { // 5 minutes default
    this.ttl = ttlMs;
  }
  
  private generateKey(sql: string, params: any[]): string {
    return `${sql}:${JSON.stringify(params)}`;
  }
  
  async get<T>(sql: string, params: any[]): Promise<T | null> {
    const key = this.generateKey(sql, params);
    const entry = this.cache.get(key);
    
    if (entry && Date.now() - entry.timestamp < this.ttl) {
      return entry.data;
    }
    
    return null;
  }
  
  set<T>(sql: string, params: any[], data: T): void {
    const key = this.generateKey(sql, params);
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
}
```

### Performance Monitoring

**Real-time Metrics**
```typescript
// packages/loot-core/src/server/db/metrics.ts
export class DatabaseMetrics {
  private queryMetrics = new Map<string, QueryMetric>();
  
  recordQuery(sql: string, duration: number, params?: any[]) {
    const key = this.normalizeQuery(sql);
    const metric = this.queryMetrics.get(key) || {
      query: key,
      count: 0,
      totalTime: 0,
      avgTime: 0,
      minTime: Infinity,
      maxTime: 0
    };
    
    metric.count++;
    metric.totalTime += duration;
    metric.avgTime = metric.totalTime / metric.count;
    metric.minTime = Math.min(metric.minTime, duration);
    metric.maxTime = Math.max(metric.maxTime, duration);
    
    this.queryMetrics.set(key, metric);
  }
  
  getSlowQueries(threshold: number = 1000): QueryMetric[] {
    return Array.from(this.queryMetrics.values())
      .filter(metric => metric.avgTime > threshold)
      .sort((a, b) => b.avgTime - a.avgTime);
  }
  
  exportPrometheusMetrics(): string {
    let metrics = '';
    
    for (const [query, metric] of this.queryMetrics) {
      metrics += `db_query_duration_ms{query="${query}"} ${metric.avgTime}\n`;
      metrics += `db_query_count_total{query="${query}"} ${metric.count}\n`;
    }
    
    return metrics;
  }
}
```

---

## 🚀 Deployment and Operations

### Production Deployment

**Docker Production Setup**
```dockerfile
# Dockerfile.postgres
FROM node:18-alpine

# Install PostgreSQL client
RUN apk add --no-cache postgresql-client

# Copy application
COPY . /app
WORKDIR /app

# Install dependencies
RUN npm ci --only=production

# Set production environment
ENV NODE_ENV=production
ENV ENABLE_POSTGRES=true

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD npm run postgres:health || exit 1

# Start application
CMD ["npm", "start"]
```

**Docker Compose Production**
```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: ${POSTGRES_DATABASE}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres-init:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    command: >
      postgres
      -c shared_buffers=256MB
      -c effective_cache_size=1GB
      -c maintenance_work_mem=64MB
      -c checkpoint_completion_target=0.9
      -c wal_buffers=16MB
      -c default_statistics_target=100
      -c random_page_cost=1.1
      -c effective_io_concurrency=200
    restart: unless-stopped

  actual:
    build:
      context: .
      dockerfile: Dockerfile.postgres
    environment:
      - ENABLE_POSTGRES=true
      - POSTGRES_HOST=postgres
      - POSTGRES_PORT=5432
      - POSTGRES_DATABASE=${POSTGRES_DATABASE}
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_SSL=false
    volumes:
      - actual_data:/app/data
    ports:
      - "5006:5006"
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  postgres_data:
  actual_data:
```

### Kubernetes Deployment

**Deployment Manifest**
```yaml
# k8s/postgres-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: actual-postgres
spec:
  replicas: 3
  selector:
    matchLabels:
      app: actual-postgres
  template:
    metadata:
      labels:
        app: actual-postgres
    spec:
      containers:
      - name: actual
        image: actual/server:postgres-latest
        env:
        - name: ENABLE_POSTGRES
          value: "true"
        - name: POSTGRES_HOST
          value: "postgres-service"
        - name: POSTGRES_DATABASE
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: database
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: username
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: password
        ports:
        - containerPort: 5006
        livenessProbe:
          httpGet:
            path: /health
            port: 5006
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 5006
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Monitoring and Alerting

**Prometheus Configuration**
```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'actual-postgres'
    static_configs:
      - targets: ['actual:5006']
    metrics_path: /metrics
    scrape_interval: 30s

  - job_name: 'postgres-exporter'
    static_configs:
      - targets: ['postgres-exporter:9187']
    scrape_interval: 30s

rule_files:
  - "alert-rules.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
```

**Alert Rules**
```yaml
# alert-rules.yml
groups:
  - name: actual-postgres
    rules:
      - alert: PostgreSQLDown
        expr: up{job="postgres-exporter"} == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL is down"
          description: "PostgreSQL has been down for more than 5 minutes"

      - alert: HighConnectionUsage
        expr: postgres_stat_database_numbackends / postgres_settings_max_connections > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High PostgreSQL connection usage"
          description: "PostgreSQL connection usage is above 80%"

      - alert: SlowQueries
        expr: actual_db_query_duration_ms > 1000
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Slow database queries detected"
          description: "Database queries are taking longer than 1 second"
```

**Grafana Dashboard**
```json
{
  "dashboard": {
    "title": "Actual Budget PostgreSQL",
    "panels": [
      {
        "title": "Query Performance",
        "type": "graph",
        "targets": [
          {
            "expr": "actual_db_query_duration_ms",
            "legendFormat": "{{query}}"
          }
        ]
      },
      {
        "title": "Connection Pool",
        "type": "graph",
        "targets": [
          {
            "expr": "actual_db_pool_active_connections",
            "legendFormat": "Active"
          },
          {
            "expr": "actual_db_pool_idle_connections",
            "legendFormat": "Idle"
          }
        ]
      },
      {
        "title": "Database Health",
        "type": "singlestat",
        "targets": [
          {
            "expr": "actual_db_health_status",
            "legendFormat": "Health Status"
          }
        ]
      }
    ]
  }
}
```

### Backup and Recovery

**Automated Backup Script**
```bash
#!/bin/bash
# scripts/backup-postgres.sh

set -e

BACKUP_DIR="/backups/postgres"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# PostgreSQL backup
echo "Creating PostgreSQL backup..."
pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DATABASE" \
  --no-password --verbose --clean --create \
  | gzip > "$BACKUP_DIR/postgres_backup_$TIMESTAMP.sql.gz"

# Verify backup
echo "Verifying backup..."
gunzip -t "$BACKUP_DIR/postgres_backup_$TIMESTAMP.sql.gz"

# Cleanup old backups
echo "Cleaning up old backups..."
find "$BACKUP_DIR" -name "postgres_backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete

# Log backup completion
echo "Backup completed successfully: postgres_backup_$TIMESTAMP.sql.gz"
```

**Recovery Procedure**
```bash
#!/bin/bash
# scripts/restore-postgres.sh

BACKUP_FILE="$1"
RESTORE_DATABASE="${2:-actual_budget_restore}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup-file> [restore-database]"
  exit 1
fi

echo "Restoring PostgreSQL backup..."
echo "Backup file: $BACKUP_FILE"
echo "Target database: $RESTORE_DATABASE"

# Create restore database
createdb -h "$POSTGRES_HOST" -U "$POSTGRES_USER" "$RESTORE_DATABASE"

# Restore from backup
gunzip -c "$BACKUP_FILE" | \
  psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$RESTORE_DATABASE"

echo "Restore completed successfully"
```

---

## 🌐 Community and Support

### Getting Help

**Documentation Resources**
- [PostgreSQL Deployment Guide](./POSTGRES_DEPLOYMENT_GUIDE.md)
- [Troubleshooting Guide](./TROUBLESHOOTING_GUIDE.md)
- [Real-World Test Guide](./REAL_WORLD_TEST_GUIDE.md)
- [API Reference](./API_REFERENCE.md)

**Community Channels**
- GitHub Issues: Report bugs and request features
- Discord: Join the Actual Budget community for discussions
- GitHub Discussions: Ask questions and share experiences
- Stack Overflow: Tag questions with `actual-budget` and `postgresql`

**Support Tiers**

**Community Support (Free)**
- GitHub Issues for bug reports
- Community Discord discussions
- Documentation and guides
- Community-contributed examples

**Commercial Support (Available)**
- Priority bug fixes and feature requests
- Custom deployment assistance
- Performance optimization consulting
- Training and workshops

### Reporting Issues

**Bug Report Template**
```markdown
## Bug Description
Clear description of the issue

## Environment
- Node.js version:
- PostgreSQL version:
- Actual Budget version:
- Operating System:

## Steps to Reproduce
1. 
2. 
3. 

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Logs
```
Relevant log output
```

## Additional Context
Any other relevant information
```

**Feature Request Template**
```markdown
## Feature Description
Clear description of the proposed feature

## Use Case
Why is this feature needed?

## Proposed Solution
How should this feature work?

## Alternatives Considered
Other approaches you've considered

## Additional Context
Any other relevant information
```

### Contributing Code

**Development Process**
1. **Discussion**: Create an issue to discuss the feature/fix
2. **Planning**: Agree on approach and implementation details
3. **Development**: Create feature branch and implement changes
4. **Testing**: Comprehensive testing including edge cases
5. **Documentation**: Update relevant documentation
6. **Review**: Submit pull request for community review
7. **Integration**: Merge after approval and testing

**Code Review Guidelines**
- Focus on code quality, performance, and maintainability
- Check for adequate test coverage
- Verify documentation updates
- Ensure backward compatibility
- Validate security implications

**Release Process**
- Semantic versioning (MAJOR.MINOR.PATCH)
- Comprehensive changelog
- Migration guides for breaking changes
- Beta releases for major features
- Community testing period

### Recognition and Credits

**Contributors**
We maintain a list of all contributors who have helped improve the PostgreSQL integration:

- Code contributors
- Documentation writers  
- Testers and QA volunteers
- Issue reporters and triagers
- Community moderators

**How to Get Recognized**
- Contribute code, documentation, or testing
- Help other community members
- Report detailed bug reports
- Participate in discussions and planning
- Share usage examples and tutorials

### Roadmap and Planning

**Current Priorities**
1. Performance optimization and query tuning
2. Advanced PostgreSQL features (JSON, full-text search)
3. Cloud database integration
4. Enhanced monitoring and observability

**Long-term Vision**
- Multi-database support (MySQL, Oracle, etc.)
- Advanced analytics and reporting
- Real-time collaboration features
- Enterprise security and compliance
- Microservices architecture support

**Community Input**
We actively seek community input on:
- Feature prioritization
- API design decisions
- Performance optimization targets
- Documentation improvements
- Testing strategies

---

## 🎉 Conclusion

The PostgreSQL integration for Actual Budget represents a collaborative effort to bring enterprise-grade database capabilities to the personal finance management space. This contributor guide provides the foundation for continued development and improvement of this integration.

**Key Takeaways:**
- **Open Architecture**: Extensible design welcomes contributions
- **Comprehensive Testing**: Robust testing framework ensures quality
- **Production Ready**: Real-world validation and deployment guides
- **Community Driven**: Active community support and collaboration
- **Future Focused**: Roadmap aligned with modern database trends

**Get Involved:**
Whether you're fixing bugs, adding features, improving documentation, or helping other users, your contributions make Actual Budget better for everyone. Join our community and help shape the future of this PostgreSQL integration!

**Start Contributing Today:**
1. Set up your development environment
2. Explore the codebase and documentation
3. Pick an issue or propose a feature
4. Join the community discussions
5. Submit your first contribution

Together, we're building the most capable and flexible personal finance management platform available. Welcome to the community! 🚀