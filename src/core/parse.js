// @ts-check
// Pure recipient-input parsing. No DOM, no wallet/state dependencies.
// These functions are deterministic and unit-tested in /test/parse.test.js.
import { ethers } from 'ethers';

/**
 * Split a single text line into [address, amount...] parts.
 * Handles comma and/or whitespace separation.
 */
export function splitLine(line) {
    return line.trim().split(/[\s,]+/).filter(p => p.trim());
}

/**
 * Parse raw text/CSV input into a list of unchecked `{ address, amount }` entries.
 * Only lines that already contain a plausible address + positive numeric amount
 * are kept here; address checksumming and decimal validation happen in
 * `validateRecipients`.
 *
 * @param {string} data
 * @returns {{ ok: boolean, entries: Array<{address:string, amount:string}>, errorCount: number, error?: string }}
 */
export function parseRecipients(data, type = 'text') {
    if (type === 'json') {
        try {
            const parsed = JSON.parse(data);
            if (!Array.isArray(parsed)) throw new Error('JSON is not an array');
            const entries = parsed
                .map(item => ({ address: item.address, amount: item.amount.toString().trim() }))
                .filter(item =>
                    item.address &&
                    typeof item.address === 'string' &&
                    !isNaN(parseFloat(item.amount)) &&
                    parseFloat(item.amount) > 0
                );
            return { ok: true, entries, errorCount: 0 };
        } catch (e) {
            return {
                ok: false,
                entries: [],
                errorCount: 0,
                error: 'Invalid JSON format. Expected array of {"address": "0x...", "amount": 1.23}.'
            };
        }
    }
    return parseText(data);
}

/**
 * Parse line-based (text/CSV) input.
 */
function parseText(data) {
    const lines = data.trim().split('\n');
    const hasHeader =
        lines.length > 0 &&
        lines[0].toLowerCase().includes('address') &&
        lines[0].toLowerCase().includes('amount');
    const startLine = hasHeader ? 1 : 0;

    const entries = [];
    let errorCount = 0;

    for (let i = startLine; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') continue;

        const parts = splitLine(line);
        if (parts.length < 2) {
            errorCount++;
            continue;
        }

        const address = parts[0].trim();
        const amountStr = parts.slice(1).join(' ').trim().replace(/,/g, '');
        const amountNum = parseFloat(amountStr);

        if (address && !isNaN(amountNum) && amountNum > 0) {
            entries.push({ address, amount: amountStr });
        } else {
            errorCount++;
        }
    }

    return { ok: true, entries, errorCount };
}

/**
 * Validate & checksum a list of parsed entries against a token's decimals.
 * Returns normalized recipients (address checksummed via ethers.getAddress)
 * and a count of lines that were rejected.
 *
 * @param {Array<{address:string, amount:string}>} entries
 * @param {number} decimals
 * @returns {{ recipients: Array<{address:string, amount:string}>, errorCount: number }}
 */
export function validateRecipients(entries, decimals) {
    const recipients = [];
    let errorCount = 0;

    for (const item of entries) {
        try {
            const validAddress = ethers.getAddress(item.address);
            // Validate amount doesn't exceed token decimals.
            const decimalPart = item.amount.split('.')[1];
            if (decimalPart && decimalPart.length > decimals) {
                throw new Error(`Amount ${item.amount} exceeds ${decimals} decimal places`);
            }
            recipients.push({ address: validAddress, amount: item.amount });
        } catch (e) {
            errorCount++;
        }
    }

    return { recipients, errorCount };
}
