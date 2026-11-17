/**
 * ComfyUI unload-on-idle lifecycle (RFST-016).
 *
 * Roadmap evidence required (section 14): "Memory returns to
 * defined idle state." Section 10 (Phase 5) defines the idle
 * state precisely: the ComfyUI HTTP service STAYS ALIVE and
 * healthy, but image model weights are released and reclaimable
 * memory is freed once there are no active or queued jobs, after
 * a tunable short idle grace period (default prioritizes freeing
 * memory for text inference). Section 13's verification matrix
 * names ComfyUI workflow routing, queueing, idle unload race
 * conditions, and cancellation.
 *
 * This dependency-free core manages that lifecycle against the
 * RFST-013 ComfyUI endpoint contract:
 *  - GET  /queue        -> { queue_running: [...], queue_pending: [...] }
 *  - GET  /system_stats -> { devices: [{ vram_total, vram_free, ... }] }
 *  - POST /free         -> { unload_models: true, free_memory: true }
 *    releases model weights and frees cached memory while the
 *    server process stays up.
 * The client is injected (a fetch-based client in production, a
 * mock in tests, exactly as RFST-013 mocked ComfyUI), and the
 * clock/timers are injected so every race is deterministic.
 *
 * Race rules (the heart of this package):
 *  - Unload NEVER starts while a job is in flight locally or the
 *    remote queue is non-empty; a busy observation defers it.
 *  - A job arriving while an unload is scheduled cancels the
 *    schedule; a job arriving while an unload is IN FLIGHT is
 *    recorded, the unload is allowed to settle (a /free call
 *    cannot be un-sent), and the manager immediately returns to
 *    the active state reporting that the job's model will need
 *    reloading - the job is never lost and never reported as
 *    running against unloaded weights without that flag.
 *  - Cancellation: a pending unload can be cancelled at any time
 *    (cancelPendingUnload); an in-flight unload reports
 *    cancellable: false honestly.
 *  - Repeated idle cycles are idempotent: once at the defined
 *    idle state, further idle ticks issue no further /free calls
 *    until new activity has been observed.
 *
 * Defined idle state (isAtIdleState): server reachable, zero
 * running and zero pending queue entries, and device free VRAM
 * at or above the recorded idle baseline minus a tolerance
 * (the baseline is captured from the first stats observation
 * made while no model work had been seen, or set explicitly).
 *
 * Live unload is GATED: ComfyUI was not started for this package
 * (see campaign/PROGRESS.md), exactly as RFST-013/014/015 gated
 * their live legs. This core only manages lifecycle decisions
 * and calls the injected client; tests prove it against a mock.
 */

export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
export const DEFAULT_VRAM_TOLERANCE_BYTES = 64 * 1024 * 1024;

export const LIFECYCLE_STATES = Object.freeze([
    'active',
    'idle-pending',
    'unloading',
    'idle',
    'unreachable',
]);

/** The defined idle state this lifecycle returns memory to. */
export const IDLE_STATE_DEFINITION = Object.freeze({
    serverAlive: true,
    modelsLoaded: false,
    queueRunning: 0,
    queuePending: 0,
    description: 'Healthy ComfyUI HTTP service, no image model residency, empty queue.',
});

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInt(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Extracts queue counts from a ComfyUI /queue payload.
 * @param {object} queue Raw /queue response
 * @returns {{running: number, pending: number, total: number}}
 */
export function queueCounts(queue) {
    if (!isPlainObject(queue)) {
        return { running: 0, pending: 0, total: 0 };
    }
    const running = Array.isArray(queue.queue_running) ? queue.queue_running.length : nonNegativeInt(queue.running);
    const pending = Array.isArray(queue.queue_pending) ? queue.queue_pending.length : nonNegativeInt(queue.pending);
    return { running, pending, total: running + pending };
}

/**
 * Sums VRAM figures across devices in a /system_stats payload.
 * @param {object} stats Raw /system_stats response
 * @returns {{vramTotal: number, vramFree: number, deviceCount: number}|null}
 */
export function vramSummary(stats) {
    if (!isPlainObject(stats) || !Array.isArray(stats.devices) || stats.devices.length === 0) {
        return null;
    }
    let vramTotal = 0;
    let vramFree = 0;
    for (const device of stats.devices) {
        if (!isPlainObject(device)) {
            continue;
        }
        vramTotal += Number.isFinite(device.vram_total) ? device.vram_total : 0;
        vramFree += Number.isFinite(device.vram_free) ? device.vram_free : 0;
    }
    return { vramTotal, vramFree, deviceCount: stats.devices.length };
}

/**
 * Decides whether an observation matches the defined idle state:
 * reachable server, empty queue, and free VRAM back at (within
 * tolerance of) the idle baseline when a baseline is known.
 * @param {object} observation { reachable, queue, stats }
 * @param {object} [options] { baselineVramFree, toleranceBytes }
 * @returns {boolean}
 */
export function isAtIdleState(observation, options = {}) {
    if (!isPlainObject(observation) || observation.reachable !== true) {
        return false;
    }
    if (queueCounts(observation.queue).total !== 0) {
        return false;
    }
    const baseline = isPlainObject(options) && Number.isFinite(options.baselineVramFree) ? options.baselineVramFree : null;
    if (baseline === null) {
        return true;
    }
    const summary = vramSummary(observation.stats);
    if (!summary) {
        return false;
    }
    const tolerance = Number.isFinite(options.toleranceBytes) ? options.toleranceBytes : DEFAULT_VRAM_TOLERANCE_BYTES;
    return summary.vramFree >= baseline - tolerance;
}

/**
 * Pure unload decision for one observation at one moment.
 * @param {object} input { inFlight, queue, idleForMs, idleTimeoutMs, alreadyIdle }
 * @returns {{action: string, reason: string}} action is one of
 *  'unload' | 'wait' | 'defer-busy' | 'none-already-idle'
 */
export function decideUnload(input = {}) {
    const safe = isPlainObject(input) ? input : {};
    const busy = nonNegativeInt(safe.inFlight) > 0 || queueCounts(safe.queue).total > 0;
    if (busy) {
        return { action: 'defer-busy', reason: 'jobs_active_or_queued' };
    }
    if (safe.alreadyIdle === true) {
        return { action: 'none-already-idle', reason: 'already_at_idle_state' };
    }
    const timeout = Number.isFinite(safe.idleTimeoutMs) ? safe.idleTimeoutMs : DEFAULT_IDLE_TIMEOUT_MS;
    const idleFor = Number.isFinite(safe.idleForMs) ? safe.idleForMs : 0;
    if (idleFor >= timeout) {
        return { action: 'unload', reason: 'idle_timeout_elapsed' };
    }
    return { action: 'wait', reason: 'within_idle_grace_period' };
}

/**
 * Creates the idle-lifecycle manager.
 * @param {object} options
 * @param {object} options.client Injected ComfyUI client with
 *  async getQueue(), getSystemStats(), free(body) methods.
 * @param {number} [options.idleTimeoutMs] Grace period before unload.
 * @param {number} [options.baselineVramFree] Explicit idle baseline.
 * @param {number} [options.toleranceBytes] Baseline tolerance.
 * @param {Function} [options.now] Clock, defaults to Date.now.
 * @returns {object} Manager (see methods inline)
 */
export function createIdleLifecycleManager(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const client = isPlainObject(opts.client) ? opts.client : null;
    const idleTimeoutMs = Number.isFinite(opts.idleTimeoutMs) && opts.idleTimeoutMs >= 0 ? opts.idleTimeoutMs : DEFAULT_IDLE_TIMEOUT_MS;
    const toleranceBytes = Number.isFinite(opts.toleranceBytes) ? opts.toleranceBytes : DEFAULT_VRAM_TOLERANCE_BYTES;
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

    let state = 'active';
    let lastActivityAt = now();
    let inFlight = 0;
    let unloadInFlight = false;
    let jobArrivedDuringUnload = false;
    let needsReloadAfterUnload = false;
    let baselineVramFree = Number.isFinite(opts.baselineVramFree) ? opts.baselineVramFree : null;
    let unloadCount = 0;
    let lastUnloadAt = null;
    let lastError = null;
    let lastQueue = { running: 0, pending: 0, total: 0 };

    function snapshot() {
        return {
            state,
            inFlight,
            queue: { ...lastQueue },
            idleForMs: Math.max(0, now() - lastActivityAt),
            idleTimeoutMs,
            baselineVramFree,
            unloadCount,
            lastUnloadAt,
            needsReloadAfterUnload,
            lastError,
            idleStateDefinition: IDLE_STATE_DEFINITION,
        };
    }

    /** Records any image activity; cancels a pending unload. */
    function recordActivity() {
        lastActivityAt = now();
        needsReloadAfterUnload = false;
        if (state === 'idle-pending' || state === 'idle') {
            state = 'active';
        }
        return snapshot();
    }

    /** Marks a job started (jobStarted/jobFinished bracket work). */
    function jobStarted() {
        inFlight++;
        if (unloadInFlight) {
            jobArrivedDuringUnload = true;
        }
        recordActivity();
        return snapshot();
    }

    /** Marks a job finished; the idle clock runs from here. */
    function jobFinished() {
        inFlight = Math.max(0, inFlight - 1);
        if (inFlight === 0) {
            lastActivityAt = now();
            if (state === 'active') {
                state = 'idle-pending';
            }
        }
        return snapshot();
    }

    /**
     * Cancels a scheduled (not yet started) unload.
     * @returns {{cancelled: boolean, reason: string}}
     */
    function cancelPendingUnload() {
        if (unloadInFlight) {
            return { cancelled: false, reason: 'unload_in_flight_not_cancellable' };
        }
        if (state === 'idle-pending') {
            state = 'active';
            lastActivityAt = now();
            return { cancelled: true, reason: 'pending_unload_cancelled' };
        }
        return { cancelled: false, reason: 'no_pending_unload' };
    }

    /**
     * One lifecycle tick: observe the endpoint, decide, and act.
     * Never throws; failures land in lastError and the snapshot.
     * @returns {Promise<object>} Tick result + snapshot fields
     */
    async function tick() {
        if (!client || typeof client.getQueue !== 'function' || typeof client.free !== 'function') {
            state = 'unreachable';
            lastError = 'client_missing_or_incomplete';
            return { action: 'error', reason: lastError, ...snapshot() };
        }
        let queue;
        let stats = null;
        try {
            queue = await client.getQueue();
            if (typeof client.getSystemStats === 'function') {
                stats = await client.getSystemStats();
            }
        } catch {
            state = 'unreachable';
            lastError = 'endpoint_unreachable';
            return { action: 'error', reason: lastError, ...snapshot() };
        }
        lastQueue = queueCounts(queue);
        const summary = vramSummary(stats);
        if (baselineVramFree === null && summary && lastQueue.total === 0 && inFlight === 0 && unloadCount === 0) {
            baselineVramFree = summary.vramFree;
        }
        const busy = inFlight > 0 || lastQueue.total > 0;
        if (busy) {
            if (unloadInFlight) {
                jobArrivedDuringUnload = true;
            }
            recordActivity();
            return { action: 'defer-busy', reason: 'jobs_active_or_queued', ...snapshot() };
        }
        const atIdle = isAtIdleState({ reachable: true, queue, stats }, { baselineVramFree, toleranceBytes });
        if (state === 'idle' && atIdle) {
            return { action: 'none-already-idle', reason: 'already_at_idle_state', ...snapshot() };
        }
        const decision = decideUnload({
            inFlight,
            queue,
            idleForMs: now() - lastActivityAt,
            idleTimeoutMs,
            alreadyIdle: state === 'idle' && atIdle,
        });
        if (decision.action !== 'unload') {
            if (decision.action === 'wait' && state === 'active') {
                state = 'idle-pending';
            }
            return { action: decision.action, reason: decision.reason, ...snapshot() };
        }
        // Begin unload. A job arriving during the await is caught
        // by jobStarted()/tick() setting jobArrivedDuringUnload.
        state = 'unloading';
        unloadInFlight = true;
        jobArrivedDuringUnload = false;
        try {
            await client.free({ unload_models: true, free_memory: true });
        } catch {
            unloadInFlight = false;
            state = 'idle-pending';
            lastActivityAt = now();
            lastError = 'free_request_failed';
            return { action: 'error', reason: lastError, ...snapshot() };
        }
        unloadInFlight = false;
        unloadCount++;
        lastUnloadAt = now();
        lastError = null;
        if (jobArrivedDuringUnload || inFlight > 0) {
            needsReloadAfterUnload = true;
            state = 'active';
            lastActivityAt = now();
            return { action: 'unloaded', reason: 'job_arrived_during_unload_reload_needed', ...snapshot() };
        }
        // Verify memory returned to the defined idle state when
        // stats are available; report honestly either way.
        let verified = atIdle;
        if (typeof client.getSystemStats === 'function') {
            try {
                const after = await client.getSystemStats();
                verified = isAtIdleState({ reachable: true, queue: { queue_running: [], queue_pending: [] }, stats: after }, { baselineVramFree, toleranceBytes });
            } catch {
                verified = false;
            }
        }
        state = verified ? 'idle' : 'idle-pending';
        return { action: 'unloaded', reason: verified ? 'idle_state_verified' : 'unload_sent_idle_unverified', verified, ...snapshot() };
    }

    return {
        recordActivity,
        jobStarted,
        jobFinished,
        cancelPendingUnload,
        tick,
        getSnapshot: snapshot,
        isUnloading: () => unloadInFlight,
    };
}
