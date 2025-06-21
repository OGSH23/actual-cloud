-- PostgreSQL initialization for Actual Budget testing
-- This script sets up the database with proper permissions and extensions

-- Create extensions for better performance and functionality
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Grant all necessary permissions to the test user
GRANT ALL PRIVILEGES ON DATABASE actual_budget_test TO actual_test_user;
GRANT ALL ON SCHEMA public TO actual_test_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO actual_test_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO actual_test_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO actual_test_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO actual_test_user;

-- Performance monitoring setup
GRANT SELECT ON pg_stat_statements TO actual_test_user;

-- Create a view for monitoring database performance
CREATE OR REPLACE VIEW performance_stats AS
SELECT 
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    rows,
    100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
FROM pg_stat_statements 
ORDER BY total_exec_time DESC;

GRANT SELECT ON performance_stats TO actual_test_user;

-- Create indexes that might be useful for Actual Budget
-- These will be created by the schema migration, but we prepare the database

-- Log successful initialization
INSERT INTO pg_stat_statements_info (dealloc) VALUES (0) ON CONFLICT DO NOTHING;