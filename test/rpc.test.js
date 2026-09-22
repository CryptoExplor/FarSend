import { describe, it, expect, vi, afterEach } from 'vitest';
import { getChainRpcUrls, createFallbackProvider, readWithFallback } from '../src/core/rpc.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('getChainRpcUrls', () => {
    it('returns primary then fallback urls, de-duplicated', () => {
        const chain = { rpcUrl: 'https://a', fallbackRpcUrls: ['https://b', 'https://a'] };
        expect(getChainRpcUrls(chain)).toEqual(['https://a', 'https://b']);
    });

    it('returns only primary when no fallbacks', () => {
        expect(getChainRpcUrls({ rpcUrl: 'https://a' })).toEqual(['https://a']);
    });

    it('returns empty when nothing present', () => {
        expect(getChainRpcUrls({})).toEqual([]);
        expect(getChainRpcUrls(null)).toEqual([]);
    });
});

describe('createFallbackProvider', () => {
    it('builds one provider per configured url, primary first', () => {
        const providers = createFallbackProvider({
            rpcUrl: 'https://primary',
            fallbackRpcUrls: ['https://fallback-a', 'https://primary']
        });
        expect(Array.isArray(providers)).toBe(true);
        // primary + 1 unique fallback (duplicate of primary dropped)
        expect(providers).toHaveLength(2);
        expect(typeof providers[0].send).toBe('function');
        expect(typeof providers[1].send).toBe('function');
    });

    it('pins a static network when chainId is known (no eth_chainId probing)', async () => {
        const providers = createFallbackProvider({ chainId: 8453, rpcUrl: 'https://a' });
        const network = await providers[0].getNetwork();
        expect(network.chainId).toBe(8453n);
    });

    it('returns null when no rpc url', () => {
        expect(createFallbackProvider({})).toBeNull();
    });
});

describe('readWithFallback', () => {
    it('returns primary result when it succeeds', async () => {
        const r = await readWithFallback(() => Promise.resolve('primary'), () => Promise.resolve('fallback'));
        expect(r).toBe('primary');
    });

    it('falls back to a single provider when primary throws', async () => {
        const r = await readWithFallback(
            () => Promise.reject(new Error('wallet rpc down')),
            (p) => `fallback:${p.id}`,
            { fallbackProvider: { id: 'pub1' } }
        );
        expect(r).toBe('fallback:pub1');
    });

    it('tries the provider list in order until one succeeds', async () => {
        const calls = [];
        const r = await readWithFallback(
            () => Promise.reject(new Error('wallet rpc down')),
            (p) => {
                calls.push(p.id);
                if (p.id === 'pub1') throw new Error('public rpc down');
                return `ok:${p.id}`;
            },
            { fallbackProvider: [{ id: 'pub1' }, { id: 'pub2' }, { id: 'pub3' }] }
        );
        expect(r).toBe('ok:pub2');
        expect(calls).toEqual(['pub1', 'pub2']); // stopped at first success
    });

    it('throws the last fallback error when every provider fails', async () => {
        await expect(readWithFallback(
            () => Promise.reject(new Error('wallet rpc down')),
            (p) => Promise.reject(new Error(`down:${p.id}`)),
            { fallbackProvider: [{ id: 'pub1' }, { id: 'pub2' }] }
        )).rejects.toThrow('down:pub2');
    });

    it('re-throws the primary error when no fallback provider is given', async () => {
        await expect(readWithFallback(
            () => Promise.reject(new Error('rpc down')),
            () => Promise.resolve('fallback')
        )).rejects.toThrow('rpc down');
    });

    it('never swallows a user rejection', async () => {
        await expect(readWithFallback(
            () => Promise.reject({ code: 'ACTION_REJECTED' }),
            () => Promise.resolve('fallback'),
            { fallbackProvider: { id: 'pub1' } }
        )).rejects.toMatchObject({ code: 'ACTION_REJECTED' });
    });
});
