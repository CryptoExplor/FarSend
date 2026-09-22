// @ts-check
// Pure distribution math. No DOM, no wallet/state dependencies.
// Unit-tested in /test/distribute.test.js.

/**
 * Extract plausible `0x...` addresses from a list of raw textarea lines.
 * Each line's first whitespace/comma-delimited token is checked.
 */
export function extractAddresses(lines) {
    const addresses = [];
    lines.forEach(line => {
        const firstPart = line.trim().split(/[\s,]+/)[0];
        if (firstPart && firstPart.startsWith('0x') && firstPart.length >= 40) {
            addresses.push(firstPart);
        }
    });
    return addresses;
}

/**
 * Rewrite a list of lines so every line that starts with an address gets the
 * given fixed `amount`. Non-address lines are dropped.
 *
 * @param {string[]} lines
 * @param {string|number} amount
 * @returns {{ lines: string[], addressesFound: number }}
 */
export function applyFixedAmount(lines, amount) {
    let addressesFound = 0;
    const updated = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '';

        const parts = trimmed.split(/[\s,]+/).filter(p => p.trim());
        if (parts.length === 0) return '';

        const firstPart = parts[0];
        if (firstPart.startsWith('0x') && firstPart.length >= 40) {
            addressesFound++;
            return `${firstPart}, ${amount}`;
        }
        return trimmed;
    }).filter(line => line !== '');

    return { lines: updated, addressesFound };
}

/**
 * Generate a random distribution of a total budget across addresses such that
 * each address receives at least `minVal` and at most `maxVal`, and the sum
 * does not exceed `totalBudget`.
 *
 * @param {string[]} addresses
 * @param {{ totalBudget: number, minVal: number, maxVal: number, decimals?: number }} opts
 * @returns {{ lines: string[], runningTotal: number }}
 */
export function generateRandomDistribution(addresses, { totalBudget, minVal, maxVal, decimals = 18 }) {
    let runningTotal = 0;
    const updatedLines = [];

    for (let i = 0; i < addresses.length; i++) {
        const remainingWallets = addresses.length - i;
        const remainingBudget = totalBudget - runningTotal;

        // Safe range so we can still give `min` to the remaining wallets.
        const safeMax = Math.min(maxVal, remainingBudget - ((remainingWallets - 1) * minVal));
        const safeMin = minVal;

        let amt;
        if (safeMax <= safeMin) {
            amt = safeMin;
        } else {
            amt = Math.random() * (safeMax - safeMin) + safeMin;
        }

        // Round to sensible decimals to avoid float noise.
        amt = Math.floor(amt * Math.pow(10, 6)) / Math.pow(10, 6);

        // Final safety check on the last wallet.
        if (runningTotal + amt > totalBudget && i === addresses.length - 1) {
            amt = Math.max(0, totalBudget - runningTotal);
        }

        updatedLines.push(`${addresses[i]}, ${amt}`);
        runningTotal += amt;
    }

    return { lines: updatedLines, runningTotal };
}
