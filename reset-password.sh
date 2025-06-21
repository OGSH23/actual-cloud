#!/bin/bash

echo "🔐 Actual Budget Password Reset"
echo "==============================="

# Stop the server first
echo "🛑 Stopping server..."
pkill -f "yarn start:server" 2>/dev/null || true
sleep 3

echo ""
echo "The server has a password configured, but we need to reset it."
echo ""
echo "Choose an option:"
echo "1️⃣  Delete auth data and start fresh (recommended)"
echo "2️⃣  Try common default passwords first"
echo ""

read -p "Choose option (1 or 2): " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo "🗑️  Clearing existing auth data..."
    
    # Backup the current auth data
    cp packages/sync-server/server-files/account.sqlite packages/sync-server/server-files/account.sqlite.backup
    echo "✅ Backup created: account.sqlite.backup"
    
    # Clear auth data
    sqlite3 packages/sync-server/server-files/account.sqlite "DELETE FROM auth;"
    sqlite3 packages/sync-server/server-files/account.sqlite "DELETE FROM users;"
    sqlite3 packages/sync-server/server-files/account.sqlite "DELETE FROM sessions;"
    
    echo "✅ Auth data cleared"
    echo ""
    echo "🚀 Starting server..."
    
    # Set PostgreSQL environment and start server
    export ENABLE_POSTGRES=true
    export DATABASE_ADAPTER=postgres
    export POSTGRES_HOST=localhost
    export POSTGRES_PORT=5432
    export POSTGRES_DATABASE=actual_budget
    export POSTGRES_USER=actual_user
    export POSTGRES_PASSWORD=test123
    
    nohup yarn start:server > server.log 2>&1 &
    SERVER_PID=$!
    
    echo "⏳ Waiting for server to start..."
    for i in {1..20}; do
        if curl -s http://localhost:5006 > /dev/null 2>&1; then
            echo "✅ Server is running (PID: $SERVER_PID)"
            break
        fi
        sleep 1
    done
    
    echo ""
    echo "🎉 Server reset complete!"
    echo "📋 Next steps:"
    echo "   1. Go to: http://localhost:5006"
    echo "   2. You should now see a setup/bootstrap page"
    echo "   3. Set a new password of your choice"
    echo "   4. Complete the setup"
    echo ""
    echo "💡 If you still see a login page, clear your browser cache/cookies"
    
elif [ "$choice" = "2" ]; then
    echo ""
    echo "🔍 Common passwords to try:"
    echo "   • password"
    echo "   • admin"
    echo "   • actual"
    echo "   • 123456"
    echo "   • (empty - just press enter)"
    echo ""
    echo "🚀 Starting server..."
    
    # Set PostgreSQL environment and start server
    export ENABLE_POSTGRES=true
    export DATABASE_ADAPTER=postgres
    export POSTGRES_HOST=localhost
    export POSTGRES_PORT=5432
    export POSTGRES_DATABASE=actual_budget
    export POSTGRES_USER=actual_user
    export POSTGRES_PASSWORD=test123
    
    nohup yarn start:server > server.log 2>&1 &
    SERVER_PID=$!
    
    echo "⏳ Waiting for server to start..."
    for i in {1..20}; do
        if curl -s http://localhost:5006 > /dev/null 2>&1; then
            echo "✅ Server is running (PID: $SERVER_PID)"
            break
        fi
        sleep 1
    done
    
    echo ""
    echo "🌐 Go to: http://localhost:5006"
    echo "🔑 Try the passwords listed above"
    echo ""
    echo "If none work, run this script again and choose option 1"
fi

echo ""
echo "🔧 Server management:"
echo "   📊 Check status: ./check-health.sh"
echo "   🔄 Restart: ./restart-server.sh"
echo "   🛑 Stop: kill $SERVER_PID"