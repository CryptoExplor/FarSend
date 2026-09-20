import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '../src/core/debounce.js';

describe('debounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('invokes the function once after the delay when called repeatedly', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 300);

        debounced();
        debounced();
        debounced();

        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(299);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('forwards the latest arguments to the function', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced('a');
        debounced('b');
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledWith('b');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('resets the timer on each call (trailing edge)', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced();
        vi.advanceTimersByTime(90);
        debounced(); // reset
        vi.advanceTimersByTime(90);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(10);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
