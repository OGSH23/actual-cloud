#!/bin/bash

# 🔄 Version Switching Script for Actual Budget
# Easily switch between SQLite (master) and PostgreSQL (stable) versions

show_help() {
    echo "🔄 Actual Budget Version Switcher"
    echo "================================"
    echo ""
    echo "Usage: ./switch-version.sh [sqlite|postgres|status|help]"
    echo ""
    echo "Commands:"
    echo "  sqlite     - Switch to SQLite version (master branch)"
    echo "  postgres   - Switch to PostgreSQL version (postgres-stable branch)"
    echo "  status     - Show current version and status"
    echo "  help       - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./switch-version.sh postgres   # Switch to PostgreSQL"
    echo "  ./switch-version.sh sqlite     # Switch to SQLite"
    echo "  ./switch-version.sh status     # Check current status"
}

show_status() {
    echo "📊 Current Actual Budget Status"
    echo "==============================="
    echo ""
    
    # Git information
    echo "🔀 Git Information:"
    echo "   Branch: $(git branch --show-current 2>/dev/null || echo 'Unknown')"
    echo "   Last commit: $(git log -1 --oneline 2>/dev/null || echo 'Unknown')"
    echo ""
    
    # Database configuration
    echo "🗄️  Database Configuration:"
    if [ "$ENABLE_POSTGRES" = "true" ] || [ "$DATABASE_ADAPTER" = "postgres" ]; then
        echo "   Active: PostgreSQL"
        echo "   Host: ${POSTGRES_HOST:-localhost}"
        echo "   Port: ${POSTGRES_PORT:-5432}"
        echo "   Database: ${POSTGRES_DATABASE:-actual_budget}"
        echo "   User: ${POSTGRES_USER:-actual_user}"
    else
        echo "   Active: SQLite"
        echo "   File-based storage in local directory"
    fi
    echo ""
    
    # Server status
    echo "🚀 Server Status:"
    if curl -s http://localhost:5006 > /dev/null 2>&1; then
        echo "   Status: ✅ Running on port 5006"
        echo "   URL: http://localhost:5006"
    else
        echo "   Status: ❌ Not running"
        echo "   Start with: yarn start:server"
    fi
    echo ""
    
    # Available versions
    echo "🔖 Available Versions:"
    echo "   master (SQLite): git checkout master"
    echo "   postgres-stable (PostgreSQL): git checkout postgres-stable"
    echo "   v1.0.0-postgres-stable (Tagged): git checkout v1.0.0-postgres-stable"
}

switch_to_sqlite() {
    echo "🗄️  Switching to SQLite Version (Master Branch)"
    echo "==============================================="
    
    # Stop server
    echo "🛑 Stopping server..."
    pkill -f "yarn start:server" 2>/dev/null || true
    sleep 3
    
    # Switch to master branch
    echo "🔀 Switching to master branch..."
    git checkout master
    if [ $? -ne 0 ]; then
        echo "❌ Failed to switch to master branch"
        exit 1
    fi
    
    # Clear PostgreSQL environment
    echo "🧹 Clearing PostgreSQL environment..."
    unset ENABLE_POSTGRES 2>/dev/null || true
    unset DATABASE_ADAPTER 2>/dev/null || true
    unset POSTGRES_HOST 2>/dev/null || true
    unset POSTGRES_PORT 2>/dev/null || true
    unset POSTGRES_DATABASE 2>/dev/null || true
    unset POSTGRES_USER 2>/dev/null || true
    unset POSTGRES_PASSWORD 2>/dev/null || true
    
    # Install dependencies
    echo "📦 Installing dependencies..."
    yarn install --silent
    
    # Start server
    echo "🚀 Starting server with SQLite..."
    nohup yarn start:server > sqlite-server.log 2>&1 &
    SERVER_PID=$!
    
    # Wait for server
    echo "⏳ Waiting for server to start..."
    for i in {1..20}; do
        if curl -s http://localhost:5006 > /dev/null 2>&1; then
            echo "✅ SQLite version is running (PID: $SERVER_PID)"
            echo "🌐 Access: http://localhost:5006"
            echo "📊 Logs: tail -f sqlite-server.log"
            echo "🛑 Stop: kill $SERVER_PID"
            return 0
        fi
        sleep 1
    done
    
    echo "❌ Server failed to start. Check logs: tail -f sqlite-server.log"
    exit 1
}

switch_to_postgres() {
    echo "🐘 Switching to PostgreSQL Version (Stable Branch)"
    echo "=================================================="
    
    # Stop server
    echo "🛑 Stopping server..."
    pkill -f "yarn start:server" 2>/dev/null || true
    sleep 3
    
    # Switch to postgres-stable branch
    echo "🔀 Switching to postgres-stable branch..."
    git checkout postgres-stable
    if [ $? -ne 0 ]; then
        echo "❌ Failed to switch to postgres-stable branch"
        exit 1
    fi
    
    # Set PostgreSQL environment
    echo "🔧 Setting PostgreSQL environment..."
    export ENABLE_POSTGRES=true
    export DATABASE_ADAPTER=postgres
    export POSTGRES_HOST=localhost
    export POSTGRES_PORT=5432
    export POSTGRES_DATABASE=actual_budget
    export POSTGRES_USER=actual_user
    export POSTGRES_PASSWORD=test123
    
    # Install dependencies
    echo "📦 Installing dependencies..."
    yarn install --silent
    
    # Check PostgreSQL connection
    echo "🔍 Testing PostgreSQL connection..."
    if ! PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DATABASE -c "SELECT 1;" > /dev/null 2>&1; then
        echo "❌ PostgreSQL connection failed"
        echo "   Make sure PostgreSQL is running: brew services start postgresql@14"
        echo "   Or run: ./start-postgres.sh"
        exit 1
    fi
    
    # Start server
    echo "🚀 Starting server with PostgreSQL..."
    nohup yarn start:server > postgres-server.log 2>&1 &
    SERVER_PID=$!
    
    # Wait for server
    echo "⏳ Waiting for server to start..."
    for i in {1..20}; do
        if curl -s http://localhost:5006 > /dev/null 2>&1; then
            echo "✅ PostgreSQL version is running (PID: $SERVER_PID)"
            echo "🌐 Access: http://localhost:5006"
            echo "📊 Logs: tail -f postgres-server.log"
            echo "🛑 Stop: kill $SERVER_PID"
            echo ""
            echo "⚠️  Note: Client-side compatibility layer may show cosmetic errors"
            echo "   Accounts will be created successfully despite error messages"
            return 0
        fi
        sleep 1
    done
    
    echo "❌ Server failed to start. Check logs: tail -f postgres-server.log"
    exit 1
}

# Main script logic
case "$1" in
    sqlite)
        switch_to_sqlite
        ;;
    postgres)
        switch_to_postgres
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        show_help
        ;;
    "")
        show_help
        ;;
    *)
        echo "❌ Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac