const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const filesToCheck = [
  'lib/db.js',
  'lib/webpush.js',
  'api/auth.js',
  'api/expenses.js',
  'api/push.js',
  'api/test-push.js',
  'api/admin.js',
  'api/users.js',
];

const forbiddenSnippets = [
  'fallback_secret_change_in_prod',
  'kontrakan_legacy_jwt_secret_v2',
  'legacyVapidPrivateKey',
  'ICtQK62UwsqaAZyJ-ca1a20MtKQTYAd5Wsuws6YiRFM',
  'kontrakan123',
  "../../lib/db",
];

let failed = false;

for (const relativePath of filesToCheck) {
  const fullPath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(fullPath, 'utf8');

  for (const snippet of forbiddenSnippets) {
    if (source.includes(snippet)) {
      failed = true;
      console.error(`Forbidden snippet "${snippet}" ditemukan di ${relativePath}`);
    }
  }

  try {
    new Function(source);
  } catch (error) {
    failed = true;
    console.error(`Syntax error di ${relativePath}: ${error.message}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('Smoke check passed.');
