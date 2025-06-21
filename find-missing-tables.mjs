// Find all CREATE TABLE statements in the schema
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaPath = join(__dirname, 'packages/loot-core/src/platform/server/postgres/schema.sql');
const schemaSql = readFileSync(schemaPath, 'utf8');

// Find all CREATE TABLE statements
const createTableMatches = schemaSql.match(/CREATE TABLE[^;]+;/gs);

console.log('All CREATE TABLE statements found:');
console.log('='.repeat(50));

if (createTableMatches) {
  createTableMatches.forEach((match, index) => {
    const tableName = match.match(/CREATE TABLE[^(]*?([a-zA-Z_]+)\s*\(/);
    const name = tableName ? tableName[1] : 'UNKNOWN';
    console.log(`${index + 1}. ${name}`);
    console.log(match.replace(/\s+/g, ' ').substring(0, 150) + '...');
    console.log('-'.repeat(30));
  });
  
  console.log(`\nTotal CREATE TABLE statements: ${createTableMatches.length}`);
} else {
  console.log('No CREATE TABLE statements found!');
}

// Now let's see what happens with statement splitting
console.log('\n' + '='.repeat(50));
console.log('STATEMENT SPLITTING ANALYSIS');
console.log('='.repeat(50));

const statements = schemaSql
  .split(';')
  .map(stmt => stmt.trim())
  .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

const createTableStatements = statements.filter(stmt => stmt.includes('CREATE TABLE'));
console.log(`\nCREATE TABLE statements after splitting: ${createTableStatements.length}`);

createTableStatements.forEach((stmt, index) => {
  const tableName = stmt.match(/CREATE TABLE[^(]*?([a-zA-Z_]+)\s*\(/);
  const name = tableName ? tableName[1] : 'UNKNOWN';
  console.log(`${index + 1}. ${name}`);
});

// Check for specific tables
const expectedTables = ['accounts', 'payees', 'categories', 'transactions'];
console.log('\nChecking for expected tables:');
expectedTables.forEach(table => {
  const found = createTableStatements.some(stmt => stmt.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
  console.log(`${table}: ${found ? '✅ FOUND' : '❌ MISSING'}`);
});