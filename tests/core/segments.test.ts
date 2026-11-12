import { describe, it, expect } from 'vitest';
import { SEGMENT, SegmentScheduler, segmentsCovering } from '../../src/core/segments';

function fakeClock(stepPerJob = 0) {
  let t = 0;
  return { now: () => t, tick: () => (t += stepPerJob) };
}

describe('segmentsCovering', () => {
  it('lists segment indices overlapping a rect', () => {
    expect(SEGMENT).toBe(256);
    expect(segmentsCovering(1024, 1024, { x: 250, y: 0, w: 10, h: 300 })).toEqual([0, 1, 4, 5]);
    expect(segmentsCovering(1000, 600, { x: -50, y: -50, w: 2000, h: 2000 })).toHaveLength(4 * 3);
  });
});

describe('SegmentScheduler', () => {
  it('runs segments nearest the focus first', () => {
    const s = new SegmentScheduler(1024, 1024, 1000);
    const order: number[] = [];
    for (let seg = 0; seg < 16; seg++) s.enqueue('derive', seg, () => order.push(seg));
    s.setFocus(512, 512);
    s.pump(fakeClock().now);
    expect(order.slice(0, 4).sort((a, b) => a - b)).toEqual([5, 6, 9, 10]);
    expect(order).toHaveLength(16);
  });

  it('re-prioritises when the focus moves mid-queue', () => {
    const clock = fakeClock(3);
    const s = new SegmentScheduler(1024, 1024, 8);
    const order: number[] = [];
    for (let seg = 0; seg < 16; seg++) s.enqueue('derive', seg, () => { order.push(seg); clock.tick(); });
    s.setFocus(512, 512);
    s.pump(clock.now);
    expect(order).toHaveLength(3); // 3 ms per job, 8 ms budget
    s.setFocus(0, 0);
    s.pump(clock.now);
    expect(order[3]).toBe(0);
  });

  it('replaces a duplicate job of the same kind and segment', () => {
    const s = new SegmentScheduler(512, 512);
    let a = 0, b = 0;
    s.enqueue('upload', 1, () => a++);
    s.enqueue('upload', 1, () => b++);
    s.enqueue('derive', 1, () => b++);
    expect(s.pending).toBe(2);
    s.pump(fakeClock().now);
    expect([a, b]).toEqual([0, 2]);
  });

  it('whenIdle resolves after the last job', async () => {
    const clock = fakeClock(5);
    const s = new SegmentScheduler(1024, 256, 8);
    let ran = 0;
    for (let seg = 0; seg < 4; seg++) s.enqueue('derive', seg, () => { ran++; clock.tick(); });
    const idle = s.whenIdle().then(() => ran);
    while (s.pending) s.pump(clock.now);
    await expect(idle).resolves.toBe(4);
    await expect(s.whenIdle()).resolves.toBeUndefined();
  });
});
