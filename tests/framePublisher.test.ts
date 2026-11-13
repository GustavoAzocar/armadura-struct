import { describe, expect, it } from 'vitest';
import { createFramePublisher } from '../src/lib/framePublisher';

function clock() {
  const callbacks: (() => void)[] = [];
  const canceled: number[] = [];
  return {
    callbacks,
    canceled,
    request: (run: () => void) => callbacks.push(run) - 1,
    cancel: (id: number) => {
      canceled.push(id);
    },
  };
}
describe('CAD frame publication', () => {
  it('hundreds of inputs publish only the latest value per frame', () => {
    const time = clock(),
      values: number[] = [];
    const publisher = createFramePublisher(
      (v: number) => values.push(v),
      time.request,
      time.cancel,
    );
    for (let i = 0; i < 500; i++) publisher.push(i);
    expect(values).toEqual([]);
    expect(time.callbacks).toHaveLength(1);
    time.callbacks[0]();
    expect(values).toEqual([499]);
    publisher.flush();
    expect(values).toEqual([499]);
  });
  it('release flushes the newest input before a transaction, including frame id zero', () => {
    const time = clock(),
      values: string[] = [];
    const publisher = createFramePublisher(
      (v: string) => values.push(v),
      time.request,
      time.cancel,
    );
    publisher.push('move');
    publisher.push('release');
    publisher.flush();
    values.push('commit');
    expect(values).toEqual(['release', 'commit']);
    expect(time.canceled).toContain(0);
    time.callbacks[0]();
    expect(values).toEqual(['release', 'commit']);
  });
  it('cancel and an obsolete callback cannot publish into a new command/project', () => {
    const time = clock(),
      values: string[] = [];
    const publisher = createFramePublisher(
      (v: string) => values.push(v),
      time.request,
      time.cancel,
    );
    publisher.push('old project');
    publisher.cancel();
    publisher.push('new project');
    time.callbacks[0]();
    expect(values).toEqual([]);
    time.callbacks[1]();
    expect(values).toEqual(['new project']);
  });
  it('a callback can queue the next frame without losing it', () => {
    const time = clock(),
      values: number[] = [];
    const publisher = createFramePublisher(
      (v: number) => {
        values.push(v);
        if (v === 1) publisher.push(2);
      },
      time.request,
      time.cancel,
    );
    publisher.push(1);
    time.callbacks[0]();
    time.callbacks[1]();
    expect(values).toEqual([1, 2]);
  });
});
