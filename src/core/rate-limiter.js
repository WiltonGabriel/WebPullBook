/**
 * Adaptive rate limiter powering Smart Safe Mode.
 * Adjusts pacing dynamically based on server latency, HTTP errors, Retry-After hints,
 * and live user toggles (enabling/disabling Safe Mode mid-export takes effect immediately).
 */
import { sleep } from './net-fetcher.js';

export class AdaptiveRateLimiter {
  constructor() {
    this.timestamps = [];
    this.backoffFactor = 1.0;
    this.recentLatencies = [];
    this.consecutiveFastOk = 0;
    this.retryAfterUntil = 0;
    this.nextBatchRestAt = 0;
    this.lastBatchBase = 0;
  }

  /**
   * Record a successful network fetch and gently relax backoff if the server is healthy.
   */
  recordSuccess(latencyMs = 0) {
    const now = Date.now();
    this.timestamps.push(now);
    while (this.timestamps.length > 0 && now - this.timestamps[0] >= 60000) {
      this.timestamps.shift();
    }
    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.recentLatencies.push(latencyMs);
      if (this.recentLatencies.length > 8) this.recentLatencies.shift();
    }

    const avgLatency = this.getAverageLatency();
    if (avgLatency >= 3500) {
      this.backoffFactor = Math.max(
        this.backoffFactor,
        Math.min(3.0, Number((this.backoffFactor * 1.25).toFixed(2)))
      );
      this.consecutiveFastOk = 0;
    } else if (avgLatency <= 1800) {
      this.consecutiveFastOk += 1;
      if (this.consecutiveFastOk >= 5 && this.backoffFactor > 1.0) {
        this.backoffFactor = Math.max(1.0, Number((this.backoffFactor * 0.85).toFixed(2)));
        this.consecutiveFastOk = 0;
      }
    }
  }

  /**
   * Record a rate-limit, anti-bot challenge, or transient server error to step up protection.
   */
  recordThrottle({ retryAfterSec = 0 } = {}) {
    this.consecutiveFastOk = 0;
    this.backoffFactor = Math.min(3.5, Number((Math.max(1.2, this.backoffFactor) * 1.5).toFixed(2)));
    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
      const cappedSec = Math.min(180, retryAfterSec);
      this.retryAfterUntil = Math.max(this.retryAfterUntil, Date.now() + cappedSec * 1000);
    }
  }

  getAverageLatency() {
    if (this.recentLatencies.length === 0) return 0;
    const total = this.recentLatencies.reduce((sum, v) => sum + v, 0);
    return Math.round(total / this.recentLatencies.length);
  }

  getRecentRpm(now = Date.now()) {
    while (this.timestamps.length > 0 && now - this.timestamps[0] >= 60000) {
      this.timestamps.shift();
    }
    return this.timestamps.length;
  }

  /**
   * Compute dynamic concurrency for the next wave (reacts live to toggling Safe Mode or SPA).
   */
  getEffectiveBatchWidth({ safeMode, requiresTab, configuredConcurrency = 1 }) {
    if (safeMode || requiresTab) return 1;
    const base = Math.max(1, Math.min(6, Number(configuredConcurrency) || 1));
    if (this.backoffFactor >= 1.5) return 1;
    return base;
  }

  /**
   * Plan the next wait window without sleeping yet (pure and unit-testable).
   */
  computeNextWait({
    safeMode = false,
    baseDelayMs = 0,
    minParserDelayMs = 0,
    safeRpm = 22,
    safeBatchSize = 25,
    networkFetchCount = 0,
    now = Date.now(),
    randomFn = Math.random
  }) {
    const effectiveBase = Math.max(0, Number(baseDelayMs) || 0, Number(minParserDelayMs) || 0);

    // Honor server Retry-After even if Safe Mode is off
    if (this.retryAfterUntil > now) {
      const retryMs = this.retryAfterUntil - now;
      this.retryAfterUntil = 0;
      return {
        waitMs: retryMs,
        reason: 'retry-after',
        label: `Respeitando Retry-After do servidor (${Math.ceil(retryMs / 1000)}s)...`
      };
    }

    if (!safeMode) {
      const delayMs = this.backoffFactor > 1.0 ? Math.round(effectiveBase * this.backoffFactor) : effectiveBase;
      return { waitMs: delayMs, reason: 'base', label: '' };
    }

    // Natural human-like rest pause between batches (varies around safeBatchSize +/- 20%)
    const batchBase = Math.max(0, Number(safeBatchSize) || 0);
    if (batchBase > 0) {
      if (this.lastBatchBase !== batchBase || this.nextBatchRestAt === 0) {
        this.lastBatchBase = batchBase;
        this.nextBatchRestAt = networkFetchCount + batchBase;
      }
      if (networkFetchCount > 0 && networkFetchCount >= this.nextBatchRestAt) {
        const jitterBatch = Math.max(3, Math.round(batchBase * (0.85 + randomFn() * 0.3)));
        this.nextBatchRestAt = networkFetchCount + jitterBatch;
        const restMs = Math.round((8000 + randomFn() * 5500) * Math.min(1.6, this.backoffFactor));
        return {
          waitMs: restMs,
          reason: 'batch-rest',
          label: `Modo Seguro: pausa natural de respiro (${Math.ceil(restMs / 1000)}s)...`
        };
      }
    }

    // Adaptive RPM ceiling (steps down when server latency/errors increase)
    const configuredRpm = Math.max(5, Number(safeRpm) || 22);
    const adaptiveRpm = Math.max(5, Math.floor(configuredRpm / this.backoffFactor));
    const currentRpm = this.getRecentRpm(now);
    if (currentRpm >= adaptiveRpm && this.timestamps.length > 0) {
      const rpmWaitMs = Math.max(500, 60500 - (now - this.timestamps[0]));
      return {
        waitMs: rpmWaitMs,
        reason: 'rpm-window',
        label: `Modo Seguro: ritmo ${currentRpm}/${adaptiveRpm} RPM — aguardando (${Math.ceil(rpmWaitMs / 1000)}s)...`
      };
    }

    // Adaptive jittered inter-chapter delay
    const minDelay = Math.max(effectiveBase, 1400);
    const latencyPenalty = this.getAverageLatency() >= 2500 ? 600 : 0;
    const rawDelay = (minDelay + latencyPenalty) * this.backoffFactor;
    const jitter = Math.round(randomFn() * Math.max(700, rawDelay * 0.45));
    const totalMs = Math.round(rawDelay + jitter);
    return {
      waitMs: totalMs,
      reason: 'adaptive-delay',
      label:
        this.backoffFactor > 1.05
          ? `Modo Seguro adaptativo (${this.backoffFactor.toFixed(1)}x): aguardando ${(totalMs / 1000).toFixed(1)}s...`
          : ''
    };
  }

  /**
   * Cooperative sleep: if the user unchecks Safe Mode mid-wait during a long rest/RPM pause,
   * wakes up cleanly within ~400ms instead of blocking the user.
   */
  async waitCooperatively(
    waitMs,
    { isSafeModeActive, signal, onTick = null, allowSafeModeEarlyExit = true } = {}
  ) {
    if (!waitMs || waitMs <= 0) return;
    const started = Date.now();
    const deadline = started + waitMs;
    const wasSafeMode = Boolean(isSafeModeActive?.());

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      if (allowSafeModeEarlyExit && wasSafeMode && isSafeModeActive && !isSafeModeActive()) {
        return;
      }
      onTick?.(remaining);
      await sleep(Math.min(remaining, 400), signal);
    }
  }
}
