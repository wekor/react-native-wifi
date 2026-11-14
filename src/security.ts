import { WifiError } from './errors';
import type { Security } from './types';

/** The security a join or a suggestion goes by: as given, else WPA2 with a password and open without one. */
export const securityOf = ({
  password,
  security,
}: {
  password?: string;
  security?: Security;
}): Security => {
  if (security && security !== 'open' && !password)
    throw new WifiError(
      'invalid-argument',
      `A ${security} network needs a password`
    );
  if (security === 'open' && password)
    throw new WifiError(
      'invalid-argument',
      'An open network takes no password'
    );
  return security ?? (password ? 'wpa2' : 'open');
};
