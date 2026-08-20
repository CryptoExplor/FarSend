import { describe, it, expect } from 'vitest';
import { Interface } from 'ethers';
import { decodeRevertReason, describeError } from '../src/core/errors.js';

const ABI = [
    'function disperseEther(address[] recipients, uint256[] amounts) payable',
    'error LengthMismatch(uint256 a, uint256 b)'
];

const LENGTH_MISMATCH_SELECTOR = new Interface(ABI).getError('LengthMismatch').selector;

// Properly encode a standard Error("reason") revert payload.
const revertReasonData = (reason) =>
    new Interface(['error Error(string)']).encodeErrorResult('Error', [reason]);

describe('decodeRevertReason', () => {
    it('decodes a standard Error("reason") revert string', () => {
        const data = revertReasonData('Length mismatch');
        expect(decodeRevertReason({ data }, ABI)).toContain('Length mismatch');
    });

    it('decodes a custom error object from the ABI', () => {
        // LengthMismatch(uint256,uint256) selector + args 1 and 2
        const data = LENGTH_MISMATCH_SELECTOR +
            '0000000000000000000000000000000000000000000000000000000000000001' +
            '0000000000000000000000000000000000000000000000000000000000000002';
        const out = decodeRevertReason({ data }, ABI);
        expect(out).toMatch(/LengthMismatch\(1, 2\)/);
    });

    it('checks nested error.error.data', () => {
        const data = revertReasonData('Length mismatch');
        expect(decodeRevertReason({ error: { data } }, ABI)).toContain('Length mismatch');
    });

    it('returns null when nothing decodes', () => {
        expect(decodeRevertReason({}, ABI)).toBeNull();
        expect(decodeRevertReason({ data: '0x00' }, ABI)).toBeNull();
    });
});

describe('describeError', () => {
    it('handles user rejection (ACTION_REJECTED)', () => {
        expect(describeError({ code: 'ACTION_REJECTED' }, { action: 'approval' })).toBe('Approval rejected by user.');
    });

    it('handles numeric rejection (4001)', () => {
        expect(describeError({ code: 4001 }, { action: 'transaction' })).toBe('Transaction rejected by user.');
    });

    it('handles network errors', () => {
        const msg = describeError({ code: 'NETWORK_ERROR' });
        expect(msg).toMatch(/Network request failed/);
    });

    it('prefers a surfaced revert reason', () => {
        expect(describeError({ reason: 'Token transfer failed' })).toBe('Token transfer failed');
    });

    it('decodes revert data via the ABI', () => {
        const data = revertReasonData('Length mismatch');
        expect(describeError({ data }, { abi: ABI })).toContain('Length mismatch');
    });

    it('falls back to error.message then the fallback string', () => {
        expect(describeError(new Error('boom'))).toBe('boom');
        expect(describeError(undefined, { fallback: 'Unknown' })).toBe('Unknown');
        expect(describeError(null, { fallback: 'Unknown' })).toBe('Unknown');
    });
});

