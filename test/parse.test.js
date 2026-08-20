import { describe, it, expect } from 'vitest';
import { parseRecipients, validateRecipients, splitLine } from '../src/core/parse.js';

const CHECKSUMMED = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

describe('splitLine', () => {
    it('splits comma and/or whitespace separated lines', () => {
        expect(splitLine('0xAb, 1.5')).toEqual(['0xAb', '1.5']);
        expect(splitLine('0xAb  1.5')).toEqual(['0xAb', '1.5']);
        expect(splitLine('0xAb,1.5')).toEqual(['0xAb', '1.5']);
    });
});

describe('parseRecipients (text)', () => {
    it('parses basic address,amount lines', () => {
        const r = parseRecipients('0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B, 1.5\n0x5B38Da6a701c568545dCfcB03FcB875f56beddC4 10.75');
        expect(r.ok).toBe(true);
        expect(r.entries).toHaveLength(2);
        expect(r.errorCount).toBe(0);
        expect(r.entries[0].amount).toBe('1.5');
    });

    it('skips a CSV header row', () => {
        const r = parseRecipients('Address,Amount\n0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B,1.5');
        expect(r.entries).toHaveLength(1);
        expect(r.entries[0].address).toBe('0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B');
    });

    it('counts malformed lines as errors', () => {
        const r = parseRecipients('0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B, 1.5\ngarbage\n0x5B38Da6a701c568545dCfcB03FcB875f56beddC4, -1');
        expect(r.entries).toHaveLength(1);
        expect(r.errorCount).toBe(2);
    });

    it('ignores empty lines', () => {
        const r = parseRecipients('\n\n0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B, 1.5\n\n');
        expect(r.entries).toHaveLength(1);
        expect(r.errorCount).toBe(0);
    });
});

describe('parseRecipients (json)', () => {
    it('parses a JSON array', () => {
        const r = parseRecipients(JSON.stringify([{ address: CHECKSUMMED, amount: 1.5 }]), 'json');
        expect(r.ok).toBe(true);
        expect(r.entries).toHaveLength(1);
        expect(r.entries[0].amount).toBe('1.5');
    });

    it('rejects non-array JSON with ok=false', () => {
        const r = parseRecipients('{"a":1}', 'json');
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/Invalid JSON format/);
    });

    it('filters invalid entries without counting errors (parity with old behavior)', () => {
        const r = parseRecipients(JSON.stringify([{ address: CHECKSUMMED, amount: 1.5 }, { address: 'x', amount: -2 }]), 'json');
        expect(r.ok).toBe(true);
        expect(r.entries).toHaveLength(1);
        expect(r.errorCount).toBe(0);
    });
});

describe('validateRecipients', () => {
    it('checksums valid addresses', () => {
        const { recipients, errorCount } = validateRecipients([{ address: CHECKSUMMED, amount: '1.5' }], 18);
        expect(errorCount).toBe(0);
        expect(recipients[0].address).toBe(CHECKSUMMED);
    });

    it('rejects addresses with too many decimals for the token', () => {
        const { recipients, errorCount } = validateRecipients([{ address: CHECKSUMMED, amount: '0.0000001' }], 6);
        expect(recipients).toHaveLength(0);
        expect(errorCount).toBe(1);
    });

    it('accepts amounts within token decimals', () => {
        const { recipients, errorCount } = validateRecipients([{ address: CHECKSUMMED, amount: '0.000001' }], 6);
        expect(recipients).toHaveLength(1);
        expect(errorCount).toBe(0);
    });

    it('rejects non-address strings', () => {
        const { recipients, errorCount } = validateRecipients([{ address: 'not-an-address', amount: '1' }], 18);
        expect(recipients).toHaveLength(0);
        expect(errorCount).toBe(1);
    });
});
