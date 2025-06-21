#!/bin/bash

# 🚨 Emergency Rollback Script for Actual Budget PostgreSQL Integration
# This script provides immediate rollback to stable SQLite operation

echo "🚨 Emergency Rollback to SQLite-Only Master Branch"
echo "=================================================="

# Function to cleanup and exit
cleanup_and_exit() {
    echo "❌ Emergency rollback failed. Manual intervention required."
    echo "📋 Manual steps:"
    echo "   1. git checkout master"
    echo "   2. git reset --hard master"
    echo "   3. unset ENABLE_POSTGRES"
    echo "   4. yarn start:server"
    exit 1
}

# Trap errors
trap cleanup_and_exit ERR

echo "1️⃣ Stopping all server processes..."
pkill -f "yarn start:server" 2>/dev/null || true
pkill -f "node.*actual" 2>/dev/null || true
sleep 3

echo "2️⃣ Checking Git repository status..."
if ! git status > /dev/null 2>&1; then
    echo "❌ Not in a Git repository or Git error"
    exit 1
fi

echo "3️⃣ Creating backup of current state..."
BACKUP_BRANCH="emergency-backup-$(date +%Y%m%d-%H%M%S)"
if git diff --quiet && git diff --cached --quiet; then
    echo "   No uncommitted changes to backup"
else
    echo "   Creating backup branch: $BACKUP_BRANCH"
    git add . 2>/dev/null || true
    git commit -m "Emergency backup before rollback to master" 2>/dev/null || true
    git branch "$BACKUP_BRANCH" 2>/dev/null || true
    echo "   ✅ Backup created: $BACKUP_BRANCH"
fi

echo "4️⃣ Rolling back to master branch..."
git checkout master
git reset --hard master

echo "5️⃣ Clearing PostgreSQL environment variables..."
unset ENABLE_POSTGRES 2>/dev/null || true
unset DATABASE_ADAPTER 2>/dev/null || true
unset POSTGRES_HOST 2>/dev/null || true
unset POSTGRES_PORT 2>/dev/null || true
unset POSTGRES_DATABASE 2>/dev/null || true
unset POSTGRES_USER 2>/dev/null || true
unset POSTGRES_PASSWORD 2>/dev/null || true

echo "6️⃣ Ensuring dependencies are correct..."
if ! yarn install --check-files 2>/dev/null; then
    echo "   Installing dependencies..."
    yarn install
fi

echo "7️⃣ Starting server with SQLite..."
nohup yarn start:server > emergency-rollback.log 2>&1 &
SERVER_PID=$!

echo "8️⃣ Waiting for server to start..."
for i in {1..30}; do
    if curl -s http://localhost:5006 > /dev/null 2>&1; then
        echo "   ✅ Server is running (PID: $SERVER_PID)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "   ❌ Server failed to start within 30 seconds"
        echo "   📊 Check logs: tail -f emergency-rollback.log"
        exit 1
    fi
    sleep 1
done

echo ""
echo "🎉 Emergency rollback completed successfully!"
echo "================================="
echo "✅ Current state:"
echo "   • Branch: $(git branch --show-current)"
echo "   • Database: SQLite (original)"
echo "   • Server: Running on http://localhost:5006"
echo "   • PID: $SERVER_PID"
echo ""
echo "📊 Verification:"
echo "   • Server logs: tail -f emergency-rollback.log"
echo "   • Test access: curl http://localhost:5006"
echo "   • Web interface: http://localhost:5006"
echo ""
if [ ! -z "$BACKUP_BRANCH" ]; then
    echo "💾 Your work was backed up to branch: $BACKUP_BRANCH"
    echo "   To restore: git checkout $BACKUP_BRANCH"
    echo ""
fi
echo "🔄 To return to PostgreSQL integration:"
echo "   git checkout postgres-stable"
echo "   export ENABLE_POSTGRES=true"
echo "   yarn start:server"
echo ""
echo "🛑 To stop server: kill $SERVER_PID"