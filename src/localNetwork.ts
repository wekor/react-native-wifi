import type { PermissionResponse, WaitOptions } from './types';

/**
 * Prompts for local network access, which iOS 14+ requires before the app reaches devices on the local network.
 * Android has no such permission: granted at once.
 */
export const requestLocalNetworkPermission = async (
  _options?: WaitOptions
): Promise<PermissionResponse> => ({
  status: 'granted',
  granted: true,
  canAskAgain: false,
  expires: 'never',
});
