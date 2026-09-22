// @ts-check
// Pure validation helpers. No DOM, no wallet/state dependencies.
// Unit-tested in /test/validate.test.js.

// Known burn/dead addresses. Sending to these permanently locks funds.
export const DEFAULT_BURN_ADDRESSES = [
    '0x0000000000000000000000000000000000000000', // null / burn address
    '0x000000000000000000000000000000000000dead'  // common dead address
];

/**
 * Whether a checksummed/raw address is a known burn/dead address.
 * Comparison is case-insensitive.
 */
export function isBurnAddress(address, burnAddresses = DEFAULT_BURN_ADDRESSES) {
    if (!address || typeof address !== 'string') return false;
    const key = address.toLowerCase();
    return burnAddresses.some(a => a.toLowerCase() === key);
}

/**
 * Filter a recipient list down to those that target a burn/dead address.
 * Recipients are `{ address, amount }` objects.
 */
export function findBurnRecipients(recipients, burnAddresses = DEFAULT_BURN_ADDRESSES) {
    return recipients.filter(r => isBurnAddress(r.address, burnAddresses));
}

/**
 * Total (display) amount going to burn/dead addresses across a recipient list.
 *
 * Sums the decimal amount strings exactly (BigInt on a common scale) so the
 * burn warning never shows float artifacts like 0.30000000000000004. This is
 * a display value; dispatch amounts are always BigInt via ethers.parseUnits.
 *
 * @param {Array<{address: string, amount: string}>} recipients
 * @param {string[]} [burnAddresses]
 * @returns {number}
 */
export function burnTotal(recipients, burnAddresses = DEFAULT_BURN_ADDRESSES) {
    const amounts = findBurnRecipients(recipients, burnAddresses).map(r => String(r.amount));
    if (amounts.length === 0) return 0;
    const parts = amounts.map(a => {
        const [int, frac = ''] = a.split('.');
        return { int: int || '0', frac };
    });
    const maxFrac = Math.max(...parts.map(p => p.frac.length));
    const scale = 10n ** BigInt(maxFrac);
    let total = 0n;
    for (const p of parts) {
        const fracPadded = (p.frac + '0'.repeat(maxFrac)).slice(0, maxFrac);
        total += BigInt(p.int) * scale + BigInt(fracPadded || '0');
    }
    return Number(total) / Number(scale);
}
