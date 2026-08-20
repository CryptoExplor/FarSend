// Build/CI-time validation of public/chains.json.
//
// Verifies:
//   1. The file is valid JSON with the expected top-level shape.
//   2. Every chain has the required fields and a valid contract address.
//   3. Chain IDs are unique.
//   4. The chain set matches the AppKit networks the frontend imports
//      (single-source-of-truth drift guard). Keep EXPECTED_CHAIN_IDS in sync
//      with the `networks: [...]` array in main.js.
//
// Exit code 0 on success, 1 on any failure.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAINS_PATH = join(__dirname, '..', 'public', 'chains.json');

// MUST match `networks: [base, mainnet, optimism, arbitrum, bsc, avalanche, polygon, litvmLiteForge]`
// in main.js (ids 8453,1,10,42161,56,43114,137,4441).
const EXPECTED_CHAIN_IDS = [8453, 1, 10, 42161, 56, 43114, 137, 4441];

function isHexAddress(addr) {
    return typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr);
}

const config = JSON.parse(readFileSync(CHAINS_PATH, 'utf8'));
const errors = [];
const chains = config.chains;

if (!chains || typeof chains !== 'object') {
    errors.push('missing "chains" object');
}
if (!Array.isArray(config.abi) || config.abi.length === 0) {
    errors.push('missing or empty "abi" array');
}

const seenIds = new Set();
const actualIds = [];
for (const [key, chain] of Object.entries(chains || {})) {
    const id = Number(key);
    actualIds.push(id);

    if (seenIds.has(id)) errors.push(`duplicate chain id ${id}`);
    seenIds.add(id);

    for (const field of ['name', 'rpcUrl', 'explorerUrl', 'contractAddress']) {
        if (!chain[field]) errors.push(`chain ${key}: missing "${field}"`);
    }
    if (!chain.nativeCurrency || !chain.nativeCurrency.symbol || chain.nativeCurrency.decimals === undefined) {
        errors.push(`chain ${key}: invalid nativeCurrency`);
    }
    if (chain.contractAddress && !isHexAddress(chain.contractAddress)) {
        errors.push(`chain ${key}: contractAddress is not a valid address (${chain.contractAddress})`);
    }
    if (id !== Number(chain.chainId)) {
        errors.push(`chain ${key}: chainId field (${chain.chainId}) does not match key (${id})`);
    }
}

// Drift guard vs. AppKit networks.
const expectedSet = new Set(EXPECTED_CHAIN_IDS.map(String));
const actualSet = new Set(actualIds.map(String));
for (const id of EXPECTED_CHAIN_IDS) {
    if (!actualSet.has(String(id))) errors.push(`chain ${id} is in main.js networks but missing from chains.json`);
}
for (const id of actualIds) {
    if (!expectedSet.has(String(id))) errors.push(`chain ${id} is in chains.json but not in main.js networks`);
}

if (errors.length > 0) {
    console.error('❌ chains.json validation failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
}

console.log(`✅ chains.json OK (${Object.keys(chains).length} chains, ABI present, matches AppKit networks)`);
