import { readFileSync } from 'node:fs';

const summary = JSON.parse(readFileSync(process.argv[2], 'utf-8'));

const THRESHOLDS = {
  lines: 70,
  functions: 70,
  statements: 70,
  branches: 60,
};

let failed = false;
for (const [key, min] of Object.entries(THRESHOLDS)) {
  const pct = summary.total[key].pct;
  const status = pct >= min ? '✓' : '✗';
  if (pct < min) failed = true;
  console.log(`${status} ${key.padEnd(10)} ${pct.toFixed(2).padStart(6)}%  (min ${min}%)`);
}

if (failed) {
  console.error('\nCoverage threshold not met.');
  process.exit(1);
}
console.log('\nAll coverage thresholds met.');
