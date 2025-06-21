// Test statement splitting to identify the issue
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaPath = join(__dirname, 'packages/loot-core/src/platform/server/postgres/schema.sql');
const schemaSql = readFileSync(schemaPath, 'utf8');

// Original splitting approach (what the debug script was using)
const statements = schemaSql
  .split(';')
  .map(stmt => stmt.trim())
  .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

console.log('Total statements found:', statements.length);
console.log('\nFirst 20 statements:');

for (let i = 0; i < Math.min(20, statements.length); i++) {
  const stmt = statements[i].replace(/\s+/g, ' ').substring(0, 100);
  console.log(`${i + 1}: ${stmt}${statements[i].length > 100 ? '...' : ''}`);
}

// Look for payees table specifically
console.log('\nLooking for payees table:');
for (let i = 0; i < statements.length; i++) {
  if (statements[i].includes('CREATE TABLE') && statements[i].includes('payees')) {
    console.log(`Found payees table at statement ${i + 1}:`);
    console.log(statements[i]);
    break;
  }
}

// Look for foreign key constraints
console.log('\nLooking for foreign key constraints:');
for (let i = 0; i < statements.length; i++) {
  if (statements[i].includes('ALTER TABLE') && statements[i].includes('payees')) {
    console.log(`Found payees foreign key at statement ${i + 1}:`);
    console.log(statements[i]);
    break;
  }
}