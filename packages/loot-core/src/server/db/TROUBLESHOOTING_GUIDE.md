# PostgreSQL Integration - Troubleshooting and Monitoring Guide

This guide provides comprehensive troubleshooting procedures and monitoring strategies for PostgreSQL integration in Actual Budget.

## Table of Contents

1. [Quick Diagnostic Commands](#quick-diagnostic-commands)
2. [Common Issues and Solutions](#common-issues-and-solutions)
3. [Connection Problems](#connection-problems)
4. [Performance Issues](#performance-issues)
5. [Migration Problems](#migration-problems)
6. [Data Integrity Issues](#data-integrity-issues)
7. [Monitoring and Alerting](#monitoring-and-alerting)
8. [Log Analysis](#log-analysis)
9. [Recovery Procedures](#recovery-procedures)
10. [Preventive Maintenance](#preventive-maintenance)

## Quick Diagnostic Commands

### Application Health Check
```bash
# Quick health status
curl -s http://localhost:5006/api/postgres/health | jq .

# Detailed health check
curl -s http://localhost:5006/api/postgres/health/detailed | jq .

# Integration status
curl -s http://localhost:5006/api/postgres/status | jq .

# Configuration summary
curl -s http://localhost:5006/api/postgres/config | jq .
```

### Database Connectivity
```bash
# Test PostgreSQL connection
psql -h localhost -U actual_user -d actual_budget -c "SELECT 1;"

# Check PostgreSQL service
systemctl status postgresql

# Test from application directory
npm run postgres:test-connection

# Check database exists
psql -h localhost -U actual_user -l | grep actual_budget
```

### Performance Quick Check
```sql
-- Active connections
SELECT count(*) as connections, state 
FROM pg_stat_activity 
WHERE datname = 'actual_budget' 
GROUP BY state;

-- Long running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query 
FROM pg_stat_activity 
WHERE (now() - pg_stat_activity.query_start) > interval '1 minute'
  AND state = 'active';

-- Database size
SELECT pg_size_pretty(pg_database_size('actual_budget')) as db_size;

-- Table sizes
SELECT tablename, 
       pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) as size
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY pg_total_relation_size(quote_ident(tablename)) DESC;
```

## Common Issues and Solutions

### Issue 1: "PostgreSQL not enabled" Error

**Symptoms:**
```
ℹ️ PostgreSQL not enabled. Set ENABLE_POSTGRES=true or DATABASE_ADAPTER=postgres
```

**Solution:**
```bash
# Check environment variables
echo $ENABLE_POSTGRES
echo $DATABASE_ADAPTER

# Set environment variables
export ENABLE_POSTGRES=true
# OR
export DATABASE_ADAPTER=postgres

# Restart application
systemctl restart actual
```

### Issue 2: "Connection refused" Error

**Symptoms:**
```
❌ PostgreSQL connection failed: connect ECONNREFUSED 127.0.0.1:5432
```

**Diagnosis:**
```bash
# Check if PostgreSQL is running
systemctl status postgresql

# Check if PostgreSQL is listening
netstat -tuln | grep :5432
ss -tuln | grep :5432

# Check PostgreSQL logs
tail -f /var/log/postgresql/postgresql-*-main.log
```

**Solution:**
```bash
# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Check PostgreSQL configuration
sudo -u postgres psql -c "SHOW listen_addresses;"
sudo -u postgres psql -c "SHOW port;"

# Edit postgresql.conf if needed
sudo nano /etc/postgresql/*/main/postgresql.conf
# Set: listen_addresses = '*'
sudo systemctl restart postgresql
```

### Issue 3: "Authentication failed" Error

**Symptoms:**
```
❌ PostgreSQL connection failed: password authentication failed for user "actual_user"
```

**Diagnosis:**
```bash
# Check if user exists
sudo -u postgres psql -c "\du actual_user"

# Check pg_hba.conf
sudo cat /etc/postgresql/*/main/pg_hba.conf | grep actual
```

**Solution:**
```bash
# Reset user password
sudo -u postgres psql
ALTER USER actual_user WITH PASSWORD 'new_password';
\q

# Update environment variables
export POSTGRES_PASSWORD="new_password"

# Or recreate user
sudo -u postgres psql
DROP USER IF EXISTS actual_user;
CREATE USER actual_user WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE actual_budget TO actual_user;
\q
```

### Issue 4: "Database does not exist" Error

**Symptoms:**
```
❌ PostgreSQL connection failed: database "actual_budget" does not exist
```

**Solution:**
```bash
# Create database
sudo -u postgres psql
CREATE DATABASE actual_budget;
GRANT ALL PRIVILEGES ON DATABASE actual_budget TO actual_user;
\q

# Or use automated setup
npm run postgres:setup-database
```

## Connection Problems

### Diagnosis Checklist

1. **Service Status**
   ```bash
   systemctl status postgresql
   systemctl status actual
   ```

2. **Network Connectivity**
   ```bash
   # Local connection
   telnet localhost 5432
   
   # Remote connection
   telnet $POSTGRES_HOST $POSTGRES_PORT
   ```

3. **Configuration Check**
   ```bash
   # Application configuration
   npm run postgres:config
   
   # PostgreSQL configuration
   sudo -u postgres psql -c "SHOW all;" | grep -E "(listen_addresses|port|max_connections)"
   ```

### Common Connection Solutions

#### Problem: Too many connections
```sql
-- Check current connections
SELECT count(*) FROM pg_stat_activity;

-- Kill idle connections
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' 
  AND state_change < now() - interval '1 hour';
```

#### Problem: SSL connection issues
```bash
# Disable SSL temporarily for testing
export POSTGRES_SSL=false

# Check SSL configuration
sudo -u postgres psql -c "SHOW ssl;"

# Test with SSL
psql "host=localhost dbname=actual_budget user=actual_user sslmode=require"
```

#### Problem: Connection timeout
```bash
# Increase connection timeout
export POSTGRES_CONNECTION_TIMEOUT=10000

# Check network latency
ping $POSTGRES_HOST

# Test connection speed
time psql -h $POSTGRES_HOST -U actual_user -d actual_budget -c "SELECT 1;"
```

## Performance Issues

### Diagnosis Commands

```sql
-- Check query performance
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements 
ORDER BY total_exec_time DESC 
LIMIT 10;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes 
ORDER BY idx_tup_read DESC;

-- Check table statistics
SELECT schemaname, tablename, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup, n_dead_tup
FROM pg_stat_user_tables 
ORDER BY n_live_tup DESC;

-- Check locks
SELECT locktype, database, relation, mode, granted 
FROM pg_locks 
WHERE NOT granted;
```

### Performance Solutions

#### Problem: Slow queries
```sql
-- Enable query timing
ALTER DATABASE actual_budget SET log_min_duration_statement = 1000;

-- Update statistics
ANALYZE;

-- Rebuild indexes
REINDEX DATABASE actual_budget;
```

#### Problem: High CPU usage
```sql
-- Find expensive queries
SELECT pid, query, state, query_start
FROM pg_stat_activity 
WHERE state = 'active' 
  AND query NOT LIKE '%pg_stat_activity%'
ORDER BY query_start;

-- Kill problematic query
SELECT pg_terminate_backend(12345); -- Replace with actual PID
```

#### Problem: Memory issues
```bash
# Check PostgreSQL memory usage
ps aux | grep postgres

# Check system memory
free -h

# Tune PostgreSQL memory settings
sudo nano /etc/postgresql/*/main/postgresql.conf
# shared_buffers = 256MB
# work_mem = 4MB
# maintenance_work_mem = 64MB
```

## Migration Problems

### Common Migration Issues

#### Problem: Migration timeout
```bash
# Increase migration timeout
export POSTGRES_MIGRATION_TIMEOUT=300000

# Run migration in smaller batches
npm run postgres:migrate -- --batch-size=100 --timeout=60000
```

#### Problem: Data validation errors
```bash
# Skip validation temporarily
npm run postgres:migrate -- --skip-validation

# Fix data issues first
npm run postgres:validate-data
npm run postgres:fix-data-issues
```

#### Problem: Insufficient disk space
```bash
# Check disk space
df -h

# Clean up old backups
find /opt/actual/backups -name "*.sql.gz" -mtime +7 -delete

# Compress existing data
vacuum full;
```

### Migration Recovery

#### Rollback Migration
```bash
# Switch back to SQLite
export DATABASE_ADAPTER=sqlite
systemctl restart actual

# Restore from backup
npm run postgres:restore-backup -- /path/to/backup.sqlite
```

#### Resume Failed Migration
```bash
# Check migration status
npm run postgres:migration-status

# Resume from checkpoint
npm run postgres:resume-migration

# Force restart migration
npm run postgres:migrate -- --force-restart
```

## Data Integrity Issues

### Validation Commands

```sql
-- Check for orphaned records
SELECT 'transactions' as table_name, count(*) as orphaned_records
FROM transactions t 
LEFT JOIN accounts a ON t.acct = a.id 
WHERE a.id IS NULL AND t.acct IS NOT NULL
UNION ALL
SELECT 'transactions', count(*)
FROM transactions t 
LEFT JOIN categories c ON t.category = c.id 
WHERE c.id IS NULL AND t.category IS NOT NULL;

-- Check for duplicate IDs
SELECT id, count(*) 
FROM accounts 
GROUP BY id 
HAVING count(*) > 1;

-- Check data consistency
SELECT 
  (SELECT count(*) FROM accounts WHERE tombstone = 0) as active_accounts,
  (SELECT count(*) FROM categories WHERE tombstone = 0) as active_categories,
  (SELECT count(*) FROM transactions WHERE tombstone = 0) as active_transactions;
```

### Data Repair Commands

```sql
-- Remove orphaned transactions
DELETE FROM transactions 
WHERE acct NOT IN (SELECT id FROM accounts)
  AND acct IS NOT NULL;

-- Fix duplicate IDs (backup first!)
-- This is a complex operation - contact support before running

-- Update statistics after repairs
ANALYZE;
```

## Monitoring and Alerting

### System Monitoring Script

Create `/opt/actual/monitor-postgres.sh`:

```bash
#!/bin/bash

# Configuration
ALERT_EMAIL="admin@example.com"
LOG_FILE="/var/log/actual-postgres-monitor.log"
HEALTH_URL="http://localhost:5006/api/postgres/health"
MAX_CONNECTIONS=80
MAX_DISK_USAGE=85
MAX_QUERY_TIME=30

# Functions
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

send_alert() {
    local subject="$1"
    local message="$2"
    echo "$message" | mail -s "$subject" "$ALERT_EMAIL"
    log_message "ALERT: $subject"
}

check_application_health() {
    if ! curl -s -f "$HEALTH_URL" > /dev/null; then
        send_alert "Actual Budget Health Check Failed" "Application health check endpoint is not responding"
        return 1
    fi
    return 0
}

check_postgres_health() {
    if ! pg_isready -h localhost -p 5432 -U actual_user -d actual_budget > /dev/null 2>&1; then
        send_alert "PostgreSQL Health Check Failed" "PostgreSQL is not responding"
        return 1
    fi
    return 0
}

check_connections() {
    local connections=$(psql -h localhost -U actual_user -d actual_budget -t -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'actual_budget';" 2>/dev/null)
    if [[ "$connections" -gt "$MAX_CONNECTIONS" ]]; then
        send_alert "PostgreSQL High Connection Count" "Current connections: $connections (max: $MAX_CONNECTIONS)"
    fi
}

check_disk_usage() {
    local usage=$(df -h /var/lib/postgresql/data | awk 'NR==2 {print $5}' | sed 's/%//')
    if [[ "$usage" -gt "$MAX_DISK_USAGE" ]]; then
        send_alert "PostgreSQL High Disk Usage" "Disk usage: ${usage}% (max: ${MAX_DISK_USAGE}%)"
    fi
}

check_long_queries() {
    local long_queries=$(psql -h localhost -U actual_user -d actual_budget -t -c "
        SELECT count(*) FROM pg_stat_activity 
        WHERE state = 'active' 
          AND (now() - query_start) > interval '$MAX_QUERY_TIME seconds'
          AND query NOT LIKE '%pg_stat_activity%'
    " 2>/dev/null)
    
    if [[ "$long_queries" -gt "0" ]]; then
        send_alert "PostgreSQL Long Running Queries" "Found $long_queries queries running longer than $MAX_QUERY_TIME seconds"
    fi
}

# Main monitoring
log_message "Starting monitoring cycle"

check_application_health
check_postgres_health
check_connections
check_disk_usage
check_long_queries

log_message "Monitoring cycle completed"
```

### Prometheus Metrics (Optional)

Create `/opt/actual/postgres-metrics.sh`:

```bash
#!/bin/bash

# Export metrics for Prometheus
cat << EOF > /var/lib/node_exporter/actual_postgres.prom
# HELP actual_postgres_connections Current PostgreSQL connections
# TYPE actual_postgres_connections gauge
actual_postgres_connections $(psql -h localhost -U actual_user -d actual_budget -t -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'actual_budget';" 2>/dev/null || echo 0)

# HELP actual_postgres_database_size_bytes Database size in bytes
# TYPE actual_postgres_database_size_bytes gauge
actual_postgres_database_size_bytes $(psql -h localhost -U actual_user -d actual_budget -t -c "SELECT pg_database_size('actual_budget');" 2>/dev/null || echo 0)

# HELP actual_postgres_transactions_per_second Transaction rate
# TYPE actual_postgres_transactions_per_second gauge
actual_postgres_transactions_per_second $(psql -h localhost -U actual_user -d actual_budget -t -c "SELECT xact_commit + xact_rollback FROM pg_stat_database WHERE datname = 'actual_budget';" 2>/dev/null || echo 0)
EOF
```

## Log Analysis

### Key Log Locations

```bash
# Application logs
tail -f /var/log/actual/actual.log
journalctl -u actual -f

# PostgreSQL logs
tail -f /var/log/postgresql/postgresql-*-main.log

# System logs
journalctl -u postgresql -f
tail -f /var/log/syslog | grep postgres
```

### Log Analysis Commands

```bash
# Find errors in application logs
grep -i "error\|failed\|exception" /var/log/actual/actual.log | tail -20

# Find slow queries in PostgreSQL logs
grep "duration:" /var/log/postgresql/postgresql-*-main.log | grep "statement:" | tail -10

# Find connection issues
grep -i "connection\|authentication" /var/log/postgresql/postgresql-*-main.log | tail -10

# Monitor live errors
tail -f /var/log/actual/actual.log | grep -i --color=always "error\|failed"
```

### Log Rotation Setup

Create `/etc/logrotate.d/actual-postgres`:

```
/var/log/actual/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 actual actual
    postrotate
        systemctl reload actual
    endscript
}
```

## Recovery Procedures

### Emergency Recovery Steps

1. **Immediate Fallback to SQLite**
   ```bash
   # Stop application
   systemctl stop actual
   
   # Switch to SQLite
   export DATABASE_ADAPTER=sqlite
   
   # Start application
   systemctl start actual
   ```

2. **PostgreSQL Service Recovery**
   ```bash
   # Check PostgreSQL status
   systemctl status postgresql
   
   # Restart PostgreSQL
   systemctl restart postgresql
   
   # Check for corruption
   sudo -u postgres pg_checksums -D /var/lib/postgresql/*/main
   ```

3. **Data Recovery from Backup**
   ```bash
   # List available backups
   ls -la /opt/actual/backups/
   
   # Restore PostgreSQL backup
   gunzip -c /opt/actual/backups/postgres_backup_*.sql.gz | \
     psql -h localhost -U actual_user -d actual_budget
   
   # Restore SQLite backup
   cp /opt/actual/backups/sqlite_backup_*.sqlite \
      /opt/actual/data/server-files/db.sqlite
   ```

### Disaster Recovery Checklist

- [ ] Identify the scope of the problem
- [ ] Check recent changes or updates
- [ ] Verify backup availability
- [ ] Implement immediate workaround
- [ ] Document the incident
- [ ] Perform root cause analysis
- [ ] Update monitoring and procedures

## Preventive Maintenance

### Daily Tasks

```bash
# Health check
curl -s http://localhost:5006/api/postgres/health

# Check disk space
df -h /var/lib/postgresql/data

# Review recent errors
grep -i error /var/log/actual/actual.log | tail -5
```

### Weekly Tasks

```bash
# Database maintenance
sudo -u postgres psql actual_budget -c "VACUUM ANALYZE;"

# Log analysis
/opt/actual/analyze-logs.sh

# Backup verification
/opt/actual/verify-backups.sh

# Performance review
psql -h localhost -U actual_user -d actual_budget -c "
  SELECT query, calls, total_exec_time 
  FROM pg_stat_statements 
  ORDER BY total_exec_time DESC 
  LIMIT 5;"
```

### Monthly Tasks

```bash
# Full database vacuum
sudo -u postgres psql actual_budget -c "VACUUM FULL;"

# Update statistics
sudo -u postgres psql actual_budget -c "ANALYZE;"

# Security review
/opt/actual/security-audit.sh

# Backup cleanup
find /opt/actual/backups -name "*.sql.gz" -mtime +30 -delete
```

### Performance Monitoring Query

```sql
-- Weekly performance report
SELECT 
  'Database Size' as metric,
  pg_size_pretty(pg_database_size('actual_budget')) as value
UNION ALL
SELECT 
  'Active Connections',
  count(*)::text
FROM pg_stat_activity 
WHERE datname = 'actual_budget' AND state = 'active'
UNION ALL
SELECT 
  'Longest Query (seconds)',
  extract(epoch from max(now() - query_start))::text
FROM pg_stat_activity 
WHERE datname = 'actual_budget' AND state = 'active'
UNION ALL
SELECT 
  'Cache Hit Ratio (%)',
  round(100.0 * sum(blks_hit) / sum(blks_hit + blks_read), 2)::text
FROM pg_stat_database 
WHERE datname = 'actual_budget';
```

## Support and Escalation

### When to Escalate

- Data corruption detected
- Persistent performance degradation
- Security incidents
- Unrecoverable errors
- Migration failures affecting production data

### Information to Collect

```bash
# System information
uname -a
df -h
free -h
systemctl status postgresql
systemctl status actual

# Application configuration
curl -s http://localhost:5006/api/postgres/config

# PostgreSQL configuration
sudo -u postgres psql -c "SHOW all;"

# Recent logs
tail -100 /var/log/actual/actual.log
tail -100 /var/log/postgresql/postgresql-*-main.log

# Database statistics
psql -h localhost -U actual_user -d actual_budget -c "
  SELECT 
    pg_size_pretty(pg_database_size('actual_budget')) as db_size,
    count(*) as connections
  FROM pg_stat_activity 
  WHERE datname = 'actual_budget';"
```

### Contact Information

- GitHub Issues: https://github.com/actualbudget/actual-server/issues
- Community Forum: https://actualbudget.org/community
- Documentation: https://actualbudget.org/docs

---

This troubleshooting guide should help diagnose and resolve most PostgreSQL integration issues. Always test solutions in a non-production environment first, and maintain regular backups.