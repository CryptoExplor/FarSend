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
    it('builds a provider from the primary rpc url', () => {
        const p = createFallbackProvider({ rpcUrl: 'https://a' });
        expect(p).not.toBeNull();
        expect(typeof p.send).toBe('function');
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

    it('falls back when primary throws and a fallback provider is present', async () => {
        const r = await readWithFallback(
            () => Promise.reject(new Error('rpc down')),
            () => Promise.resolve('fallback'),
            { fallbackProvider: {} }
        );
        expect(r).toBe('fallback');
    });

    it('re-throws primary error when no fallback provider', async () => {
        await expect(readWithFallback(
            () => Promise.reject(new Error('rpc down')),
            () => Promise.resolve('fallback')
        )).rejects.toThrow('rpc down');
    });

    it('never swallows a user rejection', async () => {
        await expect(readWithFallback(
            () => Promise.reject({ code: 'ACTION_REJECTED' }),
            () => Promise.resolve('fallback'),
            { fallbackProvider: {} }
        )).rejects.toMatchObject({ code: 'ACTION_REJECTED' });
    });
});
