import { WifiError } from './errors';
import type { ConfigureOptions } from './types';

export const settings = {
  timeouts: { join: 30_000, probe: 5_000, scan: 15_000, bind: 10_000 },
};

/** Sets the defaults later calls use; a call's own options win. */
export const configure = (options: ConfigureOptions) => {
  if (options.timeouts)
    settings.timeouts = { ...settings.timeouts, ...options.timeouts };
};

/** A timeout as native takes it: milliseconds, `0` without limit. */
export const checkTimeout = (timeout: number, name: string) => {
  if (!Number.isFinite(timeout) || timeout < 0)
    throw new WifiError(
      'invalid-argument',
      `${name} must be 0 or more milliseconds`
    );
  return timeout;
};
