import { useLayoutEffect, useRef } from 'react';
import { createFramePublisher } from '../lib/framePublisher';

/** The publisher is stable; a pending frame always uses committed callbacks. */
export function useFramePublisher<T>(publish: (value: T) => void) {
  const latest = useRef(publish);
  useLayoutEffect(() => {
    latest.current = publish;
  });
  const publisher = useRef<ReturnType<typeof createFramePublisher<T>> | null>(
    null,
  );
  if (!publisher.current)
    publisher.current = createFramePublisher<T>((value) =>
      latest.current(value),
    );
  useLayoutEffect(() => () => publisher.current!.cancel(), []);
  return publisher.current;
}
