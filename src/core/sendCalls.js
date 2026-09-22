// @ts-check
// EIP-5792 (final spec) wallet_sendCalls / wallet_getCapabilities support.
//
// Base Account (and other ERC-4337 smart wallets) expose wallet_sendCalls,
// which lets the wallet bundle a batch of calls atomically and (where a
// paymaster is available) sponsor gas. We use it when the connected provider
// advertises the capability; otherwise we fall back to the plain ethers
// signer path.
//
// SAFETY INVARIANT (money path): once wallet_sendCalls RESOLVES, the batch is
// with the wallet. It must NEVER be submitted again through any other path —
// not even when status polling times out. classifySendCallsError() encodes
// the narrow set of errors that are provably pre-submission (the only cases
// where a fallback to the standard signer path is safe). Unit-tested.
//
// Spec reference: https://eips.ethereum.org/EIPS/eip-5792

/**
 * Generate an app-provided batch id (spec: `id`, unique per sender per app;
 * the wallet MUST respect it and return it in the response).
 * @returns {string} "0x" + 64 hex chars
 */
export function generateBatchId() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {{ status?: string }} [atomic]
 * @returns {boolean}
 */
function atomicUsable(atomic) {
    // atomic.status: 'supported' (atomic+contiguous), 'ready' (can upgrade
    // pending user approval), 'unsupported' (no guarantees).
    return atomic?.status === 'supported' || atomic?.status === 'ready';
}

/**
 * Ask the provider whether the wallet supports EIP-5792 batching for this
 * account + chain, via wallet_getCapabilities.
 *
 * Spec params: [accountAddress, [chainIds?]] — the account MUST be passed.
 * Spec result: { [chainIdHex]: { atomic: { status }, ... }, '0x0': {...} }
 * where '0x0' holds capabilities that apply to all chains.
 *
 * We accept the spec `atomic.status === 'supported' | 'ready'` shape and, for
 * older wallet builds, the legacy draft booleans (sendCalls / atomicBatch).
 * No hardcoded chain fallback: a capability reported for another chain must
 * never be inherited by this one.
 *
 * @param {{ request: (args: any) => Promise<any> }|null} provider
 * @param {string} chainIdHex - e.g. "0x2105" (Base)
 * @param {string} account - the connected wallet address
 * @returns {Promise<boolean>}
 */
export async function supportsSendCalls(provider, chainIdHex, account) {
    if (!provider || typeof provider.request !== 'function') return false;
    if (!chainIdHex || !account) return false;
    try {
        const caps = await provider.request({
            method: 'wallet_getCapabilities',
            params: [account, [chainIdHex]]
        });
        const chainCaps = caps?.[chainIdHex] || {};
        const globalCaps = caps?.['0x0'] || {};
        // Per-chain explicit statements win over the 0x0 all-chains default.
        const atomic = chainCaps.atomic ?? globalCaps.atomic;
        if (atomic && typeof atomic === 'object') return atomicUsable(atomic);
        // Legacy draft shape (tolerated, not the final spec).
        return !!(
            chainCaps.sendCalls || globalCaps.sendCalls ||
            chainCaps.atomicBatch || globalCaps.atomicBatch
        );
    } catch (e) {
        // Older wallets throw for unknown methods; 4100 (unauthorized) means
        // we cannot verify either. Assume not supported → standard path.
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
 *
 * A fresh app-provided `id` is generated (or reused when supplied), so the
 * batch is trackable even if the wallet's response shape is unusual.
 *
 * @param {{
 *   provider: { request: (args: any) => Promise<any> },
 *   from: string,
 *   chainIdHex: string,
 *   calls: Array<{ to: string, value?: bigint, data?: string }>,
 *   atomicRequired?: boolean,
 *   id?: string
 * }} opts
 * @returns {Promise<string|null>} the batch id, or null if the response
 *   carried none (treat the batch as submitted-but-untrackable; never retry).
 */
export async function sendCalls({ provider, from, chainIdHex, calls, atomicRequired = true, id }) {
    const batchId = id || generateBatchId();
    const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [{
            version: '2.0.0',
            id: batchId,
            from,
            chainId: chainIdHex,
            atomicRequired,
            calls: calls.map(toSendCall)
        }]
    });
    // Spec: result.id. Tolerate legacy result.batchId and a bare string.
    if (typeof result === 'string') return result;
    return result?.id ?? result?.batchId ?? null;
}

/**
 * Normalize a wallet_getCallsStatus `status` value.
 *
 * Spec status codes: 1xx pending (100), 2xx confirmed (200), 4xx offchain
 * failure (400), 5xx chain rules failure — full revert (500), 6xx chain
 * rules failure — partial revert (600). Legacy string statuses from older
 * drafts are tolerated. Unknown values default to PENDING (keep polling).
 *
 * @param {number|string|undefined|null} raw
 * @returns {'PENDING'|'CONFIRMED'|'CANCELLED'|'FAILED'}
 */
export function normalizeCallStatus(raw) {
    if (raw != null) {
        const s = String(raw);
        if (/^\d+$/.test(s)) {
            const n = Number(s);
            if (n >= 200 && n < 300) return 'CONFIRMED';
            if (n >= 400 && n < 500) return 'CANCELLED';
            if (n >= 500 && n < 700) return 'FAILED';
            return 'PENDING'; // 1xx and unknown future codes
        }
        const up = s.toUpperCase();
        if (up === 'CONFIRMED') return 'CONFIRMED';
        if (up === 'CANCELLED' || up === 'REJECTED') return 'CANCELLED';
        if (up === 'FAILED') return 'FAILED';
    }
    return 'PENDING';
}

/**
 * Poll wallet_getCallsStatus for a batch until it settles or times out.
 *
 * @param {{
 *   provider: { request: (args: any) => Promise<any> },
 *   batchId: string,
 *   intervalMs?: number,
 *   timeoutMs?: number
 * }} opts
 * @returns {Promise<{ status: 'PENDING'|'CONFIRMED'|'CANCELLED'|'FAILED'|'UNKNOWN', txHashes: string[] }>}
 *   PENDING on timeout — the caller MUST NOT resubmit. UNKNOWN when the
 *   wallet reports the bundle as unsubmitted (5730) or stops tracking it.
 */
export async function waitForSendCalls({ provider, batchId, intervalMs = 2000, timeoutMs = 120000 }) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        let status;
        try {
            status = await provider.request({
                method: 'wallet_getCallsStatus',
                params: [batchId]
            });
        } catch (e) {
            // 5730: the wallet never has this bundle id — it cannot track it.
            if (e?.code === 5730) return { status: 'UNKNOWN', txHashes: [] };
            // Transient provider hiccups: keep polling until the deadline.
            if (Date.now() > deadline) return { status: 'PENDING', txHashes: [] };
            await new Promise(r => setTimeout(r, intervalMs));
            continue;
        }
        const normalized = normalizeCallStatus(status?.status);
        if (normalized !== 'PENDING') {
            return {
                status: normalized,
                txHashes: (Array.isArray(status.receipts) ? status.receipts : [])
                    .map(r => r?.transactionHash)
                    .filter(Boolean)
            };
        }
        if (Date.now() > deadline) return { status: 'PENDING', txHashes: [] };
        await new Promise(r => setTimeout(r, intervalMs));
    }
}

/**
 * Decide how to react when the EIP-5792 attempt throws, given whether the
 * batch was already handed to the wallet.
 *
 *  - 'reject'   the user (or wallet authorization) said no — surface it,
 *               never retry.
 *  - 'fallback' the wallet does not implement EIP-5792 (or rejected our
 *               params before submitting). Nothing was submitted, so the
 *               standard signer path is safe. This is the only case the
 *               spec's Backwards-Compatibility section sanctions.
 *  - 'abort'    uncertain, or anything after submission. NEVER auto-resend:
 *               the batch may already be in flight, and a second submission
 *               pays the same recipients twice.
 *
 * @param {{ code?: number|string, message?: string }|Error|null|undefined} error
 * @param {{ submitted?: boolean }} [opts]
 * @returns {'reject'|'fallback'|'abort'}
 */
export function classifySendCallsError(error, { submitted = false } = {}) {
    if (submitted) return 'abort';
    const code = error?.code;
    const message = String(error?.message || '');
    // User/authorization rejections (EIP-1193 + EIP-5792).
    if (code === 'ACTION_REJECTED' || code === 4001 || code === 4100 || code === 5750) {
        return 'reject';
    }
    // Provably pre-submission: the wallet never sent anything on chain.
    //  -32601 method not found, -32003 unimplemented, -32602 invalid params,
    //  5700 unsupported (non-optional) capability, 5710 unsupported chain,
    //  5740 bundle too large, 5760 atomicity not supported.
    if (
        code === -32601 || code === -32003 || code === -32602 ||
        code === 5700 || code === 5710 || code === 5740 || code === 5760 ||
        /method .*not (found|supported)/i.test(message) ||
        /does not support/i.test(message)
    ) {
        return 'fallback';
    }
    // Everything else — including 5720 (duplicate id), 5730 (unknown bundle),
    // network-level errors, and unknown codes — is treated as uncertain.
    return 'abort';
}
