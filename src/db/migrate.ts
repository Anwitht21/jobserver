import 'dotenv/config';
import { Pool } from 'pg';
import { runMigrations } from './migrations';
import { closePool } from './connection';

async function ensureDatabaseExists(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  // Parse the database URL to extract components
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.slice(1); // Remove leading '/'
  
//   if (!databaseName) {
//     throw new Error('Database name not found in DATABASE_URL');
//   }

//   // Validate database name contains only safe characters (alphanumeric, underscore, hyphen)
//   if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) {
//     throw new Error(`Invalid database name: "${databaseName}". Only alphanumeric characters, underscores, and hyphens are allowed.`);
//   }

  // Connect to the default 'postgres' database to check/create our target database
  const adminUrl = databaseUrl.replace(`/${databaseName}`, '/postgres');
  const adminPool = new Pool({ connectionString: adminUrl });

//   try {
//     // Check if database exists
//     const result = await adminPool.query(
//       `SELECT 1 FROM pg_database WHERE datname = $1`,
//       [databaseName]
//     );

//     if (result.rows.length === 0) {
//       console.log(`Database "${databaseName}" does not exist. Creating it...`);
//       // Create the database (database name is already validated, so safe to use)
//       // PostgreSQL doesn't support parameterized queries for CREATE DATABASE
//       await adminPool.query(`CREATE DATABASE "${databaseName}"`);
//       console.log(`Database "${databaseName}" created successfully.`);
//     } else {
//       console.log(`Database "${databaseName}" already exists.`);
//     }
//   } finally {
//     await adminPool.end();
//   }
}

async function main() {
  try {
    await ensureDatabaseExists();
    await runMigrations();
    await closePool();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    await closePool();
    process.exit(1);
  }
}

main();

