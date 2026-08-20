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
 */
export function burnTotal(recipients, burnAddresses = DEFAULT_BURN_ADDRESSES) {
    return findBurnRecipients(recipients, burnAddresses)
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);
}
