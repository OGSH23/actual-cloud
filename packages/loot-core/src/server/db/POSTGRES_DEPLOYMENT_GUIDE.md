# PostgreSQL Integration - Production Deployment Guide

This guide provides comprehensive instructions for deploying Actual Budget with PostgreSQL integration in production environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Configuration](#environment-configuration)
3. [PostgreSQL Setup](#postgresql-setup)
4. [Docker Deployment](#docker-deployment)
5. [Manual Deployment](#manual-deployment)
6. [Data Migration](#data-migration)
7. [Health Monitoring](#health-monitoring)
8. [Performance Tuning](#performance-tuning)
9. [Backup and Recovery](#backup-and-recovery)
10. [Troubleshooting](#troubleshooting)
11. [Security Considerations](#security-considerations)

## Prerequisites

### System Requirements

- **Node.js**: Version 18 or higher
- **PostgreSQL**: Version 13 or higher
- **Memory**: Minimum 2GB RAM (4GB+ recommended)
- **Storage**: SSD recommended for optimal performance
- **Network**: Secure connection between Actual and PostgreSQL

### Dependencies

```bash
# Install PostgreSQL client library
npm install pg @types/pg

# Optional: Install connection pooling
npm install pg-pool

# For Docker deployments
docker --version
docker-compose --version
```

## Environment Configuration

### Required Environment Variables

Create a `.env` file in your deployment directory:

```bash
# PostgreSQL Integration
ENABLE_POSTGRES=true
DATABASE_ADAPTER=postgres

# PostgreSQL Connection
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DATABASE=actual_budget
POSTGRES_USER=actual_user
POSTGRES_PASSWORD=secure_password_here

# Optional: Connection pooling
POSTGRES_POOL_MIN=2
POSTGRES_POOL_MAX=20
POSTGRES_POOL_IDLE_TIMEOUT=30000

# Optional: SSL configuration
POSTGRES_SSL=true
POSTGRES_SSL_REJECT_UNAUTHORIZED=true

# Feature flags
ENABLE_FALLBACK_TO_SQLITE=true
ENABLE_HEALTH_CHECKS=true
ENABLE_SCHEMA_VALIDATION=true
HEALTH_CHECK_INTERVAL=60000

# Backup configuration
AUTO_BACKUP_BEFORE_MIGRATION=true
BACKUP_RETENTION_DAYS=30
```

### Docker Environment Variables

For Docker deployments, create a `docker-compose.env` file:

```bash
# Same variables as above, plus:
POSTGRES_HOST=postgres  # Service name in docker-compose
POSTGRES_INIT_DB=true
POSTGRES_AUTO_MIGRATE=true
```

## PostgreSQL Setup

### 1. PostgreSQL Installation

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### CentOS/RHEL
```bash
sudo yum install postgresql-server postgresql-contrib
sudo postgresql-setup initdb
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### Docker
```bash
docker run --name postgres-actual \
  -e POSTGRES_DB=actual_budget \
  -e POSTGRES_USER=actual_user \
  -e POSTGRES_PASSWORD=secure_password_here \
  -p 5432:5432 \
  -v postgres_data:/var/lib/postgresql/data \
  -d postgres:15
```

### 2. Database Setup

```sql
-- Connect as superuser
sudo -u postgres psql

-- Create database and user
CREATE DATABASE actual_budget;
CREATE USER actual_user WITH ENCRYPTED PASSWORD 'secure_password_here';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE actual_budget TO actual_user;
GRANT CREATE ON DATABASE actual_budget TO actual_user;

-- Optional: Enable extensions
\c actual_budget
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO actual_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO actual_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO actual_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO actual_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO actual_user;
```

### 3. PostgreSQL Configuration

Edit `/etc/postgresql/15/main/postgresql.conf`:

```ini
# Connection settings
listen_addresses = '*'          # For Docker/remote access
max_connections = 100
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB

# WAL settings for durability
wal_level = replica
max_wal_size = 1GB
min_wal_size = 80MB
checkpoint_completion_target = 0.9

# Logging for monitoring
log_destination = 'stderr'
logging_collector = on
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
log_min_duration_statement = 1000

# Performance monitoring
track_activities = on
track_counts = on
track_io_timing = on
track_functions = all
```

Edit `/etc/postgresql/15/main/pg_hba.conf`:

```ini
# Local connections
local   all             postgres                                peer
local   actual_budget   actual_user                             md5

# Remote connections (adjust as needed)
host    actual_budget   actual_user     10.0.0.0/8             md5
host    actual_budget   actual_user     172.16.0.0/12          md5
host    actual_budget   actual_user     192.168.0.0/16         md5

# SSL connections (recommended for production)
hostssl actual_budget   actual_user     0.0.0.0/0              md5
```

## Docker Deployment

### Docker Compose Setup

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    container_name: actual-postgres
    environment:
      POSTGRES_DB: actual_budget
      POSTGRES_USER: actual_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_INITDB_ARGS: "--encoding=UTF-8 --lc-collate=C --lc-ctype=C"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    networks:
      - actual-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U actual_user -d actual_budget"]
      interval: 30s
      timeout: 10s
      retries: 3

  actual:
    build: .
    container_name: actual-app
    environment:
      - ENABLE_POSTGRES=true
      - DATABASE_ADAPTER=postgres
      - POSTGRES_HOST=postgres
      - POSTGRES_PORT=5432
      - POSTGRES_DATABASE=actual_budget
      - POSTGRES_USER=actual_user
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - ENABLE_HEALTH_CHECKS=true
      - POSTGRES_AUTO_MIGRATE=true
    volumes:
      - actual_data:/app/data
      - ./backups:/app/backups
    ports:
      - "5006:5006"
    networks:
      - actual-network
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5006/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Optional: PostgreSQL monitoring
  postgres-exporter:
    image: prometheuscommunity/postgres-exporter
    container_name: actual-postgres-exporter
    environment:
      DATA_SOURCE_NAME: "postgresql://actual_user:${POSTGRES_PASSWORD}@postgres:5432/actual_budget?sslmode=disable"
    ports:
      - "9187:9187"
    networks:
      - actual-network
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  postgres_data:
    driver: local
  actual_data:
    driver: local

networks:
  actual-network:
    driver: bridge
```

Create `init.sql` for PostgreSQL initialization:

```sql
-- Performance optimizations
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create indexes for common queries (will be created by migration)
-- These are examples for manual setup if needed

-- Monitoring views
CREATE OR REPLACE VIEW pg_stat_statements_summary AS
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  rows
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 20;
```

### Deployment Commands

```bash
# Set environment variables
export POSTGRES_PASSWORD="your_secure_password_here"

# Start services
docker-compose up -d

# Check service status
docker-compose ps
docker-compose logs actual
docker-compose logs postgres

# Run health checks
docker-compose exec actual npm run postgres:health

# View logs
docker-compose logs -f actual
```

## Manual Deployment

### 1. Application Setup

```bash
# Clone and build application
git clone https://github.com/actualbudget/actual-server.git
cd actual-server
npm install

# Copy configuration
cp .env.example .env
# Edit .env with your PostgreSQL settings

# Build application
npm run build
```

### 2. Database Migration

```bash
# Test connection first
npm run postgres:test-connection

# Run migration (with backup)
npm run postgres:migrate

# Verify migration
npm run postgres:health
```

### 3. Service Configuration

Create `/etc/systemd/system/actual.service`:

```ini
[Unit]
Description=Actual Budget Server
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=actual
WorkingDirectory=/opt/actual
ExecStart=/usr/bin/node dist/app-sync.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/actual/.env

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/actual/data /opt/actual/backups

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable actual
sudo systemctl start actual
sudo systemctl status actual
```

## Data Migration

### 1. Pre-Migration Checklist

```bash
# Verify SQLite database exists and is accessible
ls -la /path/to/actual/data/

# Check available disk space (backup + migration space needed)
df -h

# Test PostgreSQL connectivity
npm run postgres:test-connection

# Create manual backup (recommended)
npm run postgres:backup-sqlite
```

### 2. Migration Process

```bash
# Option 1: Automatic migration
export POSTGRES_AUTO_MIGRATE=true
npm start

# Option 2: Manual migration
npm run postgres:migrate -- --batch-size=1000 --validate

# Option 3: Progressive migration with monitoring
npm run postgres:migrate -- --batch-size=500 --progress --validate --create-backup
```

### 3. Post-Migration Validation

```bash
# Verify data integrity
npm run postgres:validate-migration

# Check performance
npm run postgres:performance-test

# Compare SQLite and PostgreSQL data
npm run postgres:compare-data
```

### 4. Migration Rollback (if needed)

```bash
# Switch back to SQLite
export DATABASE_ADAPTER=sqlite
npm restart

# Restore from backup if needed
npm run postgres:restore-backup -- /path/to/backup.sqlite
```

## Health Monitoring

### 1. Built-in Health Checks

```bash
# Quick health check
curl http://localhost:5006/api/postgres/health

# Comprehensive health check
curl http://localhost:5006/api/postgres/health/detailed

# Health monitoring API
curl http://localhost:5006/api/postgres/status
```

### 2. PostgreSQL Monitoring Queries

```sql
-- Database connections
SELECT count(*) as active_connections, usename, application_name 
FROM pg_stat_activity 
WHERE state = 'active' 
GROUP BY usename, application_name;

-- Query performance
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;

-- Database size
SELECT pg_database_size('actual_budget') / 1024 / 1024 as size_mb;

-- Table statistics
SELECT tablename, n_tup_ins, n_tup_upd, n_tup_del 
FROM pg_stat_user_tables 
ORDER BY n_tup_ins DESC;
```

### 3. Monitoring Setup

Create monitoring script `monitor.sh`:

```bash
#!/bin/bash

LOG_FILE="/var/log/actual-monitor.log"
HEALTH_URL="http://localhost:5006/api/postgres/health"

# Function to log with timestamp
log() {
    echo "$(date): $1" >> $LOG_FILE
}

# Check application health
if curl -s -f "$HEALTH_URL" > /dev/null; then
    log "Health check: OK"
else
    log "Health check: FAILED"
    # Alert notification here
    # mail -s "Actual Budget Health Check Failed" admin@example.com < /dev/null
fi

# Check PostgreSQL
if pg_isready -h localhost -p 5432 -U actual_user > /dev/null; then
    log "PostgreSQL: OK"
else
    log "PostgreSQL: FAILED"
    # Alert notification here
fi

# Check disk space
DISK_USAGE=$(df -h /var/lib/postgresql/data | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 80 ]; then
    log "WARNING: Disk usage high: ${DISK_USAGE}%"
fi
```

Add to crontab:

```bash
# Run every 5 minutes
*/5 * * * * /opt/actual/monitor.sh
```

## Performance Tuning

### 1. PostgreSQL Optimization

```sql
-- Enable query performance tracking
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Analyze query performance
ANALYZE;

-- Update table statistics
UPDATE pg_stat_user_tables SET n_mod_since_analyze = 0;

-- Reindex if needed
REINDEX DATABASE actual_budget;
```

### 2. Connection Pooling

Install and configure connection pooling:

```javascript
// In your application configuration
const poolConfig = {
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  database: process.env.POSTGRES_DATABASE,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  min: 2,                    // Minimum connections
  max: 20,                   // Maximum connections
  idleTimeoutMillis: 30000,  // 30 seconds
  connectionTimeoutMillis: 2000,
  ssl: process.env.POSTGRES_SSL === 'true'
};
```

### 3. Application-Level Optimizations

```bash
# Environment variables for performance
export POSTGRES_POOL_MAX=20
export POSTGRES_POOL_MIN=5
export POSTGRES_QUERY_TIMEOUT=30000
export POSTGRES_STATEMENT_TIMEOUT=60000
```

## Backup and Recovery

### 1. Automated Backup Script

Create `backup.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/opt/actual/backups"
DB_NAME="actual_budget"
DB_USER="actual_user"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# PostgreSQL backup
pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" \
  --no-password --verbose --clean --create \
  | gzip > "$BACKUP_DIR/postgres_backup_$TIMESTAMP.sql.gz"

# SQLite backup (if still maintaining SQLite files)
if [ -f "/opt/actual/data/server-files/db.sqlite" ]; then
    cp "/opt/actual/data/server-files/db.sqlite" \
       "$BACKUP_DIR/sqlite_backup_$TIMESTAMP.sqlite"
fi

# Cleanup old backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "*.sqlite" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $TIMESTAMP"
```

### 2. Backup Automation

Add to crontab:

```bash
# Daily backup at 2 AM
0 2 * * * /opt/actual/backup.sh

# Weekly full backup
0 3 * * 0 /opt/actual/backup.sh --full
```

### 3. Recovery Procedures

```bash
# Restore PostgreSQL backup
gunzip -c /opt/actual/backups/postgres_backup_YYYYMMDD_HHMMSS.sql.gz | \
  psql -h localhost -U actual_user -d actual_budget

# Restore from SQLite backup
export DATABASE_ADAPTER=sqlite
cp /opt/actual/backups/sqlite_backup_YYYYMMDD_HHMMSS.sqlite \
   /opt/actual/data/server-files/db.sqlite
```

## Security Considerations

### 1. Database Security

```sql
-- Create read-only user for monitoring
CREATE USER actual_readonly WITH PASSWORD 'readonly_password';
GRANT CONNECT ON DATABASE actual_budget TO actual_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO actual_readonly;

-- Audit logging
ALTER DATABASE actual_budget SET log_statement = 'all';
ALTER DATABASE actual_budget SET log_min_duration_statement = 1000;
```

### 2. Network Security

```bash
# Firewall rules (adjust as needed)
sudo ufw allow from 10.0.0.0/8 to any port 5432
sudo ufw allow from 172.16.0.0/12 to any port 5432
sudo ufw allow from 192.168.0.0/16 to any port 5432

# For application port
sudo ufw allow 5006
```

### 3. SSL Configuration

```bash
# Generate SSL certificates
openssl req -new -x509 -days 365 -nodes -text \
  -out server.crt -keyout server.key -subj "/CN=actual-postgres"

# Configure PostgreSQL SSL
echo "ssl = on" >> /etc/postgresql/15/main/postgresql.conf
echo "ssl_cert_file = '/path/to/server.crt'" >> /etc/postgresql/15/main/postgresql.conf
echo "ssl_key_file = '/path/to/server.key'" >> /etc/postgresql/15/main/postgresql.conf
```

### 4. Environment Security

```bash
# Secure .env file
chmod 600 .env
chown actual:actual .env

# Secure backup directory
chmod 700 /opt/actual/backups
chown actual:actual /opt/actual/backups
```

## Troubleshooting

### 1. Common Issues

#### Connection Issues
```bash
# Test PostgreSQL connection
psql -h localhost -U actual_user -d actual_budget -c "SELECT 1;"

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-15-main.log

# Check application logs
journalctl -u actual -f
```

#### Performance Issues
```sql
-- Check active queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query 
FROM pg_stat_activity 
WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes';

-- Check locks
SELECT blocked_locks.pid AS blocked_pid,
       blocked_activity.usename AS blocked_user,
       blocking_locks.pid AS blocking_pid,
       blocking_activity.usename AS blocking_user,
       blocked_activity.query AS blocked_statement,
       blocking_activity.query AS current_statement_in_blocking_process
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
  AND blocking_locks.DATABASE IS NOT DISTINCT FROM blocked_locks.DATABASE
  AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
  AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
  AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
  AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
  AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
  AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
  AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
  AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
  AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.GRANTED;
```

#### Migration Issues
```bash
# Check migration status
npm run postgres:migration-status

# Verify data consistency
npm run postgres:verify-data

# Check for missing indexes
npm run postgres:check-schema
```

### 2. Log Analysis

```bash
# Application logs
tail -f /var/log/actual/actual.log | grep -i error

# PostgreSQL query logs
tail -f /var/log/postgresql/postgresql-15-main.log | grep -i "duration\|error"

# System logs
journalctl -u postgresql -f
journalctl -u actual -f
```

### 3. Recovery Procedures

```bash
# Emergency SQLite fallback
export DATABASE_ADAPTER=sqlite
systemctl restart actual

# Force PostgreSQL reconnection
systemctl restart postgresql
systemctl restart actual

# Clear connection pools
psql -h localhost -U actual_user -d actual_budget -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'actual_user';"
```

## Maintenance

### 1. Regular Maintenance Tasks

```bash
# Weekly PostgreSQL maintenance
sudo -u postgres psql actual_budget -c "VACUUM ANALYZE;"

# Monthly full vacuum
sudo -u postgres psql actual_budget -c "VACUUM FULL;"

# Update statistics
sudo -u postgres psql actual_budget -c "ANALYZE;"

# Check for database bloat
sudo -u postgres psql actual_budget -c "SELECT schemaname, tablename, attname, n_distinct, correlation FROM pg_stats;"
```

### 2. Monitoring Checklist

- [ ] Database connections within limits
- [ ] Query performance acceptable
- [ ] Disk space sufficient
- [ ] Backup procedures working
- [ ] Security updates applied
- [ ] Log files rotated
- [ ] Health checks passing

### 3. Update Procedures

```bash
# Application updates
git pull origin main
npm install
npm run build
systemctl restart actual

# PostgreSQL updates
sudo apt update
sudo apt upgrade postgresql postgresql-contrib
sudo systemctl restart postgresql
```

## Support and Resources

### Documentation
- [PostgreSQL Official Documentation](https://www.postgresql.org/docs/)
- [Actual Budget Documentation](https://actualbudget.org/docs/)
- [Node.js PostgreSQL Client](https://node-postgres.com/)

### Monitoring Tools
- pgAdmin 4 for database administration
- Grafana + Prometheus for metrics
- pg_stat_statements for query analysis
- pgBadger for log analysis

### Community
- [Actual Budget GitHub](https://github.com/actualbudget/actual-server)
- [PostgreSQL Community](https://www.postgresql.org/community/)

---

This deployment guide provides a comprehensive foundation for running Actual Budget with PostgreSQL in production. Adjust configurations based on your specific infrastructure and requirements.