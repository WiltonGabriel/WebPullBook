import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveRateLimiter } from '../src/core/parser-engine.js';

test('AdaptiveRateLimiter adapts concurrency, Retry-After, latency backoff, and exits cooperative wait when Safe Mode is unchecked', async () => {
  const rl = new AdaptiveRateLimiter();
  assert.equal(rl.getEffectiveBatchWidth({ safeMode: false, requiresTab: false, configuredConcurrency: 4 }), 4);
  assert.equal(rl.getEffectiveBatchWidth({ safeMode: true, requiresTab: false, configuredConcurrency: 4 }), 1);
  assert.equal(rl.getEffectiveBatchWidth({ safeMode: false, requiresTab: true, configuredConcurrency: 4 }), 1);

  // Throttle + Retry-After steps up backoff and forces 1x concurrency
  rl.recordThrottle({ retryAfterSec: 12 });
  assert.ok(rl.backoffFactor >= 1.5);
  assert.equal(rl.getEffectiveBatchWidth({ safeMode: false, requiresTab: false, configuredConcurrency: 4 }), 1);
  const retryPlan = rl.computeNextWait({ safeMode: false, baseDelayMs: 200 });
  assert.equal(retryPlan.reason, 'retry-after');
  assert.ok(retryPlan.waitMs >= 11000 && retryPlan.waitMs <= 12500);

  // 5 consecutive fast successes relax backoff smoothly
  const beforeRelax = rl.backoffFactor;
  for (let i = 0; i < 5; i++) rl.recordSuccess(250);
  assert.ok(rl.backoffFactor < beforeRelax, 'Backoff should relax after 5 fast healthy responses');

  // Cooperative wait wakes immediately if user unchecks Safe Mode mid-wait
  let safeOn = true;
  setTimeout(() => {
    safeOn = false;
  }, 60);
  const t0 = Date.now();
  await rl.waitCooperatively(5000, { isSafeModeActive: () => safeOn });
  assert.ok(Date.now() - t0 < 1500, 'Cooperative wait should exit early when Safe Mode is disabled live');
});

test('AdaptiveRateLimiter scales backoff cleanly up to 3.5 without clamping down on slow responses and honors allowSafeModeEarlyExit=false', async () => {
  const rl = new AdaptiveRateLimiter();
  rl.backoffFactor = 3.5;
  rl.recordSuccess(4000);
  assert.equal(rl.backoffFactor, 3.5);
  rl.recordThrottle();
  assert.equal(rl.backoffFactor, 3.5);

  let safeOn = true;
  setTimeout(() => {
    safeOn = false;
  }, 40);
  const t0 = Date.now();
  await rl.waitCooperatively(180, {
    isSafeModeActive: () => safeOn,
    allowSafeModeEarlyExit: false
  });
  assert.ok(Date.now() - t0 >= 150, 'Mandatory Retry-After wait should not exit early on Safe Mode toggle');
});
