#!/bin/bash

# Start Actual Budget with PostgreSQL
echo "🐘 Starting Actual Budget with PostgreSQL..."

# Kill any existing server processes
echo "🔍 Checking for existing server processes..."
pkill -f "yarn start:server" 2>/dev/null || true
sleep 2

# Set environment variables
export ENABLE_POSTGRES=true
export DATABASE_ADAPTER=postgres
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_DATABASE=actual_budget
export POSTGRES_USER=actual_user
export POSTGRES_PASSWORD=test123

# Server configuration
export ACTUAL_SERVER_PORT=5006
export ACTUAL_SERVER_HOSTNAME=localhost
export ACTUAL_SERVER_URL=http://localhost:5006

echo "📋 Configuration:"
echo "   Database: PostgreSQL"
echo "   Host: ${POSTGRES_HOST}:${POSTGRES_PORT}"
echo "   Database: ${POSTGRES_DATABASE}"
echo "   User: ${POSTGRES_USER}"
echo "   Server: ${ACTUAL_SERVER_URL}"
echo ""

# Test database connection first
echo "🔍 Testing database connection..."
if PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DATABASE -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✅ Database connection successful"
else
    echo "❌ Database connection failed"
    echo "   Make sure PostgreSQL is running: brew services start postgresql@14"
    exit 1
fi

echo ""
echo "🚀 Starting Actual Budget server..."
echo "   Server will be available at: http://localhost:5006"
echo "   Press Ctrl+C to stop"
echo ""

# Start the server
yarn start:server