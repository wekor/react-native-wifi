import { checkTimeout, settings } from './config';
import { wrap } from './errors';
import native from './NativeReactNativeWifi';

/**
 * Routes all of the app's traffic through Wi-Fi, including a network without internet that Android would pass over
 * for mobile data, until `unbindProcess()`. With a `joinNetwork` active, binds to the joined network, which
 * `joinNetwork` does itself unless `bindProcess` is `false`. iOS resolves at once: it sends traffic for the Wi-Fi
 * network's addresses there without binding.
 */
export const bindProcessToWifi = async (options?: {
  requireInternet?: boolean;
  timeout?: number;
}) => {
  const timeout = checkTimeout(
    options?.timeout ?? settings.timeouts.bind,
    'timeout'
  );
  await wrap(
    native.bindProcessToWifi(options?.requireInternet ?? false, timeout)
  );
};

/** Routes the app's traffic as the system chooses again. iOS resolves at once. */
export const unbindProcess = () => wrap(native.unbindProcess());
