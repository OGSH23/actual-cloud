#!/bin/bash

echo "🔄 Restarting Actual Budget Server..."

# Stop any existing processes
echo "🛑 Stopping existing server processes..."
pkill -f "yarn start:server" 2>/dev/null || true
pkill -f "node.*actual" 2>/dev/null || true
sleep 3

# Clean up any port usage
echo "🧹 Checking port 5006..."
lsof -ti:5006 | xargs kill -9 2>/dev/null || true
sleep 2

# Set PostgreSQL environment
export ENABLE_POSTGRES=true
export DATABASE_ADAPTER=postgres
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_DATABASE=actual_budget
export POSTGRES_USER=actual_user
export POSTGRES_PASSWORD=test123

# Test database first
echo "🔍 Testing PostgreSQL connection..."
if PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DATABASE -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✅ PostgreSQL connection successful"
else
    echo "❌ PostgreSQL connection failed"
    exit 1
fi

# Start server in background
echo "🚀 Starting server in background..."
nohup yarn start:server > server.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
echo "⏳ Waiting for server to start..."
for i in {1..30}; do
    if curl -s http://localhost:5006 > /dev/null 2>&1; then
        echo "✅ Server is running (PID: $SERVER_PID)"
        echo "🌐 Available at: http://localhost:5006"
        echo ""
        echo "📋 Troubleshooting tips:"
        echo "   1. Clear browser cache and cookies for localhost:5006"
        echo "   2. Try incognito/private browsing mode"
        echo "   3. If you see errors, check: tail -f server.log"
        echo "   4. To stop server: kill $SERVER_PID"
        echo ""
        exit 0
    fi
    sleep 1
done

echo "❌ Server failed to start within 30 seconds"
echo "📋 Check logs: tail -f server.log"
exit 1