/**
 * RFST-016 - ComfyUI unload-on-idle lifecycle.
 *
 * Roadmap evidence required (section 14): "Memory returns to
 * defined idle state." Section 10 defines that state: the
 * ComfyUI service stays alive and healthy while image model
 * weights are released and reclaimable memory is freed once no
 * active or queued jobs remain, after a tunable idle grace
 * period. Section 13's verification matrix names ComfyUI
 * workflow routing, queueing, idle unload race conditions, and
 * cancellation - the race and cancellation cases live here.
 *
 * The lifecycle core (src/media/comfyui-idle-lifecycle-core.js)
 * is imported and exercised for real against a mock ComfyUI
 * client implementing the RFST-013 endpoint contract:
 * GET /queue, GET /system_stats, POST /free with
 * { unload_models: true, free_memory: true }. The mock holds
 * fake VRAM numbers only; unloading restores free VRAM to the
 * idle baseline, exactly the observable the roadmap asks for.
 * An injected fake clock makes every race deterministic.
 *
 * Live evidence status: a real unload needs ComfyUI running; it
 * was NOT running and was not started for this package, so the
 * live leg is GATED (campaign/PROGRESS.md), exactly as
 * RFST-013/014/015 gated theirs.
 */
import { describe, test, expect } from '@jest/globals';

import {
    DEFAULT_IDLE_TIMEOUT_MS,
    IDLE_STATE_DEFINITION,
    createIdleLifecycleManager,
    decideUnload,
    isAtIdleState,
    queueCounts,
    vramSummary,
} from '../src/media/comfyui-idle-lifecycle-core.js';

const GB = 1024 * 1024 * 1024;
const IDLE_FREE = 15 * GB;
const BUSY_FREE = 4 * GB;

function makeClock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeMockComfy({ freeFails = false } = {}) {
    const mock = {
        queueRunning: [],
        queuePending: [],
        vramFree: IDLE_FREE,
        freeCalls: [],
        unreachable: false,
        freeGate: null,
        async getQueue() {
            if (mock.unreachable) { throw new Error('down'); }
            return { queue_running: [...mock.queueRunning], queue_pending: [...mock.queuePending] };
        },
        async getSystemStats() {
            if (mock.unreachable) { throw new Error('down'); }
            return { devices: [{ name: 'fake-gpu', vram_total: 16 * GB, vram_free: mock.vramFree }] };
        },
        async free(body) {
            mock.freeCalls.push(body);
            if (mock.freeGate) { await mock.freeGate; }
            if (freeFails) { throw new Error('free failed'); }
            mock.vramFree = IDLE_FREE;
            return {};
        },
    };
    return mock;
}

function makeManager(mock, clock, extra = {}) {
    return createIdleLifecycleManager({ client: mock, now: clock.now, idleTimeoutMs: 60_000, ...extra });
}

describe('queue and VRAM observation parsing', () => {
    test('queueCounts reads running and pending arrays', () => {
        expect(queueCounts({ queue_running: [1, 2], queue_pending: [3] })).toEqual({ running: 2, pending: 1, total: 3 });
    });
    test('queueCounts tolerates missing or malformed payloads', () => {
        expect(queueCounts(null).total).toBe(0);
        expect(queueCounts({}).total).toBe(0);
        expect(queueCounts('nope').total).toBe(0);
    });
    test('vramSummary sums devices and rejects empty stats', () => {
        const s = vramSummary({ devices: [{ vram_total: 10, vram_free: 4 }, { vram_total: 10, vram_free: 6 }] });
        expect(s).toEqual({ vramTotal: 20, vramFree: 10, deviceCount: 2 });
        expect(vramSummary({ devices: [] })).toBeNull();
        expect(vramSummary(null)).toBeNull();
    });
});

describe('defined idle state', () => {
    const idleObs = { reachable: true, queue: { queue_running: [], queue_pending: [] }, stats: { devices: [{ vram_total: 16 * GB, vram_free: IDLE_FREE }] } };
    test('the definition keeps the server alive with no model residency', () => {
        expect(IDLE_STATE_DEFINITION.serverAlive).toBe(true);
        expect(IDLE_STATE_DEFINITION.modelsLoaded).toBe(false);
        expect(IDLE_STATE_DEFINITION.queueRunning).toBe(0);
    });
    test('empty queue and baseline VRAM is the idle state', () => {
        expect(isAtIdleState(idleObs, { baselineVramFree: IDLE_FREE })).toBe(true);
    });
    test('VRAM still held by models is not the idle state', () => {
        const busy = { ...idleObs, stats: { devices: [{ vram_total: 16 * GB, vram_free: BUSY_FREE }] } };
        expect(isAtIdleState(busy, { baselineVramFree: IDLE_FREE })).toBe(false);
    });
    test('a queued job or an unreachable server is not the idle state', () => {
        expect(isAtIdleState({ ...idleObs, queue: { queue_running: [], queue_pending: [1] } }, {})).toBe(false);
        expect(isAtIdleState({ ...idleObs, reachable: false }, {})).toBe(false);
    });
    test('small VRAM drift within tolerance still counts as idle', () => {
        const drift = { ...idleObs, stats: { devices: [{ vram_total: 16 * GB, vram_free: IDLE_FREE - 1024 }] } };
        expect(isAtIdleState(drift, { baselineVramFree: IDLE_FREE })).toBe(true);
    });
});

describe('pure unload decision', () => {
    test('busy always defers, even past the timeout', () => {
        expect(decideUnload({ inFlight: 1, idleForMs: 10 * DEFAULT_IDLE_TIMEOUT_MS }).action).toBe('defer-busy');
        expect(decideUnload({ queue: { queue_pending: [1] }, idleForMs: 10 * DEFAULT_IDLE_TIMEOUT_MS }).action).toBe('defer-busy');
    });
    test('within the grace period it waits; past it, it unloads', () => {
        expect(decideUnload({ idleForMs: 1000, idleTimeoutMs: 60_000 }).action).toBe('wait');
        expect(decideUnload({ idleForMs: 60_000, idleTimeoutMs: 60_000 }).action).toBe('unload');
    });
    test('already idle is a no-op', () => {
        expect(decideUnload({ idleForMs: 999_999, alreadyIdle: true }).action).toBe('none-already-idle');
    });
});

describe('manager lifecycle', () => {
    test('after the grace period it unloads and verifies the idle state', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        const m = makeManager(mock, clock);
        await m.tick();
        mock.vramFree = BUSY_FREE;
        m.jobStarted(); m.jobFinished();
        clock.advance(61_000);
        const result = await m.tick();
        expect(result.action).toBe('unloaded');
        expect(result.verified).toBe(true);
        expect(result.state).toBe('idle');
        expect(mock.freeCalls).toEqual([{ unload_models: true, free_memory: true }]);
        expect(mock.vramFree).toBe(IDLE_FREE);
    });
    test('within the grace period no unload is sent', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        const m = makeManager(mock, clock);
        m.jobStarted(); m.jobFinished();
        clock.advance(30_000);
        const result = await m.tick();
        expect(result.action).toBe('wait');
        expect(result.state).toBe('idle-pending');
        expect(mock.freeCalls).toHaveLength(0);
    });
    test('an in-flight local job defers the unload past the timeout', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        const m = makeManager(mock, clock);
        m.jobStarted();
        clock.advance(10 * 60_000);
        const result = await m.tick();
        expect(result.action).toBe('defer-busy');
        expect(mock.freeCalls).toHaveLength(0);
    });
    test('a remotely queued job defers the unload', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        mock.queuePending = [['job-1']];
        const m = makeManager(mock, clock);
        clock.advance(10 * 60_000);
        const result = await m.tick();
        expect(result.action).toBe('defer-busy');
        expect(mock.freeCalls).toHaveLength(0);
    });
    test('repeated idle ticks issue no further free calls', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        const m = makeManager(mock, clock);
        await m.tick();
        mock.vramFree = BUSY_FREE;
        m.jobStarted(); m.jobFinished();
        clock.advance(61_000);
        await m.tick();
        clock.advance(10 * 60_000);
        const again = await m.tick();
        expect(again.action).toBe('none-already-idle');
        expect(mock.freeCalls).toHaveLength(1);
        expect(m.getSnapshot().unloadCount).toBe(1);
    });
    test('a second activity cycle unloads a second time', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        const m = makeManager(mock, clock);
        await m.tick();
        for (let cycle = 0; cycle < 2; cycle++) {
            mock.vramFree = BUSY_FREE;
            m.jobStarted(); m.jobFinished();
            clock.advance(61_000);
            const r = await m.tick();
            expect(r.action).toBe('unloaded');
        }
        expect(mock.freeCalls).toHaveLength(2);
        expect(m.getSnapshot().unloadCount).toBe(2);
    });
    test('an unreachable endpoint is reported, never faked as idle', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        mock.unreachable = true;
        const m = makeManager(mock, clock);
        const result = await m.tick();
        expect(result.action).toBe('error');
        expect(result.state).toBe('unreachable');
        expect(mock.freeCalls).toHaveLength(0);
    });
    test('a failed free call is reported and retried on a later tick', async () => {
        const clock = makeClock(); const mock = makeMockComfy({ freeFails: true });
        const m = makeManager(mock, clock);
        m.jobStarted(); m.jobFinished();
        clock.advance(61_000);
        const result = await m.tick();
        expect(result.action).toBe('error');
        expect(result.reason).toBe('free_request_failed');
        expect(m.getSnapshot().unloadCount).toBe(0);
    });
    test('a missing client is an honest error', async () => {
        const m = createIdleLifecycleManager({});
        const result = await m.tick();
        expect(result.action).toBe('error');
        expect(result.reason).toBe('client_missing_or_incomplete');
    });
});

describe('race conditions and cancellation', () => {
    test('a job arriving during unload is kept and flagged for reload', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        let releaseFree;
        mock.freeGate = new Promise((resolve) => { releaseFree = resolve; });
        const m = makeManager(mock, clock);
        await m.tick();
        mock.vramFree = BUSY_FREE;
        m.jobStarted(); m.jobFinished();
        clock.advance(61_000);
        const ticking = m.tick();
        // Let the tick reach the in-flight /free call, then a job lands.
        await new Promise((resolve) => setImmediate(resolve));
        expect(m.isUnloading()).toBe(true);
        m.jobStarted();
        releaseFree();
        const result = await ticking;
        expect(result.action).toBe('unloaded');
        expect(result.reason).toBe('job_arrived_during_unload_reload_needed');
        expect(result.needsReloadAfterUnload).toBe(true);
        expect(result.inFlight).toBe(1);
        expect(result.state).toBe('active');
    });
    test('new activity cancels a pending unload and restarts the grace period', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        const m = makeManager(mock, clock);
        m.jobStarted(); m.jobFinished();
        clock.advance(30_000);
        await m.tick();
        expect(m.getSnapshot().state).toBe('idle-pending');
        m.recordActivity();
        expect(m.getSnapshot().state).toBe('active');
        clock.advance(30_000);
        const result = await m.tick();
        expect(result.action).toBe('wait');
        expect(mock.freeCalls).toHaveLength(0);
    });
    test('explicit cancelPendingUnload clears a scheduled unload', () => {
        const clock = makeClock(); const mock = makeMockComfy();
        const m = makeManager(mock, clock);
        m.jobStarted(); m.jobFinished();
        expect(m.getSnapshot().state).toBe('idle-pending');
        expect(m.cancelPendingUnload()).toEqual({ cancelled: true, reason: 'pending_unload_cancelled' });
        expect(m.getSnapshot().state).toBe('active');
    });
    test('cancelling with nothing pending is an honest no-op', () => {
        const clock = makeClock(); const mock = makeMockComfy();
        const m = makeManager(mock, clock);
        expect(m.cancelPendingUnload()).toEqual({ cancelled: false, reason: 'no_pending_unload' });
    });
    test('an in-flight unload reports itself not cancellable', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        let releaseFree;
        mock.freeGate = new Promise((resolve) => { releaseFree = resolve; });
        const m = makeManager(mock, clock);
        m.jobStarted(); m.jobFinished();
        clock.advance(61_000);
        const ticking = m.tick();
        await new Promise((resolve) => setImmediate(resolve));
        expect(m.cancelPendingUnload()).toEqual({ cancelled: false, reason: 'unload_in_flight_not_cancellable' });
        m.jobFinished();
        releaseFree();
        await ticking;
    });
    test('the idle baseline is captured from the first quiet observation', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        const m = makeManager(mock, clock);
        await m.tick();
        expect(m.getSnapshot().baselineVramFree).toBe(IDLE_FREE);
    });
    test('an explicit baseline is honoured over capture', async () => {
        const clock = makeClock(); const mock = makeMockComfy();
        const m = makeManager(mock, clock, { baselineVramFree: 12 * GB });
        await m.tick();
        expect(m.getSnapshot().baselineVramFree).toBe(12 * GB);
    });
});
