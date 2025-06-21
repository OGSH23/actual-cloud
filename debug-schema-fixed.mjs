// Debug PostgreSQL schema issues with proper SQL parsing
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pool = new Pool({
  connectionString: 'postgresql://actual_user:1234567890@localhost:5432/actual'
});

// Better SQL statement parsing that handles multi-line statements
function parseStatements(sql) {
  const statements = [];
  let current = '';
  let inString = false;
  let stringChar = null;
  let depth = 0;
  
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const prevChar = i > 0 ? sql[i - 1] : '';
    
    if (!inString) {
      if (char === "'" || char === '"') {
        inString = true;
        stringChar = char;
      } else if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      } else if (char === ';' && depth === 0) {
        const stmt = current.trim();
        if (stmt && !stmt.startsWith('--') && stmt.length > 5) {
          statements.push(stmt);
        }
        current = '';
        continue;
      }
    } else {
      if (char === stringChar && prevChar !== '\\') {
        inString = false;
        stringChar = null;
      }
    }
    
    current += char;
  }
  
  // Add final statement if exists
  const finalStmt = current.trim();
  if (finalStmt && !finalStmt.startsWith('--') && finalStmt.length > 5) {
    statements.push(finalStmt);
  }
  
  return statements;
}

async function debugSchema() {
  console.log('🔍 Debugging PostgreSQL Schema Issues with Better Parsing\n');
  
  const client = await pool.connect();
  
  try {
    // Clean up first
    console.log('🧹 Cleaning up existing objects...');
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    
    const schemaPath = join(__dirname, 'packages/loot-core/src/platform/server/postgres/schema.sql');
    const schemaSql = readFileSync(schemaPath, 'utf8');
    
    // Parse statements properly
    const statements = parseStatements(schemaSql);
    
    console.log(`Found ${statements.length} SQL statements to execute\n`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.replace(/\s+/g, ' ').substring(0, 120);
      
      console.log(`\n📝 Executing statement ${i + 1}/${statements.length}:`);
      console.log(preview + (statement.length > 120 ? '...' : ''));
      
      try {
        await client.query(statement);
        console.log(`✅ Statement ${i + 1} executed successfully`);
      } catch (error) {
        console.error(`❌ Statement ${i + 1} failed:`, error.message);
        console.error(`\nFull statement:\n${statement}\n`);
        
        // Try to give helpful context
        if (error.message.includes('does not exist')) {
          console.error('💡 This error suggests a dependency issue. Checking what tables exist...');
          const tablesResult = await client.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' ORDER BY table_name
          `);
          console.error('Available tables:', tablesResult.rows.map(r => r.table_name).join(', '));
        }
        break;
      }
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

debugSchema();