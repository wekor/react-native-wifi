import Foundation
import Network

/// Whether a device accepts a TCP connection, for `probe` and `joinNetwork`'s `waitFor`.
///
/// A probe connects as `fetch` does, with the default parameters, so a VPN that captures local traffic affects it as
/// it affects the app's own requests. While nothing answers, TCP resends the SYN on its own, so one connection waits
/// for the device to come up; a failure at once (refused: the device is up, its service is not; no route yet) is tried
/// again after a pause. iOS reports a denied local network through the connection's path, which a probe rejects with
/// rather than waiting out its timeout.
@objc public final class WifiProber: NSObject {
  private final class Probe {
    let id: Double
    let host: NWEndpoint.Host
    let port: NWEndpoint.Port
    let reply: Reply
    var connection: NWConnection?
    var timeout: DispatchWorkItem?
    var retry: DispatchWorkItem?
    /// Why the last attempt failed, as `probe`'s `cause` names it.
    var cause = "timeout"
    var vpn = false

    init(id: Double, host: NWEndpoint.Host, port: NWEndpoint.Port, reply: Reply) {
      self.id = id
      self.host = host
      self.port = port
      self.reply = reply
    }

    var label: String { "\(host):\(port)" }
  }

  /// Between attempts that failed at once, so a refused port is not hammered in a tight loop.
  private static let retryPause: DispatchTimeInterval = .milliseconds(250)

  private let queue = DispatchQueue(label: "com.wekor.reactnativewifi.probe")
  private var probes: [Double: Probe] = [:]

  /// `timeout` `0` waits without limit.
  @objc public func start(
    _ probeId: Double, host: String, port: Double, timeout: Double, resolve: @escaping (Any?) -> Void,
    reject: @escaping (String, String, NSNumber?) -> Void
  ) {
    let reply = Reply(resolve: resolve, reject: reject)
    guard !host.isEmpty, let port = UInt16(exactly: port).flatMap(NWEndpoint.Port.init(rawValue:)), port != 0 else {
      return reply.reject(WifiError("invalid-argument", "\(host):\(port) is not a host and TCP port"))
    }
    queue.async {
      let probe = Probe(id: probeId, host: NWEndpoint.Host(host), port: port, reply: reply)
      self.probes[probeId] = probe
      if timeout > 0 {
        let item = DispatchWorkItem { [weak self, weak probe] in
          guard let self, let probe else { return }
          self.finish(probe) { $0.resolve(["reachable": false, "cause": probe.cause, "vpn": probe.vpn]) }
        }
        probe.timeout = item
        self.queue.asyncAfter(deadline: .now() + .milliseconds(Int(timeout)), execute: item)
      }
      self.attempt(probe)
    }
  }

  @objc public func cancel(_ probeId: Double) {
    queue.async {
      guard let probe = self.probes[probeId] else { return }
      self.finish(probe) { $0.reject(WifiError("cancelled", "Connecting to \(probe.label) was aborted")) }
    }
  }

  @objc public func close() {
    queue.async {
      for probe in self.probes.values {
        self.finish(probe) { $0.reject(WifiError("cancelled", "The module was torn down")) }
      }
    }
  }

  private func attempt(_ probe: Probe) {
    let connection = NWConnection(host: probe.host, port: probe.port, using: .tcp)
    probe.connection = connection
    connection.stateUpdateHandler = { [weak self, weak probe] state in
      guard let self, let probe, probe.connection === connection else { return }
      switch state {
      case .ready:
        self.finish(probe) { $0.resolve(["reachable": true]) }
      case .waiting(let error), .failed(let error):
        let path = connection.currentPath
        if path?.unsatisfiedReason == .localNetworkDenied {
          return self.finish(probe) {
            $0.reject(
              WifiError(
                "local-network-denied",
                "iOS blocks the app from the local network, so \(probe.label) cannot be reached; allow it in Settings"))
          }
        }
        probe.cause = Self.cause(of: error)
        probe.vpn = Self.viaVpn(path)
        self.drop(connection, of: probe)
        self.retryLater(probe)
      default:
        break
      }
    }
    connection.start(queue: queue)
  }

  private func retryLater(_ probe: Probe) {
    let item = DispatchWorkItem { [weak self, weak probe] in
      guard let self, let probe, self.probes[probe.id] === probe else { return }
      probe.retry = nil
      self.attempt(probe)
    }
    probe.retry = item
    // Past the deadline the timeout answers first, and this finds the probe gone.
    queue.asyncAfter(deadline: .now() + Self.retryPause, execute: item)
  }

  private func drop(_ connection: NWConnection, of probe: Probe) {
    connection.stateUpdateHandler = nil
    connection.cancel()
    if probe.connection === connection { probe.connection = nil }
  }

  /// Settles `probe` once and lets go of everything it holds.
  private func finish(_ probe: Probe, _ settle: (Reply) -> Void) {
    guard probes.removeValue(forKey: probe.id) != nil else { return }
    probe.timeout?.cancel()
    probe.retry?.cancel()
    if let connection = probe.connection { drop(connection, of: probe) }
    settle(probe.reply)
  }

  private static func cause(of error: NWError) -> String {
    switch error {
    case .posix(.ECONNREFUSED): return "refused"
    case .posix(.ETIMEDOUT): return "timeout"
    case .dns: return "unresolved"
    default: return "no-route"
    }
  }

  /// The interface the system routes through first; a VPN's are `utun` and `ipsec`.
  private static func viaVpn(_ path: NWPath?) -> Bool {
    guard let name = path?.availableInterfaces.first?.name else { return false }
    return name.hasPrefix("utun") || name.hasPrefix("ipsec")
  }
}
