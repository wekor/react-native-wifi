import CoreLocation
import Foundation
import Network
import NetworkExtension
import UIKit

/// What the core reports to JS.
@objc public protocol WifiCoreDelegate: AnyObject {
  /// `{ network }`, the network being `NSNull` when the phone is on no Wi-Fi network.
  func networkChanged(_ payload: [String: Any])
  /// `{ joinId, ssid }`.
  func joinLost(_ payload: [String: Any])
}

/// A `WifiError` as JS receives it: `code` is a `WifiErrorCode`.
struct WifiError: Error {
  let code: String
  let message: String
  let nativeCode: Int?

  init(_ code: String, _ message: String, nativeCode: Int? = nil) {
    self.code = code
    self.message = message
    self.nativeCode = nativeCode
  }

  /// An `NEHotspotConfigurationErrorDomain` error, by the raw codes so every SDK knows them.
  init(hotspot error: NSError) {
    let code: String
    switch error.code {
    case 0, 1, 2, 3, 4, 5, 6, 15: code = "invalid-argument"  // invalid, invalidSSID, the passphrases, EAP, HS20, prefix
    case 7: code = "user-denied"
    case 12: code = "unsupported"  // joinOnceNotSupported
    case 14: code = "not-permitted"  // applicationIsNotInForeground
    default: code = "join-failed"  // internal, pending, systemConfiguration, unknown
    }
    self.init(code, error.localizedDescription, nativeCode: error.code)
  }
}

/// A promise that settles once: later answers (a late callback after a timeout, say) are dropped.
final class Reply {
  private let lock = NSLock()
  private var settled = false
  private let resolveBlock: (Any?) -> Void
  private let rejectBlock: (String, String, NSNumber?) -> Void

  init(resolve: @escaping (Any?) -> Void, reject: @escaping (String, String, NSNumber?) -> Void) {
    resolveBlock = resolve
    rejectBlock = reject
  }

  private func settle() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if settled { return false }
    settled = true
    return true
  }

  func resolve(_ value: Any? = nil) {
    if settle() { resolveBlock(value) }
  }

  func reject(_ error: WifiError) {
    if settle() { rejectBlock(error.code, error.message, error.nativeCode.map { NSNumber(value: $0) }) }
  }
}

/// Joining, the current network, its updates and the location permission. State lives on `queue`; the location
/// manager on the main thread, which it needs.
@objc public final class WifiCore: NSObject, CLLocationManagerDelegate {
  @objc public weak var delegate: WifiCoreDelegate?

  private let queue = DispatchQueue(label: "com.wekor.reactnativewifi")
  private let pathMonitor = NWPathMonitor()
  private var foregroundObserver: NSObjectProtocol?

  /// iOS reports no event when the phone associates with a network, nor when it leaves one for another: a join
  /// checks the network at each path change and at this interval until the phone is on it.
  private static let joinCheckInterval: DispatchTimeInterval = .milliseconds(500)

  /// Right after a device opens its hotspot, iOS can fail to join it with an internal error; a join tries again after
  /// this pause, within its timeout. Never after the user answered: that would prompt them again.
  private static let joinRetryPause: DispatchTimeInterval = .seconds(1)

  /// `internal`, `pending`, `systemConfiguration` and `unknown`: the system failed, not the user or the options.
  private static let transientHotspotErrors: Set<Int> = [8, 9, 10, 11]

  override public init() {
    super.init()
    pathMonitor.pathUpdateHandler = { [weak self] _ in self?.networkMayHaveChanged() }
    pathMonitor.start(queue: queue)
    foregroundObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil
    ) { [weak self] _ in
      // A permission or a network changed in Settings meanwhile.
      self?.queue.async { self?.networkMayHaveChanged() }
    }
  }

  @objc public func close() {
    if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
    pathMonitor.cancel()
    queue.async {
      self.networkUpdates = false
      if let join = self.current {
        join.reply.reject(WifiError("cancelled", "The module was torn down"))
        self.end(join, forget: !join.joined && join.applied)
      }
    }
    DispatchQueue.main.async {
      let waiters = self.permissionWaiters
      self.permissionWaiters = []
      for waiter in waiters { waiter.reject(WifiError("cancelled", "The module was torn down")) }
    }
  }

  // MARK: - Permission

  private var locationManager: CLLocationManager?
  /// Touched on the main thread only.
  private var permissionWaiters: [Reply] = []

  /// On the main thread.
  private func manager() -> CLLocationManager {
    if let locationManager { return locationManager }
    let manager = CLLocationManager()
    manager.delegate = self
    locationManager = manager
    return manager
  }

  /// Expo's `PermissionResponse`. Approximate location does not reveal the SSID, so it counts as denied.
  private func permissionResponse(_ manager: CLLocationManager) -> [String: Any] {
    switch manager.authorizationStatus {
    case .notDetermined:
      return ["status": "undetermined", "canAskAgain": true]
    case .authorizedAlways, .authorizedWhenInUse:
      let precise = manager.accuracyAuthorization == .fullAccuracy
      return ["status": precise ? "granted" : "denied", "canAskAgain": false]
    default:
      return ["status": "denied", "canAskAgain": false]
    }
  }

  @objc public func getWifiPermission(resolve: @escaping (Any?) -> Void, reject: @escaping (String, String, NSNumber?) -> Void) {
    DispatchQueue.main.async { resolve(self.permissionResponse(self.manager())) }
  }

  @objc public func requestWifiPermission(resolve: @escaping (Any?) -> Void, reject: @escaping (String, String, NSNumber?) -> Void) {
    let reply = Reply(resolve: resolve, reject: reject)
    DispatchQueue.main.async {
      let manager = self.manager()
      guard manager.authorizationStatus == .notDetermined else { return reply.resolve(self.permissionResponse(manager)) }
      guard Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") != nil else {
        return reply.reject(
          WifiError(
            "unsupported",
            "Info.plist has no NSLocationWhenInUseUsageDescription; set the config plugin's locationPermission"))
      }
      self.permissionWaiters.append(reply)
      if self.permissionWaiters.count == 1 { manager.requestWhenInUseAuthorization() }
    }
  }

  public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    // Also called when the manager is created, before the user answers.
    guard manager.authorizationStatus != .notDetermined, !permissionWaiters.isEmpty else { return }
    let response = permissionResponse(manager)
    let waiters = permissionWaiters
    permissionWaiters = []
    for waiter in waiters { waiter.resolve(response) }
    if response["status"] as? String == "granted" { queue.async { self.networkMayHaveChanged() } }
  }

  // MARK: - The current network

  private var networkUpdates = false
  /// The identity of the network last emitted; nil when none was.
  private var lastNetworkKey: String?

  /// The SSID needs the location permission, unless the app joined the network itself; `ip` needs nothing.
  private func fetchCurrent(_ done: @escaping (_ network: NEHotspotNetwork?, _ payload: [String: Any]?) -> Void) {
    NEHotspotNetwork.fetchCurrent { network in
      self.queue.async {
        let ip = Self.wifiAddress()
        guard network != nil || ip != nil else { return done(nil, nil) }
        var payload: [String: Any] = [:]
        if let network {
          payload["ssid"] = network.ssid
          if let bssid = Self.bssidOf(network.bssid) { payload["bssid"] = bssid }
        }
        if let ip { payload["ip"] = ip }
        done(network, payload)
      }
    }
  }

  @objc public func getCurrentWifiNetwork(resolve: @escaping (Any?) -> Void, reject: @escaping (String, String, NSNumber?) -> Void) {
    fetchCurrent { _, payload in resolve(["network": Self.jsNetwork(payload)]) }
  }

  @objc public func setNetworkUpdates(_ enabled: Bool) {
    queue.async {
      self.networkUpdates = enabled
      if enabled { self.emitNetworkIfChanged() } else { self.lastNetworkKey = nil }
    }
  }

  /// On `queue`: the path changed, or the app came back to the foreground.
  private func networkMayHaveChanged() {
    if networkUpdates { emitNetworkIfChanged() }
    guard let join = current else { return }
    if join.joined { checkStillJoined(join) } else if join.answered { check(join) }
  }

  private func emitNetworkIfChanged() {
    fetchCurrent { _, payload in
      guard self.networkUpdates else { return }
      let key = payload.map { network in
        ["ssid", "bssid", "ip"].map { network[$0] as? String ?? "" }.joined(separator: "|")
      } ?? "none"
      guard key != self.lastNetworkKey else { return }
      self.lastNetworkKey = key
      self.delegate?.networkChanged(["network": Self.jsNetwork(payload)])
    }
  }

  /// A network as JS receives it: `null` when there is none.
  private static func jsNetwork(_ payload: [String: Any]?) -> Any {
    payload.map { $0 as Any } ?? NSNull()
  }

  /// The phone's IPv4 address on Wi-Fi. The interface is told by its functional type: BSD names like `en0` are not
  /// API, and Wi-Fi is not `en0` on every device (TN3179).
  static func wifiAddress() -> String? {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0, let first = list else { return nil }
    defer { freeifaddrs(list) }
    let probe = Darwin.socket(AF_INET, SOCK_DGRAM, 0)
    guard probe >= 0 else { return nil }
    defer { Darwin.close(probe) }
    let live = Int32(IFF_UP | IFF_RUNNING)
    for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let entry = pointer.pointee
      guard let address = entry.ifa_addr, address.pointee.sa_family == UInt8(AF_INET),
        Int32(entry.ifa_flags) & live == live, isWifi(entry.ifa_name, socket: probe)
      else { continue }
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      if getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
        return String(cString: host)
      }
    }
    return nil
  }

  /// `SIOCGIFFUNCTIONALTYPE` from `sys/sockio.h`, `_IOWR('i', 173, struct ifreq)`: a function-like macro Swift does
  /// not import.
  private static let functionalTypeRequest: UInt = {
    let inOut: UInt = 0x8000_0000 | 0x4000_0000  // IOC_IN | IOC_OUT
    let length = UInt(MemoryLayout<ifreq>.size) & 0x1fff  // IOCPARM_MASK
    return inOut | (length << 16) | (UInt(UInt8(ascii: "i")) << 8) | 173
  }()

  private static func isWifi(_ name: UnsafePointer<CChar>, socket: Int32) -> Bool {
    var request = ifreq()
    withUnsafeMutableBytes(of: &request.ifr_name) { buffer in
      _ = strlcpy(buffer.baseAddress!.assumingMemoryBound(to: CChar.self), name, buffer.count)
    }
    let result = withUnsafeMutablePointer(to: &request) { ioctl(socket, functionalTypeRequest, $0) }
    return result == 0 && request.ifr_ifru.ifru_functional_type == UInt32(IFRTYPE_FUNCTIONAL_WIFI_INFRA)
  }

  /// `aa:b:cc:…` as `AA:0B:CC:…`; nil when empty.
  static func bssidOf(_ raw: String) -> String? {
    let parts = raw.split(separator: ":")
    guard parts.count == 6 else { return raw.isEmpty ? nil : raw.uppercased() }
    return parts.map { $0.count == 1 ? "0\($0)" : String($0) }.joined(separator: ":").uppercased()
  }

  // MARK: - Joining

  private final class Join {
    let id: Double
    /// What JS asked for: the name, or with `prefix` its start.
    let requested: String
    let prefix: Bool
    let reply: Reply
    let configuration: NEHotspotConfiguration
    /// When the caller's timeout passes; nil without one.
    let deadline: DispatchTime?
    /// The network's actual name once on it.
    var ssid: String
    /// The system answered `apply` without an error.
    var answered = false
    /// The system took the configuration, which leaving or failing then removes.
    var applied = false
    var joined = false
    var timeout: DispatchWorkItem?
    var retry: DispatchWorkItem?
    var timer: DispatchSourceTimer?

    init(
      id: Double, requested: String, prefix: Bool, configuration: NEHotspotConfiguration, deadline: DispatchTime?,
      reply: Reply
    ) {
      self.id = id
      self.requested = requested
      self.prefix = prefix
      self.configuration = configuration
      self.deadline = deadline
      self.reply = reply
      ssid = requested
    }

    var names: [String] { ssid == requested ? [ssid] : [requested, ssid] }

    func matches(_ name: String) -> Bool {
      prefix ? name.hasPrefix(requested) : name == requested
    }
  }

  /// One join at a time: the phone is on one Wi-Fi network.
  private var current: Join?

  @objc public func joinNetwork(
    _ joinId: Double, options: NSDictionary, resolve: @escaping (Any?) -> Void,
    reject: @escaping (String, String, NSNumber?) -> Void
  ) {
    let reply = Reply(resolve: resolve, reject: reject)
    let ssid = options["ssid"] as? String ?? ""
    let prefix = options["prefix"] as? Bool ?? false
    let password = options["password"] as? String ?? ""
    let security = options["security"] as? String ?? "open"
    let hidden = options["hidden"] as? Bool ?? false
    let timeout = options["timeout"] as? Double ?? 0
    let joinOnce = options["joinOnce"] as? Bool ?? false

    queue.async {
      if let previous = self.current { self.replace(previous) }
      let configuration: NEHotspotConfiguration
      switch (security, prefix) {
      case ("open", false): configuration = NEHotspotConfiguration(ssid: ssid)
      case ("open", true): configuration = NEHotspotConfiguration(ssidPrefix: ssid)
      case (_, false): configuration = NEHotspotConfiguration(ssid: ssid, passphrase: password, isWEP: security == "wep")
      case (_, true):
        configuration = NEHotspotConfiguration(ssidPrefix: ssid, passphrase: password, isWEP: security == "wep")
      }
      configuration.joinOnce = joinOnce
      if hidden { configuration.hidden = true }

      let deadline: DispatchTime? = timeout > 0 ? .now() + .milliseconds(Int(timeout)) : nil
      let join = Join(
        id: joinId, requested: ssid, prefix: prefix, configuration: configuration, deadline: deadline, reply: reply)
      self.current = join
      if let deadline {
        let item = DispatchWorkItem { [weak self, weak join] in
          guard let self, let join else { return }
          let reason = join.applied ? "; the password may be wrong, or the network out of range" : ""
          self.fail(join, WifiError("timeout", "Did not join \(ssid) in time\(reason)"))
        }
        join.timeout = item
        self.queue.asyncAfter(deadline: deadline, execute: item)
      }
      self.apply(join)
    }
  }

  private func apply(_ join: Join) {
    NEHotspotConfigurationManager.shared.apply(join.configuration) { error in
      self.queue.async { self.applied(join, error: error as NSError?) }
    }
  }

  @objc public func cancelJoin(_ joinId: Double) {
    queue.async {
      guard let join = self.current, join.id == joinId, !join.joined else { return }
      self.fail(join, WifiError("cancelled", "The join was cancelled"))
    }
  }

  /// Leaves the join `joinId` if it is still on, and has the system forget `ssids`: a lost join's names, which iOS
  /// keeps configured and would join again.
  @objc public func leaveNetwork(
    _ joinId: Double, ssids: [String], resolve: @escaping (Any?) -> Void,
    reject: @escaping (String, String, NSNumber?) -> Void
  ) {
    queue.async {
      if let join = self.current, join.id == joinId {
        join.reply.reject(WifiError("cancelled", "Left before the join finished"))
        self.end(join, forget: true)
      }
      self.removeConfigurations(ssids)
      resolve(nil)
    }
  }

  /// Forgets the networks named `ssids`, or every network the app configured, from this launch or an earlier one.
  @objc public func forgetJoinedNetworks(
    _ ssids: [String]?, resolve: @escaping (Any?) -> Void, reject: @escaping (String, String, NSNumber?) -> Void
  ) {
    queue.async {
      if let join = self.current, ssids.map({ !Set($0).isDisjoint(with: join.names) }) ?? true {
        join.reply.reject(WifiError("cancelled", "Forgotten before the join finished"))
        self.end(join, forget: true)
      }
      let manager = NEHotspotConfigurationManager.shared
      if let ssids {
        for ssid in ssids { manager.removeConfiguration(forSSID: ssid) }
        return resolve(nil)
      }
      manager.getConfiguredSSIDs { configured in
        for ssid in configured { manager.removeConfiguration(forSSID: ssid) }
        resolve(nil)
      }
    }
  }

  /// The system's answer to `apply`, which comes after the user's.
  private func applied(_ join: Join, error: NSError?) {
    // Already on the network: success, with nothing of this join's to remove.
    let alreadyAssociated = error?.domain == NEHotspotConfigurationErrorDomain && error?.code == 13
    if let error, !alreadyAssociated {
      let hotspotError = error.domain == NEHotspotConfigurationErrorDomain
      if hotspotError, Self.transientHotspotErrors.contains(error.code), retryLater(join) { return }
      fail(
        join,
        hotspotError
          ? WifiError(hotspot: error) : WifiError("join-failed", error.localizedDescription, nativeCode: error.code))
      return
    }
    guard current === join else {
      // Cancelled, timed out or replaced while the system asked the user: undo what the user accepted.
      if !alreadyAssociated { forget(join) }
      return
    }
    join.answered = true
    join.applied = !alreadyAssociated
    check(join)
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + Self.joinCheckInterval, repeating: Self.joinCheckInterval)
    timer.setEventHandler { [weak self, weak join] in
      guard let self, let join else { return }
      self.check(join)
    }
    join.timer = timer
    timer.resume()
  }

  /// Applies `join`'s configuration again after a pause, if its timeout leaves room for that; false if not.
  private func retryLater(_ join: Join) -> Bool {
    guard current === join else { return false }
    let at = DispatchTime.now() + Self.joinRetryPause
    if let deadline = join.deadline, at >= deadline { return false }
    let item = DispatchWorkItem { [weak self, weak join] in
      guard let self, let join, self.current === join else { return }
      join.retry = nil
      self.apply(join)
    }
    join.retry = item
    queue.asyncAfter(deadline: at, execute: item)
    return true
  }

  /// Settles `join` once the phone is on the network with an address: the system answers `apply` before it is.
  private func check(_ join: Join) {
    fetchCurrent { network, payload in
      guard self.current === join, !join.joined, let network, join.matches(network.ssid), payload?["ip"] != nil
      else { return }
      join.joined = true
      join.ssid = network.ssid
      join.timeout?.cancel()
      join.timer?.cancel()
      join.timer = nil
      join.reply.resolve(payload)
      if self.networkUpdates { self.emitNetworkIfChanged() }
    }
  }

  private func checkStillJoined(_ join: Join) {
    fetchCurrent { network, _ in
      guard self.current === join, join.joined, network?.ssid != join.ssid else { return }
      // The configuration stays: `leave()` and `forgetJoinedNetworks` still remove it.
      self.end(join, forget: false)
      self.delegate?.joinLost(["joinId": join.id, "ssid": join.ssid])
    }
  }

  private func fail(_ join: Join, _ error: WifiError) {
    guard current === join else { return }
    join.reply.reject(error)
    end(join, forget: join.applied)
  }

  /// A newer join takes the place of `join`: a pending one is cancelled, a joined one is lost.
  private func replace(_ join: Join) {
    if join.joined {
      end(join, forget: false)
      delegate?.joinLost(["joinId": join.id, "ssid": join.ssid])
    } else {
      join.reply.reject(WifiError("cancelled", "A newer join replaced this one"))
      end(join, forget: join.applied)
    }
  }

  private func end(_ join: Join, forget shouldForget: Bool) {
    join.timeout?.cancel()
    join.retry?.cancel()
    join.retry = nil
    join.timer?.cancel()
    join.timer = nil
    if current === join { current = nil }
    if shouldForget { forget(join) }
  }

  /// Has the system forget the network, which takes the phone off it if it is on it.
  private func forget(_ join: Join) {
    removeConfigurations(join.names)
  }

  /// Has the system forget `ssids`, except those the current join goes by: an earlier join of the same network,
  /// answered late or left after it was lost, would otherwise undo the current one.
  private func removeConfigurations(_ ssids: [String]) {
    let inUse = Set(current?.names ?? [])
    for ssid in ssids where !inUse.contains(ssid) {
      NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid)
    }
  }
}
