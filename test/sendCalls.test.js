import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    supportsSendCalls,
    toSendCall,
    sendCalls,
    waitForSendCalls,
    generateBatchId,
    normalizeCallStatus,
    classifySendCallsError
} from '../src/core/sendCalls.js';

afterEach(() => vi.restoreAllMocks());

describe('generateBatchId', () => {
    it('returns a 0x-prefixed 64-hex-char id', () => {
        expect(generateBatchId()).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('is unique across generations', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateBatchId()));
        expect(ids.size).toBe(100);
    });
});

describe('supportsSendCalls (EIP-5792 wallet_getCapabilities)', () => {
    it('returns true for atomic.status "supported"', async () => {
        const provider = { request: async () => ({ '0x2105': { atomic: { status: 'supported' } } }) };
        await expect(supportsSendCalls(provider, '0x2105', '0xacct')).resolves.toBe(true);
    });

    it('returns true for atomic.status "ready"', async () => {
        const provider = { request: async () => ({ '0x2105': { atomic: { status: 'ready' } } }) };
        await expect(supportsSendCalls(provider, '0x2105', '0xacct')).resolves.toBe(true);
    });

    it('returns false for atomic.status "unsupported"', async () => {
        const provider = { request: async () => ({ '0x2105': { atomic: { status: 'unsupported' } } }) };
        await expect(supportsSendCalls(provider, '0x2105', '0xacct')).resolves.toBe(false);
    });

    it('returns false when no atomic capability is present', async () => {
        const provider = { request: async () => ({ '0x2105': { paymasterService: { status: 'ready' } } }) };
        await expect(supportsSendCalls(provider, '0x2105', '0xacct')).resolves.toBe(false);
    });

    it('accepts the 0x0 all-chains capability', async () => {
        const provider = { request: async () => ({ '0x0': { atomic: { status: 'supported' } } }) };
        await expect(supportsSendCalls(provider, '0xa86a', '0xacct')).resolves.toBe(true);
    });

    it('lets an explicit per-chain "unsupported" win over 0x0', async () => {
        const provider = {
            request: async () => ({
                '0x0': { atomic: { status: 'supported' } },
                '0xa86a': { atomic: { status: 'unsupported' } }
            })
        };
        await expect(supportsSendCalls(provider, '0xa86a', '0xacct')).resolves.toBe(false);
    });

    it('tolerates the legacy draft shape (sendCalls: true)', async () => {
        const provider = { request: async () => ({ '0x2105': { sendCalls: true } }) };
        await expect(supportsSendCalls(provider, '0x2105', '0xacct')).resolves.toBe(true);
    });

    it('passes [account, [chainIdHex]] as params per spec', async () => {
        const request = vi.fn(async () => ({ '0x2105': { atomic: { status: 'supported' } } }));
        await supportsSendCalls({ request }, '0x2105', '0xacct');
        expect(request).toHaveBeenCalledWith({
            method: 'wallet_getCapabilities',
            params: ['0xacct', ['0x2105']]
        });
    });

    it('never inherits another chain\'s capabilities (no 0x2105 fallback)', async () => {
        const provider = { request: async () => ({ '0x2105': { atomic: { status: 'supported' } } }) };
        await expect(supportsSendCalls(provider, '0x1', '0xacct')).resolves.toBe(false);
    });

    it('returns false when the request throws (older wallets)', async () => {
        const provider = { request: async () => { throw new Error('method not found'); } };
        await expect(supportsSendCalls(provider, '0x2105', '0xacct')).resolves.toBe(false);
    });

    it('returns false for a non-requesting provider or missing args', async () => {
        await expect(supportsSendCalls(null, '0x2105', '0xacct')).resolves.toBe(false);
        await expect(supportsSendCalls({ request: async () => ({}) }, '0x2105', null)).resolves.toBe(false);
        await expect(supportsSendCalls({ request: async () => ({}) }, '0x2105', '')).resolves.toBe(false);
    });
});

describe('toSendCall', () => {
    it('encodes value as hex and omits empty data', () => {
        expect(toSendCall({ to: '0xabc', value: 1000n })).toEqual({
            to: '0xabc',
            value: '0x3e8'
        });
    });

    it('passes data through and defaults value to 0x0', () => {
        expect(toSendCall({ to: '0xabc', data: '0x00' })).toEqual({
            to: '0xabc',
            value: '0x0',
            data: '0x00'
        });
    });

    it('encodes an explicit 0n (non-payable ERC20 disperse) as 0x0', () => {
        expect(toSendCall({ to: '0xabc', value: 0n, data: '0xdeadbeef' })).toEqual({
            to: '0xabc',
            value: '0x0',
            data: '0xdeadbeef'
        });
    });
});

describe('sendCalls', () => {
    it('submits a well-formed wallet_sendCalls request with an app-provided id', async () => {
        const request = vi.fn(async () => ({ id: '0xbeef' }));
        const id = await sendCalls({
            provider: { request },
            from: '0xacct',
            chainIdHex: '0x2105',
            calls: [{ to: '0xabc', value: 1n }]
        });
        expect(id).toBe('0xbeef');
        const params = request.mock.calls[0][0].params[0];
        expect(params.version).toBe('2.0.0');
        expect(params.id).toMatch(/^0x[0-9a-f]{64}$/);
        expect(params.from).toBe('0xacct');
        expect(params.chainId).toBe('0x2105');
        expect(params.atomicRequired).toBe(true);
        expect(params.calls[0]).toMatchObject({ to: '0xabc', value: '0x1' });
    });

    it('honours a caller-provided id (the wallet must echo it)', async () => {
        const request = vi.fn(async (args) => ({ id: args.params[0].id }));
        const id = await sendCalls({
            provider: { request },
            from: '0xacct',
            chainIdHex: '0x2105',
            calls: [],
            id: '0xdeadbeef'
        });
        expect(id).toBe('0xdeadbeef');
    });

    it('tolerates legacy result.batchId and a bare string id', async () => {
        expect(await sendCalls({
            provider: { request: async () => ({ batchId: '0xlegacy' }) },
            from: '0xa', chainIdHex: '0x1', calls: []
        })).toBe('0xlegacy');
        expect(await sendCalls({
            provider: { request: async () => '0xbare' },
            from: '0xa', chainIdHex: '0x1', calls: []
        })).toBe('0xbare');
    });

    it('returns null when the response carries no id', async () => {
        expect(await sendCalls({
            provider: { request: async () => ({}) },
            from: '0xa', chainIdHex: '0x1', calls: []
        })).toBeNull();
    });
});

describe('normalizeCallStatus (EIP-5792 status codes)', () => {
    it('maps the numeric spec codes', () => {
        expect(normalizeCallStatus(100)).toBe('PENDING');
        expect(normalizeCallStatus(200)).toBe('CONFIRMED');
        expect(normalizeCallStatus(400)).toBe('CANCELLED'); // offchain failure
        expect(normalizeCallStatus(500)).toBe('FAILED');    // full onchain revert
        expect(normalizeCallStatus(600)).toBe('FAILED');    // partial onchain failure
    });

    it('maps numeric-looking strings', () => {
        expect(normalizeCallStatus('200')).toBe('CONFIRMED');
        expect(normalizeCallStatus('500')).toBe('FAILED');
        expect(normalizeCallStatus('100')).toBe('PENDING');
    });

    it('tolerates legacy string statuses', () => {
        expect(normalizeCallStatus('CONFIRMED')).toBe('CONFIRMED');
        expect(normalizeCallStatus('Cancelled')).toBe('CANCELLED');
        expect(normalizeCallStatus('REJECTED')).toBe('CANCELLED');
        expect(normalizeCallStatus('FAILED')).toBe('FAILED');
    });

    it('defaults unknown values to PENDING (keep polling)', () => {
        expect(normalizeCallStatus(undefined)).toBe('PENDING');
        expect(normalizeCallStatus(null)).toBe('PENDING');
        expect(normalizeCallStatus('weird')).toBe('PENDING');
    });
});

describe('waitForSendCalls', () => {
    it('returns CONFIRMED for status 200 with tx hashes', async () => {
        const provider = {
            request: async () => ({
                status: 200,
                receipts: [{ transactionHash: '0xhash1' }]
            })
        };
        const r = await waitForSendCalls({ provider, batchId: '0x1' });
        expect(r.status).toBe('CONFIRMED');
        expect(r.txHashes).toEqual(['0xhash1']);
    });

    it('maps 500 to FAILED and 400 to CANCELLED', async () => {
        const failed = await waitForSendCalls({
            provider: { request: async () => ({ status: 500 }) }, batchId: '0x1'
        });
        expect(failed.status).toBe('FAILED');
        const cancelled = await waitForSendCalls({
            provider: { request: async () => ({ status: 400 }) }, batchId: '0x1'
        });
        expect(cancelled.status).toBe('CANCELLED');
    });

    it('polls until the status settles', async () => {
        vi.useFakeTimers();
        const seq = [{ status: 100 }, { status: 200, receipts: [] }];
        const provider = { request: async () => seq.shift() };
        const promise = waitForSendCalls({ provider, batchId: '0x1', intervalMs: 1000, timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(1000);
        const r = await promise;
        expect(r.status).toBe('CONFIRMED');
        vi.useRealTimers();
    });

    it('returns UNKNOWN when the wallet has no such bundle (5730)', async () => {
        const provider = {
            request: async () => {
                throw Object.assign(new Error('Unknown bundle id'), { code: 5730 });
            }
        };
        const r = await waitForSendCalls({ provider, batchId: '0x1' });
        expect(r.status).toBe('UNKNOWN');
    });

    it('returns PENDING on timeout — caller must NOT resubmit', async () => {
        vi.useFakeTimers();
        const provider = { request: async () => ({ status: 100 }) };
        const promise = waitForSendCalls({ provider, batchId: '0x1', intervalMs: 1000, timeoutMs: 1000 });
        await vi.advanceTimersByTimeAsync(3000);
        const r = await promise;
        expect(r.status).toBe('PENDING');
        vi.useRealTimers();
    });
});

describe('classifySendCallsError (no-double-send invariant)', () => {
    it('never falls back once the batch was submitted', () => {
        expect(classifySendCallsError(new Error('boom'), { submitted: true })).toBe('abort');
        expect(classifySendCallsError(Object.assign(new Error('rejected'), { code: 4001 }), { submitted: true })).toBe('abort');
        expect(classifySendCallsError(Object.assign(new Error('nf'), { code: -32601 }), { submitted: true })).toBe('abort');
        expect(classifySendCallsError(null, { submitted: true })).toBe('abort');
    });

    it('surfaces user/authorization rejections', () => {
        expect(classifySendCallsError({ code: 4001 })).toBe('reject');
        expect(classifySendCallsError({ code: 'ACTION_REJECTED' })).toBe('reject');
        expect(classifySendCallsError({ code: 4100 })).toBe('reject');
        expect(classifySendCallsError({ code: 5750 })).toBe('reject');
    });

    it('allows fallback only for provably pre-submission errors', () => {
        expect(classifySendCallsError({ code: -32601 })).toBe('fallback');
        expect(classifySendCallsError({ code: -32003 })).toBe('fallback');
        expect(classifySendCallsError({ code: -32602 })).toBe('fallback');
        expect(classifySendCallsError({ code: 5700 })).toBe('fallback');
        expect(classifySendCallsError({ code: 5710 })).toBe('fallback');
        expect(classifySendCallsError({ code: 5740 })).toBe('fallback');
        expect(classifySendCallsError({ code: 5760 })).toBe('fallback');
        expect(classifySendCallsError({ message: 'method wallet_sendCalls not found' })).toBe('fallback');
    });

    it('aborts on anything uncertain (duplicate id, unknown bundle, network)', () => {
        expect(classifySendCallsError({ code: 5720 })).toBe('abort');
        expect(classifySendCallsError({ code: 5730 })).toBe('abort');
        expect(classifySendCallsError({ code: -32000 })).toBe('abort');
        expect(classifySendCallsError(new Error('connection lost'))).toBe('abort');
        expect(classifySendCallsError(undefined)).toBe('abort');
    });
});
