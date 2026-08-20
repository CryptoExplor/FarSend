// @ts-check
// Pure utility: trailing-edge debounce. No DOM/wallet dependencies.
// Unit-tested in /test/debounce.test.js.

/**
 * Return a wrapper that only invokes `fn` after `delay` ms of no calls
 * (trailing edge). Resets its internal timer on every call, so rapid bursts
 * collapse into a single invocation once the caller pauses.
 *
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @param {number} [delay]
 * @returns {F & { cancel: () => void }}
 */
export function debounce(fn, delay = 300) {
    let timer = null;
    const wrapped = function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, delay);
    };
    wrapped.cancel = () => {
        clearTimeout(timer);
        timer = null;
    };
    return wrapped;
}
