#!/bin/bash

echo "🏥 Actual Budget Health Check"
echo "=================================="

# Check if server is responding
echo "1. Server Status:"
if curl -s http://localhost:5006 > /dev/null 2>&1; then
    echo "   ✅ Server is responding on port 5006"
    
    # Get server info
    SERVER_INFO=$(curl -s http://localhost:5006/account/bootstrap 2>/dev/null || echo "")
    if [ ! -z "$SERVER_INFO" ]; then
        echo "   ✅ API endpoints are working"
    else
        echo "   ⚠️  API might not be fully ready yet"
    fi
else
    echo "   ❌ Server is not responding"
    echo "   Run: ./restart-server.sh"
fi

echo ""
echo "2. PostgreSQL Status:"
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_DATABASE=actual_budget
export POSTGRES_USER=actual_user
export POSTGRES_PASSWORD=test123

if PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DATABASE -c "SELECT version();" > /dev/null 2>&1; then
    echo "   ✅ PostgreSQL is connected"
    
    # Check if tables exist
    TABLE_COUNT=$(PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DATABASE -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')
    echo "   ℹ️  Database has $TABLE_COUNT tables"
    
    if [ "$TABLE_COUNT" -gt "0" ]; then
        echo "   ✅ Database schema is initialized"
    else
        echo "   ℹ️  Database schema will be created on first use"
    fi
else
    echo "   ❌ PostgreSQL connection failed"
fi

echo ""
echo "3. Quick Access:"
echo "   🌐 Open: http://localhost:5006"
echo "   📊 Logs: tail -f server.log"
echo "   🔄 Restart: ./restart-server.sh"

echo ""
echo "4. Troubleshooting:"
echo "   If you see connection errors after sign-out:"
echo "   • Clear browser cache/cookies for localhost:5006"
echo "   • Try incognito/private browsing mode"
echo "   • Restart the server: ./restart-server.sh"