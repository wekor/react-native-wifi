import Foundation
import Network
import UIKit

/// Local network access, which iOS 14+ requires before an app reaches devices on the local network.
///
/// iOS has no API to read or request it (TN3179). The probe is `@wekor/react-native-local-network-permission`'s:
/// advertise a Bonjour service and browse for it, which is also what shows the alert. How the answer is told:
///
/// - **A service found**: granted. iOS shows a denied app none.
/// - **The alert is up** (it makes the app resign active): wait for the user.
/// - **The user is back from the alert**: the probe's next outcome is the answer, as iOS holds a probe back until the
///   user answers (measured on iOS 26: the old library's rule, a `waiting` probe is denied, holds). Only when iOS denied
///   the probe before the alert, as TN3179 warns it may, is that denial stale: then a new probe meets the answer.
///   Another alert (location, say) also makes the app resign active, so this denial is not remembered: at worst one
///   request answers denied early, and the next one waits for the alert again.
/// - **`PolicyDenied` after the user has answered** in an earlier request: denied.
/// - **`PolicyDenied` before the user ever answered**: TN3179 warns iOS may deny the first operation just before it shows
///   the alert, so wait for the alert; if none comes within `alertGrace`, none will, and it is denied.
///
/// Waiting for any other reason (no network yet) is waited out. Requests at once share one probe, which stops when the
/// last of them settles.
@objc public final class WifiLocalNetworkPermission: NSObject {
  /// The Bonjour service the probe uses, which the app lists in `NSBonjourServices` (the config plugin does). The same
  /// as `@wekor/react-native-local-network-permission`'s, so apps moving over keep their `Info.plist`.
  @objc public static let serviceType = "_preflight_check._tcp"

  /// `kDNSServiceErr_PolicyDenied` from `dns_sd.h`.
  private static let policyDenied: Int32 = -65570

  /// How long after a first `PolicyDenied` the alert may take to make the app resign active.
  private static let alertGrace: DispatchTimeInterval = .seconds(1)

  /// Whether the user has answered, in any launch: set only once that is certain (a service found, or no alert came).
  /// A reinstall clears it along with the permission; resetting Location & Privacy in Settings clears only the
  /// permission, after which one request may answer denied before the alert.
  private static let answeredKey = "com.wekor.reactnativewifi.localNetworkAnswered"

  private final class Waiter {
    let reply: Reply
    var timeout: DispatchWorkItem?

    init(reply: Reply) { self.reply = reply }
  }

  private let queue = DispatchQueue(label: "com.wekor.reactnativewifi.local-network")
  private var waiters: [Double: Waiter] = [:]
  private var listener: NWListener?
  private var browser: NWBrowser?
  private var appActive = true
  /// The app resigned active while probing: the alert is up.
  private var alertUp = false
  /// The app came back from an alert in this probe, most likely the local network one.
  private var answeredNow = false
  /// The listener or browser waits with `PolicyDenied`.
  private var policyHeld = false
  /// Denies once `alertGrace` passes without an alert.
  private var noAlert: DispatchWorkItem?
  private var observers: [NSObjectProtocol] = []

  private var answered: Bool { answeredNow || UserDefaults.standard.bool(forKey: Self.answeredKey) }

  override public init() {
    super.init()
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: nil) {
        [weak self] _ in self?.queue.async { self?.appActiveChanged(false) }
      },
      center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) {
        [weak self] _ in self?.queue.async { self?.appActiveChanged(true) }
      },
    ]
  }

  deinit {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
  }

  /// `timeout` `0` waits without limit: the alert waits for the user.
  @objc public func request(
    _ requestId: Double, timeout: Double, resolve: @escaping (Any?) -> Void,
    reject: @escaping (String, String, NSNumber?) -> Void
  ) {
    let reply = Reply(resolve: resolve, reject: reject)
    // The application state is the main thread's to read.
    DispatchQueue.main.async {
      let state = UIApplication.shared.applicationState
      self.queue.async { self.start(requestId, timeout: timeout, reply: reply, state: state) }
    }
  }

  @objc public func cancel(_ requestId: Double) {
    queue.async {
      self.settle(requestId) { $0.reject(WifiError("cancelled", "The local network permission request was aborted")) }
    }
  }

  @objc public func close() {
    queue.async { self.answerAll { $0.reject(WifiError("cancelled", "The module was torn down")) } }
  }

  private func start(_ requestId: Double, timeout: Double, reply: Reply, state: UIApplication.State) {
    if let missing = Self.missingDeclaration() { return reply.reject(missing) }
    // TN3179: in the background iOS denies without asking, and records nothing.
    if state == .background {
      return reply.reject(
        WifiError("not-permitted", "iOS does not ask for local network access while the app is in the background"))
    }
    let waiter = Waiter(reply: reply)
    waiters[requestId] = waiter
    if timeout > 0 {
      let item = DispatchWorkItem { [weak self] in
        self?.settle(requestId) {
          $0.reject(WifiError("timeout", "The local network permission was not answered in time"))
        }
      }
      waiter.timeout = item
      queue.asyncAfter(deadline: .now() + .milliseconds(Int(timeout)), execute: item)
    }
    if browser == nil {
      appActive = state == .active
      alertUp = false
      answeredNow = false
      startProbe()
    }
  }

  // MARK: - The probe

  private func startProbe() {
    let listener: NWListener
    do {
      listener = try NWListener(using: .tcp)
    } catch {
      return answerAll { $0.reject(WifiError("unknown", "Could not advertise the Bonjour service: \(error)")) }
    }
    listener.service = NWListener.Service(name: UUID().uuidString, type: Self.serviceType)
    listener.newConnectionHandler = { $0.cancel() }
    listener.stateUpdateHandler = { [weak self, weak listener] state in
      guard let self, let listener, self.listener === listener else { return }
      switch state {
      case .waiting(let error): self.waiting(error)
      case .failed(let error): self.failed(error)
      default: break
      }
    }

    let parameters = NWParameters()
    parameters.includePeerToPeer = true
    let browser = NWBrowser(for: .bonjour(type: Self.serviceType, domain: nil), using: parameters)
    browser.stateUpdateHandler = { [weak self, weak browser] state in
      guard let self, let browser, self.browser === browser else { return }
      switch state {
      case .waiting(let error): self.waiting(error)
      case .failed(let error): self.failed(error)
      default: break
      }
    }
    browser.browseResultsChangedHandler = { [weak self, weak browser] _, changes in
      guard let self, let browser, self.browser === browser else { return }
      if changes.contains(where: { if case .added = $0 { return true } else { return false } }) {
        self.answer(granted: true, certain: true)
      }
    }

    self.listener = listener
    self.browser = browser
    policyHeld = false
    listener.start(queue: queue)
    browser.start(queue: queue)
  }

  private func stopProbe() {
    listener?.cancel()
    browser?.cancel()
    listener = nil
    browser = nil
    noAlert?.cancel()
    noAlert = nil
  }

  private func waiting(_ error: NWError) {
    guard Self.isPolicyDenied(error) else { return }
    policyHeld = true
    if answered { return answer(granted: false, certain: false) }
    // Not answered yet: the alert is coming, or up.
    if !alertUp && appActive { expectAlert() }
  }

  private func failed(_ error: NWError) {
    if Self.isPolicyDenied(error) { return answer(granted: false, certain: false) }
    answerAll { $0.reject(WifiError("unknown", "The local network probe failed: \(error)")) }
  }

  /// Denies unless the alert makes the app resign active within `alertGrace`.
  private func expectAlert() {
    guard noAlert == nil else { return }
    let item = DispatchWorkItem { [weak self] in
      guard let self, !self.alertUp else { return }
      self.noAlert = nil
      // No alert came, so none will: the user answered already.
      self.answer(granted: false, certain: true)
    }
    noAlert = item
    queue.asyncAfter(deadline: .now() + Self.alertGrace, execute: item)
  }

  private func appActiveChanged(_ active: Bool) {
    appActive = active
    guard browser != nil else { return }
    if !active {
      alertUp = true
      noAlert?.cancel()
      noAlert = nil
    } else if alertUp {
      // Back from the alert: iOS has the user's answer, and asks no more.
      alertUp = false
      answeredNow = true
      if policyHeld {
        // Denied before the alert: that denial predates the answer, which a new probe meets at once.
        stopProbe()
        startProbe()
      }
    } else if policyHeld && !answered {
      // Denied while the app was inactive for another reason: the alert still has to come.
      expectAlert()
    }
  }

  // MARK: - Answers

  /// `certain`: the user has answered the local network alert, so iOS will not ask again; remembered for later requests.
  private func answer(granted: Bool, certain: Bool) {
    if certain { UserDefaults.standard.set(true, forKey: Self.answeredKey) }
    let response: [String: Any] = ["status": granted ? "granted" : "denied", "canAskAgain": false]
    answerAll { $0.resolve(response) }
  }

  private func settle(_ requestId: Double, _ answer: (Reply) -> Void) {
    guard let waiter = waiters.removeValue(forKey: requestId) else { return }
    waiter.timeout?.cancel()
    answer(waiter.reply)
    if waiters.isEmpty { stopProbe() }
  }

  private func answerAll(_ answer: (Reply) -> Void) {
    for id in Array(waiters.keys) { settle(id, answer) }
    stopProbe()
  }

  private static func isPolicyDenied(_ error: NWError) -> Bool {
    if case .dns(let code) = error { return code == policyDenied }
    return false
  }

  /// Without its usage description iOS never prompts, and without the service type the probe cannot run.
  private static func missingDeclaration() -> WifiError? {
    let info = Bundle.main.infoDictionary ?? [:]
    guard info["NSLocalNetworkUsageDescription"] != nil else {
      return WifiError(
        "unsupported", "Info.plist has no NSLocalNetworkUsageDescription; set the config plugin's localNetworkPermission")
    }
    guard (info["NSBonjourServices"] as? [String])?.contains(serviceType) == true else {
      return WifiError(
        "unsupported", "NSBonjourServices does not list \(serviceType); set the config plugin's localNetworkPermission")
    }
    return nil
  }
}
