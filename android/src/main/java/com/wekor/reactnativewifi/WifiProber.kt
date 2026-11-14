package com.wekor.reactnativewifi

import android.net.Network
import android.net.NetworkCapabilities
import android.os.SystemClock
import android.system.ErrnoException
import android.system.OsConstants
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Whether a device accepts a TCP connection, for `probe` and `joinNetwork`'s `waitFor`. Each probe runs on its
 * own thread, as `Socket.connect` blocks; cancelling closes its socket, which ends a `connect` at once. The timeout
 * and a cancel answer on their own, without that thread: a DNS lookup can neither be closed nor limited, and one
 * that hangs leaves only its thread behind.
 *
 * A probe connects through the network the app's traffic goes to: the joined network while there is one (also when
 * the join did not bind the process: that is where the device is), else the network the process is bound to, else
 * the default. While nothing answers, the kernel resends the SYN on its own, so one `connect` waits for the device
 * to come up; only a failure at once (refused: the device is up, its service is not; no route yet) is tried again.
 */
class WifiProber(private val central: WifiCentral) {
  private inner class Probe(val id: Double, val host: String, val port: Int, val timeoutMs: Long, val reply: Reply) {
    /** Answered, by the probe, its timeout or a cancel: the probe's thread stops at its next step. */
    @Volatile var cancelled = false

    @Volatile var socket: Socket? = null

    /** Why the last attempt failed, as `probe`'s `cause` names it, and the network it went through. */
    @Volatile var cause = "timeout"

    @Volatile var network: Network? = null

    val timeout = Runnable {
      reply.resolve(mapOf("reachable" to false, "cause" to cause, "vpn" to viaVpn(network)))
      stop(this)
    }
  }

  private val probes = ConcurrentHashMap<Double, Probe>()
  private val executor: ExecutorService =
    Executors.newCachedThreadPool { runnable -> Thread(runnable, "ReactNativeWifi-probe").apply { isDaemon = true } }

  /** `timeout` `0` waits without limit. */
  fun start(id: Double, host: String, port: Int, timeout: Double, reply: Reply) {
    val probe = Probe(id, host, port, timeout.toLong(), reply)
    probes[id] = probe
    if (probe.timeoutMs > 0) central.handler.postDelayed(probe.timeout, probe.timeoutMs)
    executor.execute { run(probe) }
  }

  fun cancel(id: Double) {
    val probe = probes[id] ?: return
    probe.reply.reject(WifiException("cancelled", "Connecting to ${probe.host}:${probe.port} was aborted"))
    stop(probe)
  }

  /** Ends `probe` once answered: its thread stops at its next step, a `connect` at once. */
  private fun stop(probe: Probe) {
    probe.cancelled = true
    probes.remove(probe.id)
    central.handler.removeCallbacks(probe.timeout)
    probe.socket?.closeQuietly()
  }

  fun close() {
    for (id in probes.keys) cancel(id)
    executor.shutdown()
  }

  private fun run(probe: Probe) {
    val deadline = if (probe.timeoutMs > 0) SystemClock.elapsedRealtime() + probe.timeoutMs else null
    try {
      while (!probe.cancelled) {
        val remaining = deadline?.let { it - SystemClock.elapsedRealtime() }
        // The timeout answers.
        if (remaining != null && remaining <= 0) return
        val network = central.joiner.joinedNetwork ?: central.connectivity.boundNetworkForProcess
        probe.network = network
        val cause = attempt(probe, network, remaining)
        if (probe.cancelled) return
        if (cause == null) {
          probe.reply.resolve(mapOf("reachable" to true))
          return stop(probe)
        }
        probe.cause = cause
        Thread.sleep(RETRY_PAUSE_MS)
      }
    } catch (_: InterruptedException) {
      // The module was torn down; `close` answered.
    }
  }

  /** Null once connected; else why the attempt failed, as `probe`'s `cause` names it. */
  private fun attempt(probe: Probe, network: Network?, remaining: Long?): String? {
    val address =
      try {
        // Through `network`, whose DNS server may be the device's own; an IP address resolves to itself.
        network?.getByName(probe.host) ?: InetAddress.getByName(probe.host)
      } catch (_: UnknownHostException) {
        return "unresolved"
      }
    val socket = Socket()
    probe.socket = socket
    try {
      // Answered while the lookup ran; set after `socket`, so `stop` closes it either way.
      if (probe.cancelled) return "timeout"
      network?.bindSocket(socket)
      // `connect` takes 0 as no limit, as the caller does.
      socket.connect(InetSocketAddress(address, probe.port), remaining?.coerceIn(1, Int.MAX_VALUE.toLong())?.toInt() ?: 0)
      return null
    } catch (_: SocketTimeoutException) {
      return "timeout"
    } catch (error: IOException) {
      return causeOf(error)
    } finally {
      probe.socket = null
      socket.closeQuietly()
    }
  }

  /** Android wraps the `connect` errno in the exception's cause. */
  private fun causeOf(error: IOException) =
    when ((error.cause as? ErrnoException)?.errno) {
      OsConstants.ECONNREFUSED -> "refused"
      OsConstants.ETIMEDOUT -> "timeout"
      else -> "no-route"
    }

  private fun viaVpn(network: Network?): Boolean {
    val connectivity = central.connectivity
    val used = network ?: connectivity.activeNetwork ?: return false
    return connectivity.getNetworkCapabilities(used)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
  }

  private fun Socket.closeQuietly() {
    try {
      close()
    } catch (_: IOException) {}
  }

  companion object {
    /** Between attempts that failed at once, so a refused port is not hammered in a tight loop. */
    private const val RETRY_PAUSE_MS = 250L
  }
}
