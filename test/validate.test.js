import { describe, it, expect } from 'vitest';
import {
    DEFAULT_BURN_ADDRESSES,
    isBurnAddress,
    findBurnRecipients,
    burnTotal
} from '../src/core/validate.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const NORMAL = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

describe('isBurnAddress', () => {
    it('detects the null/burn address', () => {
        expect(isBurnAddress(ZERO)).toBe(true);
    });

    it('detects the dead address case-insensitively', () => {
        expect(isBurnAddress(DEAD)).toBe(true);
        expect(isBurnAddress(DEAD.toLowerCase())).toBe(true);
    });

    it('returns false for a normal address and junk', () => {
        expect(isBurnAddress(NORMAL)).toBe(false);
        expect(isBurnAddress('')).toBe(false);
        expect(isBurnAddress(null)).toBe(false);
        expect(isBurnAddress(undefined)).toBe(false);
    });
});

describe('findBurnRecipients', () => {
    const recipients = [
        { address: NORMAL, amount: '1' },
        { address: ZERO, amount: '0.5' },
        { address: DEAD, amount: '2' }
    ];

    it('finds all burn recipients', () => {
        const found = findBurnRecipients(recipients);
        expect(found).toHaveLength(2);
    });

    it('returns empty when none are burn addresses', () => {
        expect(findBurnRecipients([{ address: NORMAL, amount: '1' }])).toHaveLength(0);
    });

    it('exposes the default list', () => {
        expect(DEFAULT_BURN_ADDRESSES).toContain(ZERO);
        expect(DEFAULT_BURN_ADDRESSES).toContain(DEAD.toLowerCase());
    });
});

describe('burnTotal', () => {
    it('sums the amounts going to burn addresses', () => {
        const recipients = [
            { address: NORMAL, amount: '1' },
            { address: ZERO, amount: '0.5' },
            { address: DEAD, amount: '2' }
        ];
        expect(burnTotal(recipients)).toBeCloseTo(2.5, 5);
    });

    it('returns 0 when no burn addresses', () => {
        expect(burnTotal([{ address: NORMAL, amount: '5' }])).toBe(0);
    });
});
