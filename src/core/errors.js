// @ts-check
// Standardized error handling. Pure-ish helpers (decode uses ethers.Interface
// which is dependency-injected via `abi`). Unit-tested in /test/errors.test.js.
import { ethers } from 'ethers';

/**
 * Extract a human-readable revert reason from an ethers/JSON-RPC error.
 * Checks top-level `error.data` and nested `error.error.data`. Understands
 * custom contract errors (from `abi`) and standard `Error("reason")` strings.
 *
 * @param {any} error
 * @param {Array} abi
 * @returns {string|null}
 */
export function decodeRevertReason(error, abi) {
    const candidates = [];
    if (error?.data) candidates.push(error.data);
    if (error?.error?.data) candidates.push(error.error.data);

    for (const raw of candidates) {
        try {
            const data = String(raw);
            const hexData = data.startsWith('0x') ? data : '0x' + data;
            const iface = new ethers.Interface(abi || []);

            // Try to parse a custom/error object first.
            const decoded = iface.parseError(hexData);
            if (decoded) {
                return `${decoded.name}(${decoded.args.map(arg => arg.toString()).join(', ')})`;
            }

            // Fall back to decoding a standard Error("reason") revert string.
            if (hexData.startsWith('0x08c379a0')) {
                return ethers.toUtf8String('0x' + hexData.slice(10));
            }
        } catch (e) {
            // Not decodable; try the next candidate.
        }
    }
    return null;
}

/**
 * Build a safe, user-facing message from any thrown value.
 * - User rejections (ACTION_REJECTED / 4001) get a friendly "rejected" message.
 * - RPC network errors get a clear "network" message.
 * - Revert data is decoded via the provided ABI when possible.
 * - Everything else degrades to `error.message` or the fallback string.
 *
 * @param {any} error
 * @param {{ abi?: Array, action?: string, fallback?: string }} [opts]
 * @returns {string}
 */
export function describeError(error, { abi = [], action = 'operation', fallback = 'Unknown error' } = {}) {
    if (!error) return fallback;

    // User rejected the wallet request.
    if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
        return `${action[0].toUpperCase() + action.slice(1)} rejected by user.`;
    }

    // RPC / network level failures.
    if (error.code === 'NETWORK_ERROR' || error.code === 'SERVER_ERROR' || error.code === 'TIMEOUT' || error.code === 500) {
        return `Network request failed. Please check your connection and try again.`;
    }

    // A revert reason already surfaced by ethers.
    if (typeof error.reason === 'string') {
        return error.reason;
    }

    // Try decoding revert data.
    const decoded = decodeRevertReason(error, abi);
    if (decoded) return decoded;

    if (typeof error.message === 'string' && error.message.length > 0) {
        return error.message.substring(0, 200);
    }

    return fallback;
}
