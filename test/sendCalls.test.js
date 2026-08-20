import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    supportsSendCalls,
    toSendCall,
    sendCalls,
    waitForSendCalls
} from '../src/core/sendCalls.js';

afterEach(() => vi.restoreAllMocks());

describe('supportsSendCalls', () => {
    it('returns true when the chain advertises sendCalls', async () => {
        const provider = { request: async () => ({ '0x2105': { sendCalls: true } }) };
        await expect(supportsSendCalls(provider, '0x2105')).resolves.toBe(true);
    });

    it('returns true when atomicBatch is advertised', async () => {
        const provider = { request: async () => ({ '0x2105': { atomicBatch: {} } }) };
        await expect(supportsSendCalls(provider, '0x2105')).resolves.toBe(true);
    });

    it('returns false when capabilities are empty', async () => {
        const provider = { request: async () => ({}) };
        await expect(supportsSendCalls(provider, '0x2105')).resolves.toBe(false);
    });

    it('returns false when the request throws (older wallets)', async () => {
        const provider = { request: async () => { throw new Error('method not found'); } };
        await expect(supportsSendCalls(provider, '0x2105')).resolves.toBe(false);
    });

    it('returns false for a non-requesting provider', async () => {
        await expect(supportsSendCalls(null, '0x2105')).resolves.toBe(false);
    });
});

describe('toSendCall', () => {
    it('encodes value as hex and defaults data', () => {
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
});

describe('sendCalls', () => {
    it('submits a well-formed wallet_sendCalls request', async () => {
        const request = vi.fn(async () => ({ batchId: '0x1' }));
        const id = await sendCalls({
            provider: { request },
            from: '0xacct',
            chainIdHex: '0x2105',
            calls: [{ to: '0xabc', value: 1n }]
        });
        expect(id).toBe('0x1');
        const params = request.mock.calls[0][0].params[0];
        expect(params.version).toBe('2.0.0');
        expect(params.atomicRequired).toBe(true);
        expect(params.calls[0]).toMatchObject({ to: '0xabc', value: '0x1' });
    });
});

describe('waitForSendCalls', () => {
    it('returns confirmed status with tx hashes', async () => {
        const provider = {
            request: async () => ({
                status: 'CONFIRMED',
                receipts: [{ transactionHash: '0xhash1' }]
            })
        };
        const r = await waitForSendCalls({ provider, batchId: '0x1' });
        expect(r.status).toBe('CONFIRMED');
        expect(r.txHashes).toEqual(['0xhash1']);
    });

    it('polls until status settles', async () => {
        vi.useFakeTimers();
        const seq = [{ status: 'PENDING' }, { status: 'CONFIRMED', receipts: [] }];
        const provider = { request: async () => seq.shift() };
        const promise = waitForSendCalls({ provider, batchId: '0x1', intervalMs: 1000, timeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(1000);
        const r = await promise;
        expect(r.status).toBe('CONFIRMED');
        vi.useRealTimers();
    });

    it('returns PENDING on timeout', async () => {
        vi.useFakeTimers();
        const provider = { request: async () => ({ status: 'PENDING' }) };
        const promise = waitForSendCalls({ provider, batchId: '0x1', intervalMs: 1000, timeoutMs: 1000 });
        await vi.advanceTimersByTimeAsync(2000);
        const r = await promise;
        expect(r.status).toBe('PENDING');
        vi.useRealTimers();
    });
});
