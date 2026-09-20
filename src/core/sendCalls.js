// @ts-check
// EIP-5792 wallet_sendCalls / wallet_getCapabilities support.
//
// Base Account (and other ERC-4337 smart wallets) expose wallet_sendCalls,
// which lets the wallet bundle a batch of calls (and often sponsor gas). We use
// it when the connected provider advertises the capability; otherwise we fall
// back to the plain ethers signer path. Pure-ish and unit-tested.

/**
 * Ask the provider whether it supports wallet_sendCalls (EIP-5792) via
 * wallet_getCapabilities.
 * @param {{ request: (args: any) => Promise<any> }} provider
 * @param {string} chainIdHex - e.g. "0x2105" (Base)
 * @returns {Promise<boolean>}
 */
export async function supportsSendCalls(provider, chainIdHex) {
    if (!provider || typeof provider.request !== 'function') return false;
    try {
        const caps = await provider.request({ method: 'wallet_getCapabilities' });
        const chainCaps = caps?.[chainIdHex] || caps?.['0x2105'] || {};
        // Capability can be reported as "atomicBatch" and/or "sendCalls".
        return !!(chainCaps.sendCalls || chainCaps.atomicBatch);
    } catch (e) {
        // Older wallets throw for unknown methods — assume not supported.
        return false;
    }
}

/**
 * Build the call object shape required by wallet_sendCalls.
 * @param {{ to: string, value?: bigint, data?: string }} c
 * @returns {{ to: string, value: string, data?: string }}
 */
export function toSendCall(c) {
    return {
        to: c.to,
        value: c.value != null ? `0x${c.value.toString(16)}` : '0x0',
        ...(c.data ? { data: c.data } : {})
    };
}

/**
 * Submit a batch via wallet_sendCalls.
 * @param {{
 *   provider: { request: (args: any) => Promise<any> },
 *   from: string,
 *   chainIdHex: string,
 *   calls: Array<{ to: string, value?: bigint, data?: string }>,
 *   atomicRequired?: boolean
 * }} opts
 * @returns {Promise<string>} batchId
 */
export async function sendCalls({ provider, from, chainIdHex, calls, atomicRequired = true }) {
    const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [{
            version: '2.0.0',
            from,
            chainId: chainIdHex,
            atomicRequired,
            calls: calls.map(toSendCall)
        }]
    });
    return result.batchId;
}

/**
 * Poll wallet_sendCallsStatus for a batch until it settles.
 * @param {{
 *   provider: { request: (args: any) => Promise<any> },
 *   batchId: string,
 *   intervalMs?: number,
 *   timeoutMs?: number
 * }} opts
 * @returns {Promise<{ status: string, txHashes: string[] }>}
 */
export async function waitForSendCalls({ provider, batchId, intervalMs = 2000, timeoutMs = 120000 }) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const status = await provider.request({
            method: 'wallet_getCallsStatus',
            params: [batchId]
        });
        if (status?.status === 'CONFIRMED' || status?.status === 'CANCELLED' || status?.status === 'FAILED') {
            return {
                status: status.status,
                txHashes: status.receipts?.map(r => r.transactionHash).filter(Boolean) || []
            };
        }
        if (Date.now() > deadline) {
            return { status: 'PENDING', txHashes: [] };
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
}
