import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const bytes = readFileSync('../shared/MealForward.abi.json');
const manifest = JSON.parse(readFileSync('../shared/abi-manifest.json', 'utf8'));
if (createHash('sha256').update(bytes).digest('hex') !== manifest.abiSha256) throw Error('Source ABI hash mismatch');
writeFileSync('abis/MealForward.abi.json', bytes);
