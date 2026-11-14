#import "ReactNativeWifi.h"

// The Swift header declares `WifiCore` a `CLLocationManagerDelegate`.
#import <CoreLocation/CoreLocation.h>

#if __has_include("ReactNativeWifi-Swift.h")
#import "ReactNativeWifi-Swift.h"
#else
#import <ReactNativeWifi/ReactNativeWifi-Swift.h>
#endif

namespace {

/// Swift's rejection, `(code, message, nativeCode)`, as React Native's; JS reads `nativeCode` from `userInfo`.
void (^rejecterOf(RCTPromiseRejectBlock reject))(NSString *, NSString *, NSNumber *)
{
  return ^(NSString *code, NSString *message, NSNumber *nativeCode) {
    NSDictionary *userInfo = nativeCode ? @{@"nativeCode" : nativeCode} : @{};
    reject(code, message, [NSError errorWithDomain:@"ReactNativeWifi" code:nativeCode.integerValue userInfo:userInfo]);
  };
}

/// JS calls Android-only methods on Android alone; this answers a call that reaches iOS anyway.
void rejectAndroidOnly(RCTPromiseRejectBlock reject, NSString *what)
{
  reject(@"unsupported", [NSString stringWithFormat:@"%@ is Android only: iOS does not let apps do it", what], nil);
}

} // namespace

@interface ReactNativeWifi () <WifiCoreDelegate>
@end

@implementation ReactNativeWifi {
  WifiCore *_core;
  WifiProber *_prober;
  WifiLocalNetworkPermission *_localNetwork;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _core = [WifiCore new];
    _core.delegate = self;
    _prober = [WifiProber new];
    _localNetwork = [WifiLocalNetworkPermission new];
  }
  return self;
}

- (void)invalidate
{
  [_core close];
  [_prober close];
  [_localNetwork close];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeReactNativeWifiSpecJSI>(params);
}

#pragma mark - WifiCoreDelegate

- (void)networkChanged:(NSDictionary<NSString *, id> *)payload
{
  [self emitOnCurrentWifiNetworkChange:payload];
}

- (void)joinLost:(NSDictionary<NSString *, id> *)payload
{
  [self emitOnJoinLost:payload];
}

#pragma mark - Permissions

- (void)getWifiPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_core getWifiPermissionWithResolve:resolve reject:rejecterOf(reject)];
}

- (void)requestWifiPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_core requestWifiPermissionWithResolve:resolve reject:rejecterOf(reject)];
}

- (void)requestLocalNetworkPermission:(double)requestId
                              timeout:(double)timeout
                              resolve:(RCTPromiseResolveBlock)resolve
                               reject:(RCTPromiseRejectBlock)reject
{
  [_localNetwork request:requestId timeout:timeout resolve:resolve reject:rejecterOf(reject)];
}

- (void)cancelLocalNetworkPermissionRequest:(double)requestId
{
  [_localNetwork cancel:requestId];
}

#pragma mark - The current network

- (void)getCurrentWifiNetwork:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_core getCurrentWifiNetworkWithResolve:resolve reject:rejecterOf(reject)];
}

- (void)setNetworkUpdates:(BOOL)enabled
{
  [_core setNetworkUpdates:enabled];
}

#pragma mark - Joining

- (void)joinNetwork:(double)joinId
            options:(NSDictionary *)options
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject
{
  [_core joinNetwork:joinId options:options resolve:resolve reject:rejecterOf(reject)];
}

- (void)cancelJoin:(double)joinId
{
  [_core cancelJoin:joinId];
}

- (void)leaveNetwork:(double)joinId
               ssids:(NSArray *)ssids
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [_core leaveNetwork:joinId ssids:ssids resolve:resolve reject:rejecterOf(reject)];
}

- (void)forgetJoinedNetworks:(NSDictionary *)options
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject
{
  NSArray<NSString *> *ssids = [options[@"ssids"] isKindOfClass:[NSArray class]] ? options[@"ssids"] : nil;
  [_core forgetJoinedNetworks:ssids resolve:resolve reject:rejecterOf(reject)];
}

#pragma mark - Reaching devices

- (void)reachable:(double)probeId
             host:(NSString *)host
             port:(double)port
          timeout:(double)timeout
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  [_prober start:probeId host:host port:port timeout:timeout resolve:resolve reject:rejecterOf(reject)];
}

- (void)cancelReachable:(double)probeId
{
  [_prober cancel:probeId];
}

// iOS sends traffic for the Wi-Fi network's addresses there already: there is nothing to bind.
- (void)bindProcessToWifi:(BOOL)requireInternet
                  timeout:(double)timeout
                  resolve:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  resolve(nil);
}

- (void)unbindProcess:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(nil);
}

#pragma mark - Android only

- (void)scanNetworks:(double)timeout resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  rejectAndroidOnly(reject, @"Scanning");
}

- (void)getLastScanResults:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  rejectAndroidOnly(reject, @"Reading scan results");
}

- (void)addNetworkSuggestions:(NSDictionary *)options
                      resolve:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject
{
  rejectAndroidOnly(reject, @"Suggesting networks");
}

- (void)removeNetworkSuggestions:(NSDictionary *)options
                         resolve:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject
{
  rejectAndroidOnly(reject, @"Removing network suggestions");
}

- (void)isWifiEnabled:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  rejectAndroidOnly(reject, @"Reading whether Wi-Fi is on");
}

- (void)setWifiEnabledUpdates:(BOOL)enabled
{
}

- (void)openWifiSettings:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  rejectAndroidOnly(reject, @"Opening the Wi-Fi settings");
}

@end
