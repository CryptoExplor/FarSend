// @ts-check
// RPC utilities: primary + fallback endpoints per chain, and a read-only
// fallback provider for resilience when the wallet's RPC node is flaky.
// Signing always stays with the wallet; only read calls may use fallback.
import { ethers } from 'ethers';

/**
 * Ordered RPC URL list for a chain config object (primary first, then
 * `fallbackRpcUrls`).
 * @param {{ rpcUrl?: string, fallbackRpcUrls?: string[] }} chain
 * @returns {string[]}
 */
export function getChainRpcUrls(chain) {
    const urls = [];
    if (chain?.rpcUrl) urls.push(chain.rpcUrl);
    if (Array.isArray(chain?.fallbackRpcUrls)) {
        for (const u of chain.fallbackRpcUrls) {
            if (typeof u === 'string' && !urls.includes(u)) urls.push(u);
        }
    }
    return urls;
}

/**
 * Build a read-only JsonRpcProvider from the chain's primary public RPC, or
 * `null` if none is available. Useful as a fallback for balance/allowance/
 * metadata reads. Never used for signing.
 * @param {{ rpcUrl?: string, fallbackRpcUrls?: string[] }} chain
 * @returns {import('ethers').JsonRpcProvider|null}
 */
export function createFallbackProvider(chain) {
    const urls = getChainRpcUrls(chain);
    if (urls.length === 0) return null;
    try {
        return new ethers.JsonRpcProvider(urls[0]);
    } catch (e) {
        return null;
    }
}

/**
 * Run a read-only operation, falling back to a public RPC provider if the
 * primary provider throws (unless the error is a wallet rejection, which is
 * always surfaced as-is). Signing is never attempted here.
 *
 * @template T
 * @param {() => Promise<T>} primary      - read against the wallet provider
 * @param {() => Promise<T>} onFallback   - read against the fallback provider
 * @param {{ fallbackProvider?: any }} [opts]
 * @returns {Promise<T>}
 */
export async function readWithFallback(primary, onFallback, { fallbackProvider = null } = {}) {
    try {
        return await primary();
    } catch (err) {
        // Never swallow a user rejection.
        if (err?.code === 'ACTION_REJECTED' || err?.code === 4001) throw err;
        if (fallbackProvider) {
            try {
                return await onFallback();
            } catch (e) {
                throw e;
            }
        }
        throw err;
    }
}
