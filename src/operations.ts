import { cancelled, wrap } from './errors';

let nextId = 1;

/**
 * Runs a native operation JS can cancel: `start` begins it under a fresh id, and `signal` aborting calls
 * `cancel(id)`, after which native rejects it with `cancelled`. Rejects at once if `signal` already aborted.
 */
export const cancellable = async <T>(
  what: string,
  signal: AbortSignal | undefined,
  start: (id: number) => Promise<T>,
  cancel: (id: number) => void
): Promise<T> => {
  if (signal?.aborted) throw cancelled(what);
  const id = nextId++;
  const abort = () => cancel(id);
  signal?.addEventListener('abort', abort);
  try {
    return await wrap(start(id));
  } finally {
    signal?.removeEventListener('abort', abort);
  }
};
