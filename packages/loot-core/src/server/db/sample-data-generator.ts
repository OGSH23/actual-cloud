// Sample data generator for PostgreSQL migration testing
// @ts-strict-ignore

import { v4 as uuidv4 } from 'uuid';
import { runQuery, transaction } from './index';

export interface SampleDataConfig {
  accounts: number;
  categories: number;
  transactions: number;
  payees: number;
  months: number; // Number of months of historical data
  budget: boolean; // Generate budget data
}

export interface GeneratedSampleData {
  accounts: any[];
  categories: any[];
  categoryGroups: any[];
  transactions: any[];
  payees: any[];
  budgets?: any[];
  stats: {
    totalRecords: number;
    generationTime: number;
    avgTransactionAmount: number;
    dateRange: { start: string; end: string };
  };
}

// Realistic account types and names
const ACCOUNT_TEMPLATES = [
  { name: 'Main Checking', type: 'checking', institution: 'Chase Bank', balance: 2500 },
  { name: 'Savings Account', type: 'savings', institution: 'Bank of America', balance: 15000 },
  { name: 'Credit Card', type: 'credit', institution: 'Discover', balance: -850 },
  { name: 'Business Checking', type: 'checking', institution: 'Wells Fargo', balance: 8500 },
  { name: 'Emergency Fund', type: 'savings', institution: 'Ally Bank', balance: 25000 },
  { name: 'Visa Credit Card', type: 'credit', institution: 'Capital One', balance: -1200 },
  { name: 'Investment Account', type: 'investment', institution: 'Fidelity', balance: 45000 },
  { name: 'Mortgage', type: 'mortgage', institution: 'Quicken Loans', balance: -250000 },
];

// Realistic category groups and categories
const CATEGORY_TEMPLATES = [
  {
    group: 'Monthly Bills',
    isIncome: false,
    categories: ['Rent/Mortgage', 'Utilities', 'Phone', 'Internet', 'Insurance']
  },
  {
    group: 'Food',
    isIncome: false,
    categories: ['Groceries', 'Restaurants', 'Coffee/Tea', 'Fast Food', 'Alcohol/Bars']
  },
  {
    group: 'Transportation',
    isIncome: false,
    categories: ['Gas', 'Car Payment', 'Car Insurance', 'Maintenance', 'Public Transport', 'Uber/Lyft']
  },
  {
    group: 'Shopping',
    isIncome: false,
    categories: ['Clothing', 'Electronics', 'Home Goods', 'Books', 'Gifts', 'Personal Care']
  },
  {
    group: 'Entertainment',
    isIncome: false,
    categories: ['Movies', 'Streaming Services', 'Games', 'Hobbies', 'Concerts', 'Sports']
  },
  {
    group: 'Health & Fitness',
    isIncome: false,
    categories: ['Medical', 'Dental', 'Pharmacy', 'Gym', 'Health Insurance']
  },
  {
    group: 'Income',
    isIncome: true,
    categories: ['Salary', 'Freelance', 'Bonus', 'Investment Returns', 'Side Hustle', 'Tax Refund']
  },
  {
    group: 'Savings & Investments',
    isIncome: false,
    categories: ['Emergency Fund', '401k', 'IRA', 'Stocks', 'Crypto', 'Real Estate']
  }
];

// Realistic payee names
const PAYEE_TEMPLATES = [
  'Walmart', 'Target', 'Amazon', 'Costco', 'Kroger', 'Safeway', 'Whole Foods',
  'Starbucks', 'McDonald\'s', 'Subway', 'Chipotle', 'Pizza Hut', 'Domino\'s',
  'Shell', 'Chevron', 'Exxon', 'BP', 'Valero',
  'Netflix', 'Spotify', 'Apple', 'Google', 'Microsoft',
  'Verizon', 'AT&T', 'T-Mobile', 'Comcast', 'DirectTV',
  'Progressive', 'State Farm', 'Geico', 'Allstate',
  'Chase Bank', 'Bank of America', 'Wells Fargo', 'Citibank',
  'Home Depot', 'Lowe\'s', 'Best Buy', 'GameStop', 'Barnes & Noble',
  'Uber', 'Lyft', 'DoorDash', 'Grubhub', 'Instacart'
];

/**
 * Generate realistic sample data for testing
 */
export async function generateSampleData(config: SampleDataConfig): Promise<GeneratedSampleData> {
  console.log('🎯 Generating sample data...', config);
  
  const startTime = Date.now();
  const generated: GeneratedSampleData = {
    accounts: [],
    categories: [],
    categoryGroups: [],
    transactions: [],
    payees: [],
    stats: {
      totalRecords: 0,
      generationTime: 0,
      avgTransactionAmount: 0,
      dateRange: { start: '', end: '' }
    }
  };

  // Generate date range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - config.months);
  
  generated.stats.dateRange = {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0]
  };

  // Generate category groups and categories
  console.log('📁 Generating categories...');
  const groupCount = Math.min(config.categories / 5, CATEGORY_TEMPLATES.length);
  for (let i = 0; i < groupCount; i++) {
    const template = CATEGORY_TEMPLATES[i];
    const groupId = uuidv4();
    
    generated.categoryGroups.push({
      id: groupId,
      name: template.group,
      is_income: template.isIncome ? 1 : 0,
      sort_order: (i + 1) * 1000,
      tombstone: 0
    });

    // Add categories for this group
    template.categories.forEach((catName, idx) => {
      generated.categories.push({
        id: uuidv4(),
        name: catName,
        cat_group: groupId,
        is_income: template.isIncome ? 1 : 0,
        sort_order: (idx + 1) * 1000,
        tombstone: 0
      });
    });
  }

  // Generate accounts
  console.log('🏦 Generating accounts...');
  const accountCount = Math.min(config.accounts, ACCOUNT_TEMPLATES.length);
  for (let i = 0; i < accountCount; i++) {
    const template = ACCOUNT_TEMPLATES[i];
    const variation = (Math.random() - 0.5) * 0.4; // ±20% variation
    const balance = Math.round(template.balance * (1 + variation) * 100); // Convert to cents
    
    generated.accounts.push({
      id: uuidv4(),
      name: template.name,
      type: template.type,
      offbudget: template.type === 'investment' || template.type === 'mortgage' ? 1 : 0,
      balance_current: balance,
      sort_order: (i + 1) * 1000,
      tombstone: 0
    });
  }

  // Generate payees
  console.log('💳 Generating payees...');
  const payeeCount = Math.min(config.payees, PAYEE_TEMPLATES.length);
  for (let i = 0; i < payeeCount; i++) {
    generated.payees.push({
      id: uuidv4(),
      name: PAYEE_TEMPLATES[i],
      category: generated.categories[Math.floor(Math.random() * generated.categories.length)]?.id || null,
      transfer_acct: null,
      tombstone: 0
    });
  }

  // Generate realistic transactions
  console.log('💰 Generating transactions...');
  let totalTransactionAmount = 0;
  
  for (let i = 0; i < config.transactions; i++) {
    // Random date within the range
    const randomTime = startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime());
    const date = new Date(randomTime);
    const dateInt = parseInt(date.toISOString().slice(0, 10).replace(/-/g, ''));

    // Pick random account, category, and payee
    const account = generated.accounts[Math.floor(Math.random() * generated.accounts.length)];
    const category = generated.categories[Math.floor(Math.random() * generated.categories.length)];
    const payee = generated.payees[Math.floor(Math.random() * generated.payees.length)];

    // Generate realistic amount based on category
    let amount = 0;
    if (category.is_income) {
      // Income: $1000-$8000
      amount = Math.round((1000 + Math.random() * 7000) * 100);
    } else {
      // Expenses: $5-$500 with some outliers
      if (Math.random() < 0.1) {
        // 10% chance of large expense ($500-$2000)
        amount = -Math.round((500 + Math.random() * 1500) * 100);
      } else {
        // Regular expense ($5-$500)
        amount = -Math.round((5 + Math.random() * 495) * 100);
      }
    }

    totalTransactionAmount += Math.abs(amount);

    generated.transactions.push({
      id: uuidv4(),
      acct: account.id,
      amount: amount,
      description: `${payee.name} - ${category.name}`,
      payee: payee.id,
      category: category.id,
      date: dateInt,
      notes: i % 10 === 0 ? `Sample transaction ${i}` : null,
      cleared: Math.random() > 0.2 ? 1 : 0, // 80% cleared
      tombstone: 0
    });

    if (i % 1000 === 0) {
      console.log(`  Generated ${i}/${config.transactions} transactions...`);
    }
  }

  // Calculate statistics
  const generationTime = Date.now() - startTime;
  generated.stats = {
    totalRecords: generated.accounts.length + generated.categories.length + 
                 generated.categoryGroups.length + generated.transactions.length + 
                 generated.payees.length,
    generationTime,
    avgTransactionAmount: totalTransactionAmount / generated.transactions.length / 100,
    dateRange: generated.stats.dateRange
  };

  console.log('✅ Sample data generation completed:', generated.stats);
  return generated;
}

/**
 * Insert generated sample data into the database
 */
export async function insertSampleData(data: GeneratedSampleData): Promise<void> {
  console.log('📊 Inserting sample data into database...');
  
  const startTime = Date.now();
  
  await transaction(async () => {
    // Insert category groups
    console.log('  Inserting category groups...');
    for (const group of data.categoryGroups) {
      await runQuery(
        'INSERT INTO category_groups (id, name, is_income, sort_order, tombstone) VALUES (?, ?, ?, ?, ?)',
        [group.id, group.name, group.is_income, group.sort_order, group.tombstone]
      );
    }

    // Insert categories
    console.log('  Inserting categories...');
    for (const category of data.categories) {
      await runQuery(
        'INSERT INTO categories (id, name, cat_group, is_income, sort_order, tombstone) VALUES (?, ?, ?, ?, ?, ?)',
        [category.id, category.name, category.cat_group, category.is_income, category.sort_order, category.tombstone]
      );
    }

    // Insert accounts
    console.log('  Inserting accounts...');
    for (const account of data.accounts) {
      await runQuery(
        'INSERT INTO accounts (id, name, type, offbudget, balance_current, sort_order, tombstone) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [account.id, account.name, account.type, account.offbudget, account.balance_current, account.sort_order, account.tombstone]
      );
    }

    // Insert payees
    console.log('  Inserting payees...');
    for (const payee of data.payees) {
      await runQuery(
        'INSERT INTO payees (id, name, category, transfer_acct, tombstone) VALUES (?, ?, ?, ?, ?)',
        [payee.id, payee.name, payee.category, payee.transfer_acct, payee.tombstone]
      );
    }

    // Insert transactions in batches for better performance
    console.log('  Inserting transactions...');
    const batchSize = 1000;
    for (let i = 0; i < data.transactions.length; i += batchSize) {
      const batch = data.transactions.slice(i, i + batchSize);
      
      for (const txn of batch) {
        await runQuery(
          'INSERT INTO transactions (id, acct, amount, description, payee, category, date, notes, cleared, tombstone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [txn.id, txn.acct, txn.amount, txn.description, txn.payee, txn.category, txn.date, txn.notes, txn.cleared, txn.tombstone]
        );
      }

      console.log(`    Inserted ${Math.min(i + batchSize, data.transactions.length)}/${data.transactions.length} transactions...`);
    }
  });

  const insertTime = Date.now() - startTime;
  console.log(`✅ Sample data insertion completed in ${insertTime}ms`);
}

/**
 * Get database statistics after data insertion
 */
export async function getDatabaseStats(): Promise<{
  tables: Record<string, number>;
  totalSize: number;
  indexes: string[];
}> {
  const stats = {
    tables: {} as Record<string, number>,
    totalSize: 0,
    indexes: [] as string[]
  };

  // Get table row counts
  const tables = ['accounts', 'categories', 'category_groups', 'transactions', 'payees'];
  
  for (const table of tables) {
    try {
      const result = await runQuery(`SELECT COUNT(*) as count FROM ${table}`, [], true) as { count: number }[];
      stats.tables[table] = result[0]?.count || 0;
    } catch (error) {
      console.warn(`Could not get count for table ${table}:`, error.message);
      stats.tables[table] = 0;
    }
  }

  return stats;
}

/**
 * Generate and insert realistic sample data for testing
 */
export async function createRealisticTestData(config: Partial<SampleDataConfig> = {}): Promise<{
  data: GeneratedSampleData;
  stats: any;
}> {
  const defaultConfig: SampleDataConfig = {
    accounts: 8,
    categories: 40,
    transactions: 5000,
    payees: 50,
    months: 12,
    budget: true
  };

  const finalConfig = { ...defaultConfig, ...config };
  
  console.log('🚀 Creating realistic test data with config:', finalConfig);
  
  // Generate data
  const data = await generateSampleData(finalConfig);
  
  // Insert into database
  await insertSampleData(data);
  
  // Get final statistics
  const stats = await getDatabaseStats();
  
  console.log('📊 Final database statistics:', stats);
  
  return { data, stats };
}