#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function run(cmd) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit' });
}

// Usage: npm run migration:generate -- <migration-name>
const migrationName = process.argv[2] || `migration_${Date.now()}`;

try {
  // Temporary directory for schemas
  const tmpDir = path.resolve(__dirname, '../tmp_migration');
  execSync(`rm -rf ${tmpDir}`);
  execSync(`mkdir -p ${tmpDir}`);

  // Extract schema files from git branches
  execSync(`git show main:prisma/schema.prisma > ${tmpDir}/schema_main.prisma`);
  execSync(`git show staging:prisma/schema.prisma > ${tmpDir}/schema_staging.prisma`);

  // Generate SQL diff using Prisma
  const diffCmd = `npx prisma migrate diff --from-schema=${tmpDir}/schema_main.prisma --to-schema=${tmpDir}/schema_staging.prisma --script`;
  const sql = execSync(diffCmd, { encoding: 'utf8' });

  // Create migration folder
  const migrationDir = path.resolve('prisma', 'migrations', migrationName);
  execSync(`mkdir -p ${migrationDir}`);

  // Write migration.sql
  fs.writeFileSync(path.join(migrationDir, 'migration.sql'), sql);
  console.log(`✅ Migration created at ${migrationDir}`);

  // Apply migration automatically
  console.log('🚀 Applying migration...');
  execSync(`npx prisma migrate deploy --preview-feature`, { stdio: 'inherit' });
  console.log('✅ Migration applied successfully');
} catch (e) {
  console.error('❌ Migration generation failed:', e.message);
  process.exit(1);
}
