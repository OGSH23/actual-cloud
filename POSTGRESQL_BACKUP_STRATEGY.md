# 🐘 PostgreSQL Integration - Git Backup & Rollback Strategy

## 📋 Overview

This document outlines the comprehensive Git backup strategy for the PostgreSQL integration, including branch management, commit organization, and rollback procedures to ensure safe experimentation while maintaining stable checkpoints.

## 🏗️ Repository Structure

### Current Branch Layout

```
master                  ← Original stable branch (SQLite only)
├── postgres-migration  ← Development branch with PostgreSQL integration
├── postgres-stable     ← Stable checkpoint branch
└── v1.0.0-postgres-stable ← Tagged stable release
```

### Branch Descriptions

- **`master`**: Original stable branch with SQLite-only implementation
- **`postgres-migration`**: Development branch where PostgreSQL integration was built
- **`postgres-stable`**: Stable checkpoint branch created from the completed integration
- **`v1.0.0-postgres-stable`**: Tagged release marking the stable PostgreSQL integration

## 📝 Commit Organization

### Main Integration Commit

**Commit ID**: `7e8ad737`  
**Branch**: `postgres-migration`  
**Tag**: `v1.0.0-postgres-stable`

**Summary**: Complete PostgreSQL adapter integration with runtime switching
- **Files Changed**: 60 files, 17,700 insertions, 70 deletions
- **Core Features**: Runtime database switching, performance improvements, production deployment
- **Documentation**: Comprehensive guides, troubleshooting, and deployment procedures

## 🔄 Switching Between Versions

### To PostgreSQL Integration

```bash
# Option 1: Use the stable branch
git checkout postgres-stable

# Option 2: Use the tagged release
git checkout v1.0.0-postgres-stable

# Option 3: Use the development branch (latest changes)
git checkout postgres-migration
```

### Back to Original SQLite

```bash
# Return to original state
git checkout master

# Verify clean state
git status
```

### Quick Comparison

```bash
# Compare master vs PostgreSQL integration
git diff master postgres-stable

# See summary of changes
git diff --stat master postgres-stable

# Check what branches are available
git branch -a
```

## 🛠️ Rollback Procedures

### Emergency Rollback (If PostgreSQL Breaks)

```bash
# 1. Immediate rollback to stable SQLite
git checkout master

# 2. Force reset if needed (CAUTION: loses uncommitted changes)
git reset --hard master

# 3. Restart server with SQLite
unset ENABLE_POSTGRES
unset DATABASE_ADAPTER
yarn start:server

# 4. Verify SQLite operation
./check-health.sh  # If script exists, or check manually
```

### Partial Rollback (Keep Some Changes)

```bash
# 1. Start from master
git checkout master

# 2. Create new branch for selective merge
git checkout -b selective-postgres-features

# 3. Cherry-pick specific commits
git cherry-pick 7e8ad737^..7e8ad737  # PostgreSQL integration commit

# 4. Remove problematic files
git rm packages/loot-core/src/server/db/postgres-integration.ts
git commit -m "Remove problematic PostgreSQL components"
```

### File-Level Rollback

```bash
# Rollback specific files to master version
git checkout master -- packages/loot-core/src/server/db/index.ts
git checkout master -- packages/loot-core/src/server/budget/base.ts

# Commit the selective rollback
git commit -m "Rollback database layer to SQLite-only"
```

## 🔧 Utility Commands

### Branch Management

```bash
# List all branches with last commit
git branch -v

# Show which files differ between branches
git diff --name-only master postgres-stable

# Create backup branch from current state
git branch backup-$(date +%Y%m%d-%H%M%S)

# Delete branch (if needed)
git branch -d branch-name
```

### Commit Analysis

```bash
# View detailed commit history
git log --oneline --graph --all

# See what files changed in PostgreSQL integration
git show --stat 7e8ad737

# View specific file changes
git show 7e8ad737 -- packages/loot-core/src/server/db/index.ts
```

### Tag Management

```bash
# List all tags
git tag -l

# Create new tag
git tag -a v1.1.0-postgres -m "PostgreSQL integration v1.1.0"

# Push tags to remote
git push origin --tags

# Delete tag (if needed)
git tag -d v1.0.0-postgres-stable
```

## 📊 File Change Summary

### Core Database Layer
- `packages/loot-core/src/server/db/index.ts` - Main database adapter with switching logic
- `packages/loot-core/src/server/db/config.ts` - Configuration management (NEW)
- `packages/loot-core/src/platform/server/postgres/` - PostgreSQL adapter (NEW)

### Budget System Updates
- `packages/loot-core/src/server/budget/base.ts` - Updated for async compatibility
- `packages/loot-core/src/server/budget/envelope.ts` - Query compatibility fixes
- `packages/loot-core/src/server/budget/report.ts` - Query compatibility fixes

### Documentation & Scripts
- `README_POSTGRESQL.md` - Main PostgreSQL documentation (NEW)
- `POSTGRESQL_INTEGRATION_SUMMARY.md` - Technical summary (NEW)
- `packages/loot-core/src/server/db/POSTGRES_DEPLOYMENT_GUIDE.md` - Deployment guide (NEW)
- `start-postgres.sh`, `switch-database.sh` - Utility scripts (NEW)

### Dependencies
- `package.json` - Added PostgreSQL dependencies
- `packages/loot-core/package.json` - Added pg and @types/pg
- `yarn.lock` - Updated dependency lock

## 🎯 Testing Strategy

### Before Switching Branches

```bash
# 1. Save current work
git add .
git commit -m "WIP: Save current state before branch switch"

# 2. Note current configuration
echo "Current adapter: $DATABASE_ADAPTER"
echo "PostgreSQL enabled: $ENABLE_POSTGRES"

# 3. Stop server
pkill -f "yarn start:server" || true
```

### After Switching Branches

```bash
# 1. Install dependencies (if needed)
yarn install

# 2. Set appropriate environment variables
# For PostgreSQL branches:
export ENABLE_POSTGRES=true
# For master branch:
unset ENABLE_POSTGRES

# 3. Start server
yarn start:server

# 4. Verify operation
curl -s http://localhost:5006 > /dev/null && echo "Server OK" || echo "Server Error"
```

### Validation Checklist

- [ ] Dependencies installed correctly
- [ ] Environment variables set appropriately
- [ ] Server starts without errors
- [ ] Database connections working
- [ ] Core functionality operational
- [ ] No error messages in logs

## 🚨 Emergency Procedures

### If PostgreSQL Integration Breaks Everything

```bash
#!/bin/bash
# emergency-rollback.sh

echo "🚨 Emergency rollback to SQLite-only master branch"

# 1. Force stop all processes
pkill -f "yarn start:server" || true
pkill -f "node.*actual" || true

# 2. Hard reset to master
git checkout master
git reset --hard master

# 3. Clear environment
unset ENABLE_POSTGRES
unset DATABASE_ADAPTER
unset POSTGRES_HOST
unset POSTGRES_PORT
unset POSTGRES_DATABASE
unset POSTGRES_USER
unset POSTGRES_PASSWORD

# 4. Reinstall dependencies
yarn install

# 5. Start with SQLite
yarn start:server &

echo "✅ Rollback complete. Server running with SQLite on master branch."
echo "🌐 Check: http://localhost:5006"
```

### If Git Gets Confused

```bash
# Check git status
git status

# See what branch you're on
git branch

# If in detached HEAD state, create new branch
git checkout -b recovery-branch

# If merge conflicts, abort and start over
git merge --abort
git checkout master
```

## 📈 Future Branch Strategy

### For New PostgreSQL Features

```bash
# 1. Start from stable PostgreSQL branch
git checkout postgres-stable

# 2. Create feature branch
git checkout -b feature/client-side-compatibility

# 3. Work on feature
# ... make changes ...

# 4. Commit and merge back
git commit -m "fix: client-side PostgreSQL compatibility"
git checkout postgres-stable
git merge feature/client-side-compatibility

# 5. Update stable tag
git tag -a v1.1.0-postgres-stable -m "PostgreSQL v1.1.0 with client-side fixes"
```

### For Experimental Changes

```bash
# Always branch from stable state
git checkout postgres-stable
git checkout -b experiment/remove-sqlite

# Work in experimental branch
# If successful, merge back
# If failed, just delete branch
git checkout postgres-stable
git branch -D experiment/remove-sqlite
```

## 📋 Quick Reference Commands

```bash
# Switch to PostgreSQL
git checkout postgres-stable
export ENABLE_POSTGRES=true
yarn start:server

# Switch to SQLite
git checkout master
unset ENABLE_POSTGRES
yarn start:server

# Emergency reset
git checkout master && git reset --hard master

# Create backup
git branch backup-$(date +%Y%m%d-%H%M%S)

# List all commits
git log --oneline --graph --all

# Show file changes
git diff --name-only master postgres-stable
```

## ✅ Verification Steps

After any branch switch or rollback:

1. **Check branch**: `git branch` (should show correct branch)
2. **Check environment**: `env | grep POSTGRES`
3. **Check dependencies**: `yarn install` (should complete without errors)
4. **Check server**: `yarn start:server` (should start without errors)
5. **Check functionality**: Create test account/transaction
6. **Check logs**: No error messages in server output

## 🎉 Conclusion

This backup strategy ensures that:
- ✅ PostgreSQL integration is safely preserved in stable branches and tags
- ✅ Original SQLite functionality is always available via master branch
- ✅ Emergency rollback procedures are clearly documented
- ✅ Experimental changes can be made safely without risk
- ✅ Multiple recovery options are available for different scenarios

The PostgreSQL integration can be safely experimented with, knowing that a stable SQLite version is always just one `git checkout master` away!