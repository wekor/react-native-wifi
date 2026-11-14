import { checkTimeout } from './config';
import native from './NativeReactNativeWifi';
import { cancellable } from './operations';
import { responseOf } from './permission';
import type { PermissionResponse, WaitOptions } from './types';
import type * as Fallback from './localNetwork';

/**
 * Prompts for local network access when the user has not answered yet, and resolves with the answer. iOS has no API
 * for this permission: native advertises a Bonjour service and browses for it, which is also what prompts.
 */
export const requestLocalNetworkPermission: typeof Fallback.requestLocalNetworkPermission =
  async (options?: WaitOptions): Promise<PermissionResponse> => {
    const timeout = checkTimeout(options?.timeout ?? 0, 'timeout');
    const response = await cancellable(
      'The local network permission request',
      options?.signal,
      (id) => native.requestLocalNetworkPermission(id, timeout),
      (id) => native.cancelLocalNetworkPermissionRequest(id)
    );
    return responseOf(response as Parameters<typeof responseOf>[0]);
  };
