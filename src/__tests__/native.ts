/**
 * A scripted native side: every call is recorded, a promise settles only when a test answers it, and a test emits
 * events as native would. Import this before the library so the mocks are in place.
 */
import { mock } from 'bun:test';

type Deferred = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

type Call = { name: string; args: unknown[]; deferred: Deferred };

export const calls: Call[] = [];

const EVENTS = [
  'onCurrentWifiNetworkChange',
  'onJoinLost',
  'onWifiEnabledChange',
];
const handlers: Record<string, (payload: unknown) => void> = {};

const native = new Proxy(
  {},
  {
    get: (_, name: string) => {
      if (EVENTS.includes(name))
        return (handler: (payload: unknown) => void) => {
          handlers[name] = handler;
          return { remove: () => {} };
        };
      return (...args: unknown[]) => {
        let deferred!: Deferred;
        const promise = new Promise((resolve, reject) => {
          deferred = { resolve, reject };
        });
        calls.push({ name, args, deferred });
        return promise;
      };
    },
  }
);

/** The platform the library sees; a test sets it and puts it back. */
export const platform: { OS: string; Version: number | string } = {
  OS: 'ios',
  Version: '18.0',
};

mock.module('react-native', () => ({
  TurboModuleRegistry: { getEnforcing: () => native },
  Platform: platform,
}));
mock.module('../NativeReactNativeWifi', () => ({ default: native }));

export const emit = (event: string, payload: unknown) =>
  handlers[event]?.(payload);

export const callsOf = (name: string) =>
  calls.filter((call) => call.name === name);

export const lastCall = (name: string) => {
  const call = callsOf(name).at(-1);
  if (!call) throw new Error(`No ${name} call`);
  return call;
};

/** A rejection as React Native makes one from native's `reject(code, message, userInfo)`. */
export const nativeError = (
  code: string,
  message: string,
  nativeCode?: number
) =>
  Object.assign(new Error(message), {
    code,
    userInfo: nativeCode === undefined ? {} : { nativeCode },
  });

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
