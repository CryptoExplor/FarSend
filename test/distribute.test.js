import { describe, it, expect, vi } from 'vitest';
import {
    extractAddresses,
    applyFixedAmount,
    generateRandomDistribution
} from '../src/core/distribute.js';

const A = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const B = '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4';
const C = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';

describe('extractAddresses', () => {
    it('extracts 0x addresses from lines', () => {
        const lines = [`${A}, 1.5`, 'garbage line', `${B} 10.75`];
        expect(extractAddresses(lines)).toEqual([A, B]);
    });

    it('returns empty array when no addresses', () => {
        expect(extractAddresses(['hello', 'world'])).toEqual([]);
    });
});

describe('applyFixedAmount', () => {
    it('rewrites address lines with the fixed amount', () => {
        const { lines, addressesFound } = applyFixedAmount([`${A}, 1`, `${B} 2`], '5');
        expect(addressesFound).toBe(2);
        expect(lines).toEqual([`${A}, 5`, `${B}, 5`]);
    });

    it('keeps non-address lines unchanged (parity with original behavior)', () => {
        const { lines, addressesFound } = applyFixedAmount([`${A}, 1`, 'junk'], '5');
        expect(addressesFound).toBe(1);
        expect(lines).toEqual([`${A}, 5`, 'junk']);
    });

    it('reports zero found when no addresses present, leaving lines intact', () => {
        const { lines, addressesFound } = applyFixedAmount(['junk'], '5');
        expect(addressesFound).toBe(0);
        expect(lines).toEqual(['junk']);
    });
});

describe('generateRandomDistribution', () => {
    it('respects min per wallet and stays within budget', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const { lines, runningTotal } = generateRandomDistribution([A, B, C], {
            totalBudget: 3,
            minVal: 0.5,
            maxVal: 2,
            decimals: 18
        });
        vi.restoreAllMocks();

        expect(lines).toHaveLength(3);
        for (const line of lines) {
            const amount = parseFloat(line.split(', ')[1]);
            expect(amount).toBeGreaterThanOrEqual(0.5);
            expect(amount).toBeLessThanOrEqual(2);
        }
        expect(runningTotal).toBeLessThanOrEqual(3);
    });

    it('uses min for every wallet when budget only covers minimums', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const { lines, runningTotal } = generateRandomDistribution([A, B], {
            totalBudget: 2,
            minVal: 1,
            maxVal: 5,
            decimals: 18
        });
        vi.restoreAllMocks();

        expect(lines).toHaveLength(2);
        expect(runningTotal).toBeLessThanOrEqual(2);
        expect(runningTotal).toBeGreaterThanOrEqual(2 - 1e-9);
    });

    it('caps the total exactly at the budget for the last wallet', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const { runningTotal } = generateRandomDistribution([A, B, C], {
            totalBudget: 2,
            minVal: 0.5,
            maxVal: 1,
            decimals: 18
        });
        vi.restoreAllMocks();
        expect(runningTotal).toBeLessThanOrEqual(2);
    });
});
