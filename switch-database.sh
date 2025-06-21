#!/bin/bash

# Database switching utility for Actual Budget

show_help() {
    echo "🔄 Actual Budget Database Switcher"
    echo ""
    echo "Usage: ./switch-database.sh [postgres|sqlite]"
    echo ""
    echo "Options:"
    echo "  postgres  - Switch to PostgreSQL database"
    echo "  sqlite    - Switch to SQLite database (default)"
    echo "  status    - Show current database configuration"
    echo "  help      - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./switch-database.sh postgres   # Switch to PostgreSQL"
    echo "  ./switch-database.sh sqlite     # Switch to SQLite"
    echo "  ./switch-database.sh status     # Check current config"
}

show_status() {
    echo "📊 Current Database Configuration:"
    echo ""
    if [ "$ENABLE_POSTGRES" = "true" ] || [ "$DATABASE_ADAPTER" = "postgres" ]; then
        echo "   🐘 Active Database: PostgreSQL"
        echo "   Host: ${POSTGRES_HOST:-localhost}"
        echo "   Port: ${POSTGRES_PORT:-5432}"
        echo "   Database: ${POSTGRES_DATABASE:-actual_budget}"
        echo "   User: ${POSTGRES_USER:-actual_user}"
    else
        echo "   🗄️  Active Database: SQLite"
        echo "   File-based storage in local directory"
    fi
    echo ""
}

switch_to_postgres() {
    echo "🐘 Switching to PostgreSQL..."
    echo ""
    
    # Test connection first
    POSTGRES_HOST=${POSTGRES_HOST:-localhost}
    POSTGRES_PORT=${POSTGRES_PORT:-5432}
    POSTGRES_DATABASE=${POSTGRES_DATABASE:-actual_budget}
    POSTGRES_USER=${POSTGRES_USER:-actual_user}
    POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-test123}
    
    echo "Testing PostgreSQL connection..."
    if PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DATABASE -c "SELECT 1;" > /dev/null 2>&1; then
        echo "✅ PostgreSQL connection successful"
        
        export ENABLE_POSTGRES=true
        export DATABASE_ADAPTER=postgres
        export POSTGRES_HOST=$POSTGRES_HOST
        export POSTGRES_PORT=$POSTGRES_PORT
        export POSTGRES_DATABASE=$POSTGRES_DATABASE
        export POSTGRES_USER=$POSTGRES_USER
        export POSTGRES_PASSWORD=$POSTGRES_PASSWORD
        
        echo ""
        echo "🎉 Switched to PostgreSQL!"
        echo "   Start the server with: yarn start:server"
        echo "   Or use: ./start-postgres.sh"
        
    else
        echo "❌ PostgreSQL connection failed"
        echo "   Make sure PostgreSQL is running: brew services start postgresql@14"
        echo "   And the database exists: createdb actual_budget"
        exit 1
    fi
}

switch_to_sqlite() {
    echo "🗄️  Switching to SQLite..."
    
    unset ENABLE_POSTGRES
    unset DATABASE_ADAPTER
    unset POSTGRES_HOST
    unset POSTGRES_PORT
    unset POSTGRES_DATABASE
    unset POSTGRES_USER
    unset POSTGRES_PASSWORD
    
    echo "✅ Switched to SQLite!"
    echo "   Start the server with: yarn start:server"
    echo "   Data will be stored in local SQLite files"
}

case "$1" in
    postgres)
        switch_to_postgres
        ;;
    sqlite)
        switch_to_sqlite
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
        echo "❌ Unknown option: $1"
        echo ""
        show_help
        exit 1
        ;;
esac