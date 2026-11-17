/**
 * Resource-aware queues and cancellation (RFST-017).
 *
 * Roadmap evidence required (section 14): "Interactive text
 * preserved under contention." Section 12 (Phase 7) defines the
 * service priority policy for the shared Z13 / G14 resources:
 *   1. Highest interactive: current Gufo chat generation and
 *      user-requested STT.
 *   2. Next: second-brain retrieval needed to complete the
 *      current prompt (runs independently on G14).
 *   3. Next: AllTalk speech generation / playback on G14.
 *   4. Lower / queueable: ComfyUI image jobs on Z13, except an
 *      explicitly user-prioritized image request.
 *   5. Background: health polling, gallery cleanup, cache
 *      housekeeping, benchmarks.
 * The policy is implemented through bounded queues and
 * service-aware admission control rather than assuming OS/GPU
 * scheduling can enforce these priorities.
 *
 * This dependency-free core provides: request IDs, cancellation
 * tokens, job state tracking, idempotent submission (a duplicate
 * submit returns the existing job and never duplicates work),
 * bounded queues per service class with admission control,
 * cancellation, timeouts, finite retry with exponential
 * backoff, the common service states of section 12
 * (Ready / Loading / Busy / Offline / Degraded / Misconfigured),
 * degraded-mode behaviour per the section 12 failure matrix,
 * and the RFST-016 race guard: cleanup / unload for a service
 * must not run while a queued, running, or retry-scheduled job
 * for that service exists.
 *
 * Key acceptance property: interactive text (priority 1) has
 * its own bounded class queue and is always scheduled ahead of
 * lower-priority work, so image or background jobs filling their
 * queues can never starve, drop, or duplicate an interactive
 * text job.
 *
 * The clock is injected so timeouts, backoff, and retry timing
 * are deterministic in tests. Executors are injected per job or
 * per drain call (a real service client in production, a mock
 * in tests, exactly as RFST-013..016 injected their clients).
 * No live service is contacted by this core.
 *
 * Live contention proof is GATED: it needs the real services
 * running together (see campaign/PROGRESS.md), exactly as
 * RFST-013..016 gated their live legs.
 */

export const SERVICE_PRIORITIES = Object.freeze({
    'gufo-chat': 1,
    stt: 1,
    'second-brain': 2,
    alltalk: 3,
    comfyui: 4,
    background: 5,
});

export const SERVICE_STATES = Object.freeze([
    'Ready',
    'Loading',
    'Busy',
    'Offline',
    'Degraded',
    'Misconfigured',
]);

export const JOB_STATES = Object.freeze([
    'queued',
    'running',
    'retry-scheduled',
    'succeeded',
    'failed',
    'cancelled',
    'timed-out',
]);

export const TERMINAL_JOB_STATES = Object.freeze(['succeeded', 'failed', 'cancelled', 'timed-out']);

export const DEFAULT_QUEUE_LIMITS = Object.freeze({
    'gufo-chat': 4,
    stt: 4,
    'second-brain': 8,
    alltalk: 8,
    comfyui: 16,
    background: 16,
});

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BASE_BACKOFF_MS = 1_000;
export const DEFAULT_JOB_TIMEOUT_MS = 120_000;

/**
 * Section 12 failure matrix, as data: for each failed service,
 * what the user still gets. Text chat is the preserved core.
 */
export const FAILURE_MATRIX = Object.freeze({
    gufo: Object.freeze({ failedService: 'gufo-chat', textChat: false, voice: true, images: true, knowledge: true, message: 'Character inference unavailable; UI and chat history remain usable.' }),
    alltalk: Object.freeze({ failedService: 'alltalk', textChat: true, voice: false, images: true, knowledge: true, message: 'Text chat continues without voice.' }),
    stt: Object.freeze({ failedService: 'stt', textChat: true, voice: true, images: true, knowledge: true, message: 'Typing and manual message sending continue.' }),
    comfyui: Object.freeze({ failedService: 'comfyui', textChat: true, voice: true, images: false, knowledge: true, message: 'Chat and voice continue; image generation shows unavailable.' }),
    'second-brain': Object.freeze({ failedService: 'second-brain', textChat: true, voice: true, images: true, knowledge: false, message: 'Character chat proceeds without retrieved knowledge, with a knowledge-status indicator.' }),
    g14: Object.freeze({ failedService: 'g14-host', textChat: true, voice: false, images: true, knowledge: false, message: 'Voice and knowledge temporarily unavailable; Gufo and SillyTavern still operate.' }),
});

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Priority for a service class; unknown services are background.
 * @param {string} service Service class name
 * @returns {number} 1 (highest) .. 5 (background)
 */
export function priorityForService(service) {
    return Object.hasOwn(SERVICE_PRIORITIES, service) ? SERVICE_PRIORITIES[service] : 5;
}

/**
 * Exponential backoff delay for a 1-based retry attempt.
 * @param {number} attempt Retry attempt (1 = first retry)
 * @param {number} [baseMs] Base delay
 * @returns {number} Delay in ms: base * 2^(attempt-1)
 */
export function backoffDelayMs(attempt, baseMs = DEFAULT_BASE_BACKOFF_MS) {
    const n = Number.isFinite(attempt) && attempt >= 1 ? Math.floor(attempt) : 1;
    const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : DEFAULT_BASE_BACKOFF_MS;
    return base * (2 ** (n - 1));
}

/**
 * Creates a cancellation token. cancel() is idempotent; listeners
 * registered with onCancel fire once, immediately if already
 * cancelled.
 * @returns {{cancelled: boolean, cancel: Function, onCancel: Function, throwIfCancelled: Function}}
 */
export function createCancellationToken() {
    const listeners = [];
    const token = {
        cancelled: false,
        cancel() {
            if (token.cancelled) {
                return false;
            }
            token.cancelled = true;
            for (const fn of listeners.splice(0)) {
                fn();
            }
            return true;
        },
        onCancel(fn) {
            if (typeof fn !== 'function') {
                return;
            }
            if (token.cancelled) {
                fn();
            } else {
                listeners.push(fn);
            }
        },
        throwIfCancelled() {
            if (token.cancelled) {
                const error = new Error('cancelled');
                error.code = 'cancelled';
                throw error;
            }
        },
    };
    return token;
}

/**
 * Degraded mode for a set of service states, per the section 12
 * failure matrix. A service counts as failed when Offline (or,
 * for Gufo, also Misconfigured: inference cannot run).
 * @param {object} states Map of service class -> service state
 * @returns {{textChat: boolean, voice: boolean, images: boolean, knowledge: boolean, typingFallback: boolean, degraded: boolean, messages: string[]}}
 */
export function degradedModeFor(states = {}) {
    const safe = isPlainObject(states) ? states : {};
    const failed = (service) => safe[service] === 'Offline';
    const result = {
        textChat: true,
        voice: true,
        images: true,
        knowledge: true,
        typingFallback: true,
        degraded: false,
        messages: [],
    };
    if (failed('gufo-chat') || safe['gufo-chat'] === 'Misconfigured') {
        result.textChat = false;
        result.messages.push(FAILURE_MATRIX.gufo.message);
    }
    if (failed('alltalk')) {
        result.voice = false;
        result.messages.push(FAILURE_MATRIX.alltalk.message);
    }
    if (failed('stt')) {
        result.messages.push(FAILURE_MATRIX.stt.message);
    }
    if (failed('comfyui')) {
        result.images = false;
        result.messages.push(FAILURE_MATRIX.comfyui.message);
    }
    if (failed('second-brain')) {
        result.knowledge = false;
        result.messages.push(FAILURE_MATRIX['second-brain'].message);
    }
    result.degraded = result.messages.length > 0;
    return result;
}

/**
 * Creates one resource-aware queue manager.
 * @param {object} [options]
 * @param {object} [options.queueLimits] Per-service queue bounds
 *  (merged over DEFAULT_QUEUE_LIMITS).
 * @param {number} [options.maxRetries] Finite retry limit.
 * @param {number} [options.baseBackoffMs] Backoff base delay.
 * @param {number} [options.jobTimeoutMs] Per-attempt timeout,
 *  measured on the injected clock.
 * @param {Function} [options.now] Clock, defaults to Date.now.
 * @returns {object} Queue manager (see methods inline)
 */
export function createResourceQueue(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const limits = { ...DEFAULT_QUEUE_LIMITS, ...(isPlainObject(opts.queueLimits) ? opts.queueLimits : {}) };
    const maxRetries = Number.isFinite(opts.maxRetries) && opts.maxRetries >= 0 ? Math.floor(opts.maxRetries) : DEFAULT_MAX_RETRIES;
    const baseBackoffMs = Number.isFinite(opts.baseBackoffMs) && opts.baseBackoffMs > 0 ? opts.baseBackoffMs : DEFAULT_BASE_BACKOFF_MS;
    const jobTimeoutMs = Number.isFinite(opts.jobTimeoutMs) && opts.jobTimeoutMs > 0 ? opts.jobTimeoutMs : DEFAULT_JOB_TIMEOUT_MS;
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

    let counter = 0;
    const jobs = new Map(); // requestId -> job record
    const serviceStates = new Map(Object.keys(SERVICE_PRIORITIES).map((s) => [s, 'Ready']));

    function snapshot(job) {
        return {
            requestId: job.requestId,
            service: job.service,
            priority: job.priority,
            state: job.state,
            attempts: job.attempts,
            retries: job.retries,
            submittedAt: job.submittedAt,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            nextAttemptAt: job.nextAttemptAt,
            lastError: job.lastError,
            result: job.result,
            userPrioritized: job.userPrioritized,
            cancelled: job.token.cancelled,
        };
    }

    function queuedCount(service) {
        let n = 0;
        for (const job of jobs.values()) {
            if (job.service === service && (job.state === 'queued' || job.state === 'retry-scheduled')) {
                n++;
            }
        }
        return n;
    }

    function limitFor(service) {
        return Number.isFinite(limits[service]) && limits[service] > 0 ? limits[service] : 16;
    }

    /**
     * Submits a job. Idempotent: a duplicate requestId returns
     * the existing job (duplicate: true) and never enqueues or
     * runs work twice. Interactive (priority 1) jobs are always
     * admitted while their own class queue has room, regardless
     * of how full lower-priority queues are.
     * @param {object} request { requestId?, service, payload?,
     *  userPrioritized?, executor?, timeoutMs?, maxRetries? }
     * @returns {object} { ok, reason, duplicate?, job? }
     */
    function submit(request = {}) {
        const req = isPlainObject(request) ? request : {};
        const service = cleanString(req.service) || 'background';
        const requestId = cleanString(req.requestId) || `req-${++counter}`;
        const existing = jobs.get(requestId);
        if (existing) {
            return { ok: true, reason: 'duplicate_submission', duplicate: true, job: snapshot(existing) };
        }
        const state = serviceStates.get(service) ?? 'Ready';
        if (state === 'Offline' || state === 'Misconfigured') {
            return { ok: false, reason: state === 'Offline' ? 'service_offline' : 'service_misconfigured', duplicate: false };
        }
        if (queuedCount(service) >= limitFor(service)) {
            return { ok: false, reason: 'queue_full', duplicate: false };
        }
        let priority = priorityForService(service);
        const userPrioritized = req.userPrioritized === true;
        if (userPrioritized && priority > 2) {
            priority = 2; // Explicitly user-prioritized work jumps queueable classes.
        }
        const job = {
            requestId,
            service,
            priority,
            userPrioritized,
            payload: req.payload ?? null,
            executor: typeof req.executor === 'function' ? req.executor : null,
            timeoutMs: Number.isFinite(req.timeoutMs) && req.timeoutMs > 0 ? req.timeoutMs : jobTimeoutMs,
            maxRetries: Number.isFinite(req.maxRetries) && req.maxRetries >= 0 ? Math.floor(req.maxRetries) : maxRetries,
            token: createCancellationToken(),
            state: 'queued',
            attempts: 0,
            retries: 0,
            submittedAt: now(),
            startedAt: null,
            finishedAt: null,
            nextAttemptAt: null,
            lastError: null,
            result: undefined,
            seq: ++counter,
        };
        jobs.set(requestId, job);
        return { ok: true, reason: 'ok', duplicate: false, job: snapshot(job) };
    }

    /** Returns a job snapshot, or null. */
    function getJob(requestId) {
        const job = jobs.get(cleanString(requestId));
        return job ? snapshot(job) : null;
    }

    /** Returns the live cancellation token for a job, or null. */
    function getCancellationToken(requestId) {
        const job = jobs.get(cleanString(requestId));
        return job ? job.token : null;
    }

    /** Lists job snapshots, optionally filtered by service/state. */
    function listJobs(filter = {}) {
        const safe = isPlainObject(filter) ? filter : {};
        return [...jobs.values()]
            .filter((j) => (!safe.service || j.service === safe.service) && (!safe.state || j.state === safe.state))
            .sort((a, b) => a.seq - b.seq)
            .map(snapshot);
    }

    /**
     * Cancels a queued, running, or retry-scheduled job. A queued
     * job is removed from scheduling at once; a running job's
     * token fires and its eventual result is discarded.
     * @returns {object} { ok, reason, job? }
     */
    function cancel(requestId) {
        const job = jobs.get(cleanString(requestId));
        if (!job) {
            return { ok: false, reason: 'job_not_found' };
        }
        if (TERMINAL_JOB_STATES.includes(job.state)) {
            return { ok: false, reason: 'job_already_finished', job: snapshot(job) };
        }
        job.token.cancel();
        job.state = 'cancelled';
        job.finishedAt = now();
        job.nextAttemptAt = null;
        return { ok: true, reason: 'cancelled', job: snapshot(job) };
    }

    /** Sets a common service state (section 12). */
    function setServiceState(service, state) {
        if (!SERVICE_STATES.includes(state)) {
            return { ok: false, reason: 'unknown_service_state' };
        }
        serviceStates.set(cleanString(service) || 'background', state);
        return { ok: true, reason: 'ok', service, state };
    }

    /** Returns a service's current state (default Ready). */
    function getServiceState(service) {
        return serviceStates.get(cleanString(service)) ?? 'Ready';
    }

    /** Degraded mode for the current service states. */
    function degradedMode() {
        return degradedModeFor(Object.fromEntries(serviceStates));
    }

    /**
     * RFST-016 race guard: cleanup / unload for a service is
     * allowed only when no queued, running, or retry-scheduled
     * job for that service exists.
     * @returns {{allowed: boolean, reason: string, activeJobs: number}}
     */
    function canCleanup(service) {
        const name = cleanString(service);
        let active = 0;
        for (const job of jobs.values()) {
            if (job.service === name && (job.state === 'queued' || job.state === 'running' || job.state === 'retry-scheduled')) {
                active++;
            }
        }
        return active === 0
            ? { allowed: true, reason: 'ok', activeJobs: 0 }
            : { allowed: false, reason: 'active_jobs_exist', activeJobs: active };
    }

    /** Queue statistics per service class. */
    function stats() {
        const perService = {};
        for (const service of Object.keys(SERVICE_PRIORITIES)) {
            perService[service] = { queued: 0, running: 0, retryScheduled: 0, limit: limitFor(service), state: serviceStates.get(service) };
        }
        for (const job of jobs.values()) {
            const bucket = perService[job.service] ?? (perService[job.service] = { queued: 0, running: 0, retryScheduled: 0, limit: limitFor(job.service), state: serviceStates.get(job.service) ?? 'Ready' });
            if (job.state === 'queued') bucket.queued++;
            if (job.state === 'running') bucket.running++;
            if (job.state === 'retry-scheduled') bucket.retryScheduled++;
        }
        return { perService, totalJobs: jobs.size };
    }

    function nextQueuedJob() {
        let best = null;
        for (const job of jobs.values()) {
            if (job.state !== 'queued') {
                continue;
            }
            if (!best || job.priority < best.priority || (job.priority === best.priority && job.seq < best.seq)) {
                best = job;
            }
        }
        return best;
    }

    /** Moves due retry-scheduled jobs back to queued. */
    function tick() {
        let moved = 0;
        for (const job of jobs.values()) {
            if (job.state === 'retry-scheduled' && job.nextAttemptAt !== null && now() >= job.nextAttemptAt) {
                job.state = 'queued';
                job.nextAttemptAt = null;
                moved++;
            }
        }
        return { ok: true, reason: 'ok', moved };
    }

    function scheduleRetryOrFail(job, reason, timedOut) {
        if (job.token.cancelled) {
            job.state = 'cancelled';
            job.finishedAt = now();
            return snapshot(job);
        }
        if (job.retries < job.maxRetries) {
            job.retries++;
            job.state = 'retry-scheduled';
            job.nextAttemptAt = now() + backoffDelayMs(job.retries, baseBackoffMs);
            job.lastError = reason;
            return snapshot(job);
        }
        job.state = timedOut ? 'timed-out' : 'failed';
        job.lastError = reason;
        job.finishedAt = now();
        return snapshot(job);
    }

    /**
     * Runs the single highest-priority queued job (priority
     * order, FIFO within a priority). The executor is the job's
     * own executor or the argument; it receives
     * { requestId, service, payload, attempt, token, isCancelled }.
     * Timeout is judged on the injected clock after the executor
     * settles; a cancelled job's result is always discarded.
     * @param {Function} [executor] Fallback executor
     * @returns {Promise<object|null>} Job snapshot, or null when idle
     */
    async function runNext(executor) {
        tick();
        const job = nextQueuedJob();
        if (!job) {
            return null;
        }
        const run = typeof job.executor === 'function' ? job.executor : (typeof executor === 'function' ? executor : null);
        job.state = 'running';
        job.startedAt = now();
        job.attempts++;
        if (!run) {
            return scheduleRetryOrFail(job, 'no_executor', false);
        }
        const startedAt = now();
        try {
            const result = await run({
                requestId: job.requestId,
                service: job.service,
                payload: job.payload,
                attempt: job.attempts,
                token: job.token,
                isCancelled: () => job.token.cancelled,
            });
            if (job.token.cancelled || job.state === 'cancelled') {
                job.state = 'cancelled';
                job.finishedAt = now();
                return snapshot(job);
            }
            if (now() - startedAt > job.timeoutMs) {
                return scheduleRetryOrFail(job, 'job_timeout', true);
            }
            job.state = 'succeeded';
            job.result = result;
            job.finishedAt = now();
            job.lastError = null;
            return snapshot(job);
        } catch (error) {
            if (job.token.cancelled || job.state === 'cancelled' || (error && error.code === 'cancelled')) {
                job.state = 'cancelled';
                job.finishedAt = now();
                return snapshot(job);
            }
            const reason = error instanceof Error ? error.message : 'job_failed';
            if (now() - startedAt > job.timeoutMs) {
                return scheduleRetryOrFail(job, 'job_timeout', true);
            }
            return scheduleRetryOrFail(job, reason, false);
        }
    }

    /**
     * Runs queued jobs in priority order until the queues are
     * empty or maxJobs is reached. Retry-scheduled jobs run only
     * once their backoff has elapsed (call tick() after advancing
     * time, or pass { runRetries: true } to fast-forward due
     * retries through the injected clock's current time).
     * @param {Function} [executor] Fallback executor
     * @param {object} [options] { maxJobs }
     * @returns {Promise<object[]>} Snapshots in completion order
     */
    async function drain(executor, drainOptions = {}) {
        const maxJobs = isPlainObject(drainOptions) && Number.isFinite(drainOptions.maxJobs) && drainOptions.maxJobs > 0
            ? Math.floor(drainOptions.maxJobs)
            : 1000;
        const done = [];
        for (let i = 0; i < maxJobs; i++) {
            const result = await runNext(executor);
            if (!result) {
                break;
            }
            done.push(result);
            // A retry-scheduled job must not spin in-place: stop
            // draining when only future retries remain.
            if (!nextQueuedJob()) {
                break;
            }
        }
        return done;
    }

    return {
        submit,
        getJob,
        getCancellationToken,
        listJobs,
        cancel,
        setServiceState,
        getServiceState,
        degradedMode,
        canCleanup,
        stats,
        tick,
        runNext,
        drain,
    };
}
