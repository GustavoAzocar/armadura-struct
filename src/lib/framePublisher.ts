/** Coalesce presentation work, never the semantic input/transaction itself. */
export function createFramePublisher<T>(
  publish: (value: T) => void,
  request: (run: () => void) => number = (run) => requestAnimationFrame(run),
  cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
) {
  let frame: number | undefined;
  let generation = 0;
  let pending: { value: T } | undefined;
  const flush = () => {
    generation++;
    if (frame !== undefined) cancel(frame);
    frame = undefined;
    const next = pending;
    pending = undefined;
    if (next) publish(next.value);
  };
  return {
    push(value: T) {
      pending = { value };
      if (frame === undefined) {
        const requested = ++generation;
        frame = request(() => {
          if (requested !== generation) return;
          frame = undefined;
          flush();
        });
      }
    },
    flush,
    cancel() {
      generation++;
      if (frame !== undefined) cancel(frame);
      frame = undefined;
      pending = undefined;
    },
  };
}
