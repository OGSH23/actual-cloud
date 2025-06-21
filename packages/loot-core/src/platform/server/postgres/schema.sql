-- PostgreSQL Schema for Actual Budget
-- Converted from SQLite schema with PostgreSQL-specific optimizations

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- Custom PostgreSQL functions (equivalent to SQLite custom functions)

-- Unicode-aware LOWER function
CREATE OR REPLACE FUNCTION UNICODE_LOWER(text_input TEXT)
RETURNS TEXT AS $$
BEGIN
  IF text_input IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN LOWER(text_input);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Unicode-aware UPPER function
CREATE OR REPLACE FUNCTION UNICODE_UPPER(text_input TEXT)
RETURNS TEXT AS $$
BEGIN
  IF text_input IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN UPPER(text_input);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Unicode-aware LIKE function with pattern caching
CREATE OR REPLACE FUNCTION UNICODE_LIKE(pattern TEXT, text_value TEXT)
RETURNS INTEGER AS $$
DECLARE
  regex_pattern TEXT;
BEGIN
  IF pattern IS NULL THEN
    RETURN 0;
  END IF;
  
  IF text_value IS NULL THEN
    text_value := '';
  END IF;
  
  -- Convert SQL LIKE pattern to regex pattern
  -- Escape regex special chars except % and ?
  -- Convert % to .* and ? to .
  regex_pattern := regexp_replace(pattern, '[.\\*\\+\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\]', '\\\\&', 'g');
  regex_pattern := replace(regex_pattern, '?', '.');
  regex_pattern := replace(regex_pattern, '%', '.*');
  
  RETURN CASE WHEN text_value ~* regex_pattern THEN 1 ELSE 0 END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Regular expression function
CREATE OR REPLACE FUNCTION REGEXP(pattern TEXT, text_input TEXT)
RETURNS INTEGER AS $$
BEGIN
  IF text_input IS NULL THEN
    text_input := '';
  END IF;
  
  RETURN CASE WHEN text_input ~ pattern THEN 1 ELSE 0 END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Text normalization function
CREATE OR REPLACE FUNCTION NORMALISE(text_input TEXT)
RETURNS TEXT AS $$
BEGIN
  IF text_input IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Convert to lowercase and normalize Unicode
  -- PostgreSQL doesn't have built-in diacritic removal, so we approximate
  RETURN LOWER(unaccent(text_input));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Core System Tables

-- Database metadata and migration tracking
CREATE TABLE IF NOT EXISTS db_version (
    version TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS __migrations__ (
    id INTEGER PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS __meta__ (
    "key" TEXT PRIMARY KEY,
    "value" TEXT
);

-- Financial Institution Data
CREATE TABLE IF NOT EXISTS banks (
    id TEXT PRIMARY KEY,
    bank_id TEXT,
    name TEXT,
    tombstone INTEGER DEFAULT 0
);

-- Account Management (no dependencies)
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    name TEXT NOT NULL,
    balance_current INTEGER,
    balance_available INTEGER,
    balance_limit INTEGER,
    mask TEXT,
    official_name TEXT,
    type TEXT,
    subtype TEXT,
    bank TEXT, -- Foreign key will be added later
    offbudget INTEGER DEFAULT 0,
    closed INTEGER DEFAULT 0,
    sort_order REAL,
    tombstone INTEGER DEFAULT 0,
    account_sync_source TEXT,
    last_reconciled TEXT,
    last_sync TEXT
);

-- Payee Management (depends on accounts for transfer_acct)
CREATE TABLE IF NOT EXISTS payees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    transfer_acct TEXT, -- Foreign key will be added later
    tombstone INTEGER DEFAULT 0,
    favorite INTEGER DEFAULT 0,
    learn_categories INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payee_mapping (
    id TEXT PRIMARY KEY,
    targetId TEXT -- Foreign key will be added later
);

-- Category Management
CREATE TABLE IF NOT EXISTS category_groups (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE,
    is_income INTEGER DEFAULT 0,
    hidden INTEGER DEFAULT 0,
    sort_order REAL,
    tombstone INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT,
    is_income INTEGER DEFAULT 0,
    hidden INTEGER DEFAULT 0,
    cat_group TEXT, -- Foreign key will be added later
    goal_def TEXT,
    sort_order REAL,
    tombstone INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category_mapping (
    id TEXT PRIMARY KEY,
    transferId TEXT -- Foreign key will be added later
);

-- Rules and Automation (no dependencies)
CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    stage TEXT,
    conditions_op TEXT,
    conditions TEXT, -- JSON
    actions TEXT,    -- JSON
    tombstone INTEGER DEFAULT 0
);

-- Scheduling System (depends on rules)
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT,
    rule TEXT NOT NULL, -- Foreign key will be added later
    next_date INTEGER,
    completed INTEGER DEFAULT 0,
    posts_transaction INTEGER DEFAULT 0,
    tombstone INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schedules_next_date (
    schedule_id TEXT PRIMARY KEY, -- Foreign key will be added later
    local_next_date INTEGER,
    date_completed TEXT
);

CREATE TABLE IF NOT EXISTS schedules_json_paths (
    schedule_id TEXT, -- Foreign key will be added later
    payee TEXT,
    account TEXT,
    amount TEXT,
    date TEXT,
    PRIMARY KEY (schedule_id)
);

-- Transaction Management (depends on accounts, categories, payees)
CREATE TABLE IF NOT EXISTS pending_transactions (
    id TEXT PRIMARY KEY,
    acct TEXT, -- Foreign key will be added later
    amount INTEGER,
    description TEXT,
    date TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    isParent INTEGER DEFAULT 0,
    isChild INTEGER DEFAULT 0,
    parent_id TEXT, -- Foreign key will be added later (self-reference)
    acct TEXT, -- Foreign key will be added later
    category TEXT, -- Foreign key will be added later
    amount INTEGER DEFAULT 0,
    description TEXT,
    notes TEXT,
    date INTEGER NOT NULL,
    financial_id TEXT,
    type TEXT,
    location TEXT,
    error TEXT,
    imported_description TEXT,
    starting_balance_flag INTEGER DEFAULT 0,
    transferred_id TEXT,
    sort_order REAL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    cleared INTEGER DEFAULT 1,
    reconciled INTEGER DEFAULT 0,
    tombstone INTEGER DEFAULT 0,
    schedule TEXT,
    raw_synced_data TEXT
);

-- Budget Management
CREATE TABLE IF NOT EXISTS created_budgets (
    month TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS zero_budget_months (
    id TEXT PRIMARY KEY,
    buffered INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS zero_budgets (
    id TEXT PRIMARY KEY,
    month INTEGER,
    category TEXT, -- Foreign key will be added later
    amount INTEGER DEFAULT 0,
    carryover INTEGER DEFAULT 0,
    goal INTEGER,
    long_goal INTEGER
);

CREATE TABLE IF NOT EXISTS reflect_budgets (
    id TEXT PRIMARY KEY,
    month INTEGER,
    category TEXT,
    amount INTEGER DEFAULT 0,
    carryover INTEGER DEFAULT 0,
    goal INTEGER,
    long_goal INTEGER
);

-- Notes System
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    note TEXT
);

-- User Preferences
CREATE TABLE IF NOT EXISTS preferences (
    id TEXT PRIMARY KEY,
    "value" TEXT
);

-- Filtering and Reporting
CREATE TABLE IF NOT EXISTS transaction_filters (
    id TEXT PRIMARY KEY,
    name TEXT,
    conditions_op TEXT,
    conditions TEXT, -- JSON
    tombstone INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS custom_reports (
    id TEXT PRIMARY KEY,
    name TEXT,
    start_date TEXT DEFAULT '2023-06',
    end_date TEXT DEFAULT '2023-09',
    date_static INTEGER DEFAULT 0,
    date_range TEXT,
    mode TEXT DEFAULT 'total',
    group_by TEXT DEFAULT 'Category',
    sort_by TEXT DEFAULT 'desc',
    balance_type TEXT DEFAULT 'Expense',
    show_empty INTEGER DEFAULT 0,
    show_offbudget INTEGER DEFAULT 0,
    show_hidden INTEGER DEFAULT 0,
    show_uncategorized INTEGER DEFAULT 0,
    include_current INTEGER DEFAULT 0,
    graph_type TEXT DEFAULT 'BarGraph',
    conditions TEXT, -- JSON
    conditions_op TEXT,
    metadata TEXT,   -- JSON
    interval TEXT DEFAULT 'Monthly',
    color_scheme TEXT, -- JSON
    tombstone INTEGER DEFAULT 0
);

-- Dashboard System
CREATE TABLE IF NOT EXISTS dashboard (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    meta TEXT, -- JSON
    tombstone INTEGER DEFAULT 0
);

-- CRDT Synchronization System
CREATE TABLE IF NOT EXISTS messages_crdt (
    id SERIAL PRIMARY KEY,
    timestamp TEXT NOT NULL UNIQUE,
    dataset TEXT NOT NULL,
    "row" TEXT NOT NULL,
    "column" TEXT NOT NULL,
    "value" BYTEA NOT NULL
);

CREATE TABLE IF NOT EXISTS messages_clock (
    id INTEGER PRIMARY KEY,
    clock TEXT
);

-- Spreadsheet System (for calculations and formulas)
CREATE TABLE IF NOT EXISTS spreadsheet_cells (
    name TEXT PRIMARY KEY,
    expr TEXT,
    cachedValue TEXT
);

-- Key-Value Cache (for performance optimization)
CREATE TABLE IF NOT EXISTS kvcache (
    "key" TEXT PRIMARY KEY,
    "value" TEXT
);

CREATE TABLE IF NOT EXISTS kvcache_key (
    id SERIAL PRIMARY KEY,
    "key" REAL
);

-- Add foreign key constraints after all tables are created
ALTER TABLE accounts ADD CONSTRAINT fk_accounts_bank 
    FOREIGN KEY (bank) REFERENCES banks(id);

ALTER TABLE payees ADD CONSTRAINT fk_payees_transfer_acct 
    FOREIGN KEY (transfer_acct) REFERENCES accounts(id);

ALTER TABLE payee_mapping ADD CONSTRAINT fk_payee_mapping_target 
    FOREIGN KEY (targetId) REFERENCES payees(id);

ALTER TABLE categories ADD CONSTRAINT fk_categories_group 
    FOREIGN KEY (cat_group) REFERENCES category_groups(id);

ALTER TABLE category_mapping ADD CONSTRAINT fk_category_mapping_transfer 
    FOREIGN KEY (transferId) REFERENCES categories(id);

ALTER TABLE pending_transactions ADD CONSTRAINT fk_pending_transactions_acct 
    FOREIGN KEY (acct) REFERENCES accounts(id);

ALTER TABLE transactions ADD CONSTRAINT fk_transactions_parent 
    FOREIGN KEY (parent_id) REFERENCES transactions(id);

ALTER TABLE transactions ADD CONSTRAINT fk_transactions_acct 
    FOREIGN KEY (acct) REFERENCES accounts(id);

ALTER TABLE transactions ADD CONSTRAINT fk_transactions_category 
    FOREIGN KEY (category) REFERENCES categories(id);

ALTER TABLE schedules ADD CONSTRAINT fk_schedules_rule 
    FOREIGN KEY (rule) REFERENCES rules(id);

ALTER TABLE schedules_next_date ADD CONSTRAINT fk_schedules_next_date_schedule 
    FOREIGN KEY (schedule_id) REFERENCES schedules(id);

ALTER TABLE schedules_json_paths ADD CONSTRAINT fk_schedules_json_paths_schedule 
    FOREIGN KEY (schedule_id) REFERENCES schedules(id);

ALTER TABLE zero_budgets ADD CONSTRAINT fk_zero_budgets_category 
    FOREIGN KEY (category) REFERENCES categories(id);

-- Performance Indexes
-- Transaction indexes for common queries
CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category, date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(acct);
CREATE INDEX IF NOT EXISTS idx_transactions_payee ON transactions(description);
CREATE INDEX IF NOT EXISTS idx_transactions_sorted ON transactions(date DESC, starting_balance_flag, sort_order DESC, id);
CREATE INDEX IF NOT EXISTS idx_transactions_tombstone ON transactions(tombstone) WHERE tombstone = 0;

-- Payee indexes
CREATE INDEX IF NOT EXISTS idx_payees_name_lower ON payees(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_payees_tombstone ON payees(tombstone) WHERE tombstone = 0;

-- Account indexes
CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name);
CREATE INDEX IF NOT EXISTS idx_accounts_tombstone ON accounts(tombstone) WHERE tombstone = 0;
CREATE INDEX IF NOT EXISTS idx_accounts_sort_order ON accounts(sort_order, name);

-- Category indexes
CREATE INDEX IF NOT EXISTS idx_categories_group ON categories(cat_group);
CREATE INDEX IF NOT EXISTS idx_categories_tombstone ON categories(tombstone) WHERE tombstone = 0;
CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order, id);

-- Budget indexes
CREATE INDEX IF NOT EXISTS idx_zero_budgets_month_category ON zero_budgets(month, category);
CREATE INDEX IF NOT EXISTS idx_reflect_budgets_month_category ON reflect_budgets(month, category);

-- CRDT indexes for sync performance
CREATE INDEX IF NOT EXISTS idx_messages_crdt_timestamp ON messages_crdt(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_crdt_dataset_row ON messages_crdt(dataset, row);

-- Views for backward compatibility and query optimization

-- Main transactions view (matches SQLite v_transactions)
CREATE OR REPLACE VIEW v_transactions AS
SELECT
    t.id AS id,
    t.isParent AS is_parent,
    t.isChild AS is_child,
    t.acct AS account,
    CASE WHEN t.isChild = 0 THEN NULL ELSE t.parent_id END AS parent_id,
    CASE WHEN t.isParent = 1 THEN NULL ELSE COALESCE(cm.transferId, t.category) END AS category,
    COALESCE(pm.targetId, t.description) AS payee,
    t.imported_description AS imported_payee,
    COALESCE(t.amount, 0) AS amount,
    t.notes AS notes,
    t.date AS date,
    t.financial_id AS imported_id,
    t.error AS error,
    t.starting_balance_flag AS starting_balance_flag,
    t.transferred_id AS transfer_id,
    t.sort_order AS sort_order,
    t.cleared AS cleared,
    t.reconciled AS reconciled,
    t.tombstone AS tombstone,
    t.schedule AS schedule
FROM transactions t
LEFT JOIN category_mapping cm ON cm.id = t.category
LEFT JOIN payee_mapping pm ON pm.id = t.description
WHERE
    t.date IS NOT NULL AND
    t.acct IS NOT NULL AND
    COALESCE(t.tombstone, 0) = 0
ORDER BY t.date DESC, t.starting_balance_flag, t.sort_order DESC, t.id;

-- Internal transactions view for split transaction handling
CREATE OR REPLACE VIEW v_transactions_internal AS
SELECT
    t.id AS id,
    t.isParent AS is_parent,
    t.isChild AS is_child,
    t.acct AS account,
    CASE WHEN t.isChild = 0 THEN NULL ELSE t.parent_id END AS parent_id,
    CASE WHEN t.isParent = 1 THEN NULL ELSE COALESCE(cm.transferId, t.category) END AS category,
    COALESCE(pm.targetId, t.description) AS payee,
    t.imported_description AS imported_payee,
    COALESCE(t.amount, 0) AS amount,
    t.notes AS notes,
    t.date AS date,
    t.financial_id AS imported_id,
    t.error AS error,
    t.starting_balance_flag AS starting_balance_flag,
    t.transferred_id AS transfer_id,
    t.sort_order AS sort_order,
    t.cleared AS cleared,
    t.reconciled AS reconciled,
    t.tombstone AS tombstone,
    t.schedule AS schedule
FROM transactions t
LEFT JOIN category_mapping cm ON cm.id = t.category
LEFT JOIN payee_mapping pm ON pm.id = t.description
LEFT JOIN transactions t2 ON (t.isChild = 1 AND t2.id = t.parent_id)
WHERE
    t.date IS NOT NULL AND
    t.acct IS NOT NULL AND
    COALESCE(t.tombstone, 0) = 0 AND
    COALESCE(t2.tombstone, 0) = 0;

-- Alive transactions view (non-tombstoned)
CREATE OR REPLACE VIEW v_transactions_internal_alive AS
SELECT * FROM v_transactions_internal
WHERE COALESCE(tombstone, 0) = 0;

-- Categories view (matches SQLite v_categories)
CREATE OR REPLACE VIEW v_categories AS
SELECT
    id,
    name,
    is_income,
    cat_group AS group_id,
    hidden,
    goal_def,
    sort_order,
    tombstone
FROM categories;

-- Payees view with account names for transfer payees
CREATE OR REPLACE VIEW v_payees AS
SELECT
    p.id,
    COALESCE(a.name, p.name) AS name,
    p.category,
    p.transfer_acct,
    p.tombstone,
    p.favorite,
    p.learn_categories
FROM payees p
LEFT JOIN accounts a ON (p.transfer_acct = a.id AND COALESCE(a.tombstone, 0) = 0)
WHERE COALESCE(p.tombstone, 0) = 0 AND (p.transfer_acct IS NULL OR a.id IS NOT NULL)
ORDER BY p.transfer_acct IS NULL DESC, p.name, a.offbudget, a.sort_order;

-- Schedules view with rule details
CREATE OR REPLACE VIEW v_schedules AS
SELECT
    s.id,
    s.name,
    s.rule,
    s.next_date,
    s.completed,
    s.posts_transaction,
    s.tombstone,
    r.conditions,
    r.actions
FROM schedules s
LEFT JOIN rules r ON s.rule = r.id
WHERE COALESCE(s.tombstone, 0) = 0;

-- Performance optimization: Update statistics
ANALYZE;