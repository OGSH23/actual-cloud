# Actual Budget PostgreSQL Migration Project

## 🎯 Project Goal

Converting Actual Budget from SQLite to PostgreSQL to enable multi-user, cloud-based deployments.

## 🗂️ Key Project Info

- **Local Path**: `/Users/atl/Documents/GitHub/actual-cloud`
- **Node Version**: 24.1.0 (use `node -v` to verify)
- **Package Manager**: Yarn 4.9.1
- **Server Port**: http://localhost:5006

## 💳 Claude Code Plan & Usage

- **Plan**: Pro ($20/month)
- **Usage Limit**: ~10-40 prompts every 5 hours (shared with web Claude)
- **Model Access**: Claude Sonnet 4 (no Opus 4 access on Pro plan)
- **Rate Limit Reset**: Every 5 hours
- **Monitor Usage**: Use `/status` command to check remaining allocation
- **Optimization**: Be strategic with complex multi-file operations to conserve usage

## 🗃️ Database Configuration

- **PostgreSQL User**: `actual_user`
- **PostgreSQL Password**: `1234567890`
- **Database Name**: `actual`
- **Connection URL**: `postgresql://actual_user:1234567890@localhost:5432/actual`
- **Test Connection**: `psql postgresql://actual_user:1234567890@localhost:5432/actual`

## 🔨 Build Commands

```bash
# Install dependencies
yarn install

# Build server
yarn build:server

# Start server
yarn start:server
```

## 📁 Critical Migration Files

- **Current SQLite Adapter**: `packages/loot-core/src/platform/server/sqlite/index.electron.ts`
- **New PostgreSQL Adapter**: `packages/loot-core/src/platform/server/postgres/index.ts` (in progress)
- **Database Config**: Look for database initialization and connection logic
- **Package.json**: Already has `pg` package installed

## 🎯 Migration Status

✅ PostgreSQL database created and accessible
✅ `pg` package installed
✅ PostgreSQL adapter scaffold created
✅ PostgreSQL adapter implemented with full SQLite compatibility
✅ Custom functions ported (UNICODE_LOWER, UNICODE_UPPER, UNICODE_LIKE, REGEXP, NORMALISE)
✅ Parameter binding conversion (? to $1, $2, etc.)
✅ Transaction handling with savepoint support
✅ Connection pooling and management
✅ PostgreSQL schema created and fully tested
✅ All database tables, views, indexes, and constraints working
✅ CRUD operations validated
✅ Foreign key constraints functional
✅ Custom functions tested and working
✅ Schema initialization scripts created
✅ Comprehensive test suite passed
✅ **ASYNC CONVERSION COMPLETE**: Core database layer now fully async-compatible
✅ All database functions (runQuery, all, first, run, etc.) now return Promises
✅ Backward compatibility maintained with legacy sync functions
✅ Database adapter pattern implemented for future PostgreSQL integration
✅ Build successful with no breaking changes
✅ Production-ready async database foundation
🔄 **Next Phase**: Application layer async conversion (ready to begin)

## ✅ Critical Integration Challenge - RESOLVED

**PROBLEM SOLVED**: The async/sync interface mismatch has been successfully resolved through a comprehensive async conversion of the core database layer.

### 🛠️ Solution Implemented

**Async Foundation Layer Conversion**:
- ✅ All core database functions now return Promises
- ✅ Backward compatibility maintained with legacy sync functions  
- ✅ Clean adapter pattern ready for PostgreSQL
- ✅ Zero breaking changes to existing code
- ✅ Production-ready async infrastructure

### 📋 What Was Converted

1. **Core Functions**: `runQuery`, `all`, `first`, `run`, `execQuery`
2. **Transaction Handling**: `transaction`, `asyncTransaction`  
3. **Database Management**: `openDatabase`, `closeDatabase`
4. **Adapter Infrastructure**: Runtime adapter switching support
5. **Error Handling**: Consistent Promise-based patterns

### 🔄 Migration Path

**Phase 1 (COMPLETE)**: Core database layer async conversion
**Phase 2 (NEXT)**: Application layer conversion using established patterns
**Phase 3 (FUTURE)**: PostgreSQL adapter integration and testing

## 🧩 Code Patterns

- This is a Node.js/TypeScript project
- Uses Yarn workspaces (loot-core is a package)
- Database adapters are in `packages/loot-core/src/platform/server/`
- Look for SQLite-specific code using `better-sqlite3`
- Replace with PostgreSQL equivalents using `pg` package

## 📝 Change Management & History

**IMPORTANT: Always commit changes incrementally for full audit trail**

### Required Git Workflow

- **ALWAYS** commit each logical change separately with descriptive messages
- **NEVER** make multiple unrelated changes in one commit
- Use format: `git commit -m "feat/fix/refactor: specific change description"`
- Tag major milestones: `git tag -a v0.1-postgres-adapter -m "Initial PostgreSQL adapter"`

### Change Documentation

- Document WHY each change was made, not just WHAT
- Include before/after comparisons for complex refactors
- Note any breaking changes or compatibility considerations
- Reference issue numbers or design decisions

### Testing Requirements

- Run tests after each change: `yarn test` (if available)
- Verify server still starts: `yarn start:server`
- Test database connectivity after adapter changes
- Document any new test cases needed

## 🚨 Important Notes

- Currently running on SQLite - PostgreSQL adapter needs implementation
- Test changes carefully - this affects financial data
- Consider database migration scripts for existing data
- Maintain API compatibility with existing Actual Budget features
