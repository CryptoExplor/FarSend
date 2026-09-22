// @ts-check
// RPC utilities: primary + fallback endpoints per chain, and read-only
// fallback providers for resilience when the wallet's RPC node is flaky.
// Signing always stays with the wallet; only read calls may use fallback.
import { ethers } from 'ethers';

/**
 * Ordered RPC URL list for a chain config object (primary first, then
 * `fallbackRpcUrls`, de-duplicated).
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
 * Build read-only JsonRpcProviders for the chain, one per configured URL
 * (primary first, then fallbacks), or `null` if none are available.
 *
 * Returns an ARRAY so callers can fail over: the ethers v6 JsonRpcProvider
 * takes a single URL, so resilience is implemented by trying the providers
 * in order (see readWithFallback). `chainId` pins a static network so no
 * eth_chainId probing happens per provider. Never used for signing.
 *
 * @param {{ rpcUrl?: string, fallbackRpcUrls?: string[], chainId?: number }} chain
 * @returns {import('ethers').JsonRpcProvider[]|null}
 */
export function createFallbackProvider(chain) {
    const urls = getChainRpcUrls(chain);
    if (urls.length === 0) return null;
    const network = typeof chain?.chainId === 'number'
        ? new ethers.Network('chain', chain.chainId)
        : undefined;
    const providers = [];
    for (const url of urls) {
        try {
            providers.push(new ethers.JsonRpcProvider(url, network, network ? { staticNetwork: network } : undefined));
        } catch (e) {
            // Skip malformed URLs rather than breaking the whole list.
        }
    }
    return providers.length > 0 ? providers : null;
}

/**
 * Run a read-only operation, failing over to the public RPC provider(s) if
 * the primary provider throws (unless the error is a wallet rejection, which
 * is always surfaced as-is).
 *
 * `fallbackProvider` may be a single provider or an ordered list (primary
 * public RPC first). `onFallback` receives the provider currently being
 * tried, so the same read closure can run against each endpoint. A rejection
 * or any error that survives the entire list is rethrown (last error wins).
 * Signing is never attempted here.
 *
 * @template T
 * @param {() => Promise<T>} primary      - read against the wallet provider
 * @param {(provider: any) => Promise<T>} onFallback - read against one fallback provider
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
            const list = Array.isArray(fallbackProvider) ? fallbackProvider : [fallbackProvider];
            let lastError = null;
            for (const p of list) {
                try {
                    return await onFallback(p);
                } catch (e) {
                    lastError = e;
                    // This endpoint failed — try the next one.
                }
            }
            throw lastError ?? err;
        }
        throw err;
    }
}
