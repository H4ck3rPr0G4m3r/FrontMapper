import { describe, it, expect } from 'vitest';
import { MAX_PIXELS, sizeProblem } from '../../src/core/size';

describe('sizeProblem', () => {
  it('accepts normal sizes and rejects tiny, empty and oversized ones', () => {
    expect(sizeProblem(3000, 2000)).toBeNull();
    expect(sizeProblem(10000, 5000)).toBeNull();
    expect(sizeProblem(0, 2000)).toMatch(/at least 4/);
    expect(sizeProblem(NaN, 2000)).toMatch(/at least 4/);
    expect(sizeProblem(60000, 60000)).toMatch(/Too large/);
    expect(10000 * 5000).toBeLessThan(MAX_PIXELS);
  });
});
