/**
 * RFST-017 - Resource-aware queues and cancellation.
 *
 * Roadmap evidence required (section 14): "Interactive text
 * preserved under contention." Section 12 (Phase 7) defines the
 * priority policy (Gufo chat + user STT highest, second-brain
 * retrieval next, AllTalk next, ComfyUI image jobs queueable
 * except user-prioritized, background last), bounded queues with
 * admission control, request IDs, cancellation tokens, job state
 * tracking, idempotent submission, timeouts, finite retry with
 * exponential backoff, the common service states, the failure
 * behaviour matrix, and the RFST-016 race guard (no cleanup /
 * unload while a job for that service exists).
 *
 * The core (src/scheduling/resource-queue-core.js) is imported
 * and exercised for real with injected mock executors and an
 * injected fake clock; no live service is contacted.
 *
 * Live evidence status: proving contention against the real
 * Gufo / AllTalk / ComfyUI services running together is GATED
 * (campaign/PROGRESS.md), exactly as RFST-013..016 gated theirs.
 */
import { describe, test, expect } from '@jest/globals';

import {
    DEFAULT_BASE_BACKOFF_MS,
    DEFAULT_QUEUE_LIMITS,
    FAILURE_MATRIX,
    JOB_STATES,
    SERVICE_PRIORITIES,
    SERVICE_STATES,
    backoffDelayMs,
    createCancellationToken,
    createResourceQueue,
    degradedModeFor,
    priorityForService,
} from '../src/scheduling/resource-queue-core.js';

function makeClock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
}

const okExecutor = async (job) => `done:${job.requestId}`;

describe('service priority policy (section 12)', () => {
    test('priorities match the roadmap order exactly', () => {
        expect(SERVICE_PRIORITIES).toEqual({
            'gufo-chat': 1,
            stt: 1,
            'second-brain': 2,
            alltalk: 3,
            comfyui: 4,
            background: 5,
        });
        expect(priorityForService('gufo-chat')).toBe(1);
        expect(priorityForService('stt')).toBe(1);
        expect(priorityForService('second-brain')).toBe(2);
        expect(priorityForService('alltalk')).toBe(3);
        expect(priorityForService('comfyui')).toBe(4);
        expect(priorityForService('background')).toBe(5);
        expect(priorityForService('unknown-thing')).toBe(5);
    });

    test('jobs run in priority order, FIFO within a priority', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now });
        const order = [];
        const exec = async (job) => { order.push(job.requestId); return job.requestId; };
        queue.submit({ requestId: 'bg-1', service: 'background', executor: exec });
        queue.submit({ requestId: 'img-1', service: 'comfyui', executor: exec });
        queue.submit({ requestId: 'tts-1', service: 'alltalk', executor: exec });
        queue.submit({ requestId: 'rag-1', service: 'second-brain', executor: exec });
        queue.submit({ requestId: 'text-1', service: 'gufo-chat', executor: exec });
        queue.submit({ requestId: 'stt-1', service: 'stt', executor: exec });
        queue.submit({ requestId: 'text-2', service: 'gufo-chat', executor: exec });
        await queue.drain();
        expect(order).toEqual(['text-1', 'stt-1', 'text-2', 'rag-1', 'tts-1', 'img-1', 'bg-1']);
    });

    test('an explicitly user-prioritized image job jumps queueable classes', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now });
        const order = [];
        const exec = async (job) => { order.push(job.requestId); };
        queue.submit({ requestId: 'tts-1', service: 'alltalk', executor: exec });
        queue.submit({ requestId: 'img-plain', service: 'comfyui', executor: exec });
        const boosted = queue.submit({ requestId: 'img-hero', service: 'comfyui', userPrioritized: true, executor: exec });
        expect(boosted.job.priority).toBe(2);
        await queue.drain();
        expect(order).toEqual(['img-hero', 'tts-1', 'img-plain']);
    });
});

describe('bounded queues and admission control', () => {
    test('default limits exist for every service class', () => {
        for (const service of Object.keys(SERVICE_PRIORITIES)) {
            expect(DEFAULT_QUEUE_LIMITS[service]).toBeGreaterThan(0);
        }
    });

    test('a full class queue rejects further submissions of that class only', () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now, queueLimits: { comfyui: 2 } });
        expect(queue.submit({ requestId: 'i1', service: 'comfyui' }).ok).toBe(true);
        expect(queue.submit({ requestId: 'i2', service: 'comfyui' }).ok).toBe(true);
        expect(queue.submit({ requestId: 'i3', service: 'comfyui' })).toEqual(expect.objectContaining({ ok: false, reason: 'queue_full' }));
        expect(queue.submit({ requestId: 't1', service: 'gufo-chat' }).ok).toBe(true);
    });

    test('offline and misconfigured services reject at admission with diagnostics', () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now });
        queue.setServiceState('alltalk', 'Offline');
        expect(queue.submit({ requestId: 'v1', service: 'alltalk' })).toEqual(expect.objectContaining({ ok: false, reason: 'service_offline' }));
        queue.setServiceState('comfyui', 'Misconfigured');
        expect(queue.submit({ requestId: 'i1', service: 'comfyui' })).toEqual(expect.objectContaining({ ok: false, reason: 'service_misconfigured' }));
        expect(queue.submit({ requestId: 't1', service: 'gufo-chat' }).ok).toBe(true);
    });

    test('submissions get request IDs automatically when none is given', () => {
        const queue = createResourceQueue({ now: makeClock().now });
        const a = queue.submit({ service: 'background' });
        const b = queue.submit({ service: 'background' });
        expect(a.job.requestId).toBeTruthy();
        expect(b.job.requestId).toBeTruthy();
        expect(a.job.requestId).not.toBe(b.job.requestId);
    });
});

describe('KEY ACCEPTANCE: interactive text preserved under contention', () => {
    test('text completes when image and background queues are saturated', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now, queueLimits: { comfyui: 3, background: 3, 'gufo-chat': 2 } });
        const ran = [];
        const exec = async (job) => { ran.push(job.requestId); return `ok:${job.requestId}`; };
        // Saturate the lower-priority queues first.
        for (let i = 0; i < 3; i++) queue.submit({ requestId: `img-${i}`, service: 'comfyui', executor: exec });
        for (let i = 0; i < 3; i++) queue.submit({ requestId: `bg-${i}`, service: 'background', executor: exec });
        expect(queue.submit({ requestId: 'img-overflow', service: 'comfyui', executor: exec }).ok).toBe(false);
        // Interactive text is still admitted...
        const text = queue.submit({ requestId: 'text-1', service: 'gufo-chat', executor: exec });
        expect(text.ok).toBe(true);
        // ...runs first, succeeds exactly once, and is never dropped.
        const done = await queue.drain();
        expect(ran[0]).toBe('text-1');
        expect(ran.filter((id) => id === 'text-1')).toHaveLength(1);
        expect(queue.getJob('text-1').state).toBe('succeeded');
        expect(queue.getJob('text-1').result).toBe('ok:text-1');
        expect(done).toHaveLength(7);
        expect(queue.listJobs().every((j) => j.state === 'succeeded')).toBe(true);
    });

    test('a duplicate text submission under contention never duplicates the job', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now });
        let runs = 0;
        const exec = async () => { runs++; return 'reply'; };
        queue.submit({ requestId: 'img-1', service: 'comfyui', executor: okExecutor });
        const first = queue.submit({ requestId: 'text-1', service: 'gufo-chat', executor: exec });
        const dup = queue.submit({ requestId: 'text-1', service: 'gufo-chat', executor: exec });
        expect(first.duplicate).toBe(false);
        expect(dup).toEqual(expect.objectContaining({ ok: true, duplicate: true, reason: 'duplicate_submission' }));
        expect(dup.job.requestId).toBe('text-1');
        await queue.drain();
        expect(runs).toBe(1);
        expect(queue.stats().totalJobs).toBe(2);
    });
});

describe('idempotent submission and job state tracking', () => {
    test('job states cover the full lifecycle vocabulary', () => {
        expect(JOB_STATES).toEqual(expect.arrayContaining(['queued', 'running', 'retry-scheduled', 'succeeded', 'failed', 'cancelled', 'timed-out']));
    });

    test('a job is tracked from queued through running to succeeded', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now });
        let seenState = null;
        queue.submit({
            requestId: 'j1', service: 'second-brain',
            executor: async (job) => { seenState = queue.getJob(job.requestId).state; return 42; },
        });
        expect(queue.getJob('j1').state).toBe('queued');
        await queue.runNext();
        expect(seenState).toBe('running');
        const job = queue.getJob('j1');
        expect(job.state).toBe('succeeded');
        expect(job.result).toBe(42);
        expect(job.attempts).toBe(1);
        expect(job.finishedAt).not.toBeNull();
    });

    test('duplicate submission after completion still returns the same job', async () => {
        const queue = createResourceQueue({ now: makeClock().now });
        queue.submit({ requestId: 'j1', service: 'background', executor: okExecutor });
        await queue.drain();
        const dup = queue.submit({ requestId: 'j1', service: 'background', executor: okExecutor });
        expect(dup.duplicate).toBe(true);
        expect(dup.job.state).toBe('succeeded');
        expect(queue.stats().totalJobs).toBe(1);
    });

    test('unknown jobs read as null and stats report per-class counts', () => {
        const queue = createResourceQueue({ now: makeClock().now });
        expect(queue.getJob('nope')).toBeNull();
        queue.submit({ requestId: 'a', service: 'comfyui' });
        queue.submit({ requestId: 'b', service: 'comfyui' });
        const stats = queue.stats();
        expect(stats.perService.comfyui.queued).toBe(2);
        expect(stats.totalJobs).toBe(2);
    });
});

describe('cancellation tokens and cancel', () => {
    test('a token fires listeners once and throwIfCancelled throws after cancel', () => {
        const token = createCancellationToken();
        let fired = 0;
        token.onCancel(() => { fired++; });
        expect(token.cancel()).toBe(true);
        expect(token.cancel()).toBe(false);
        expect(fired).toBe(1);
        expect(() => token.throwIfCancelled()).toThrow('cancelled');
        let late = 0;
        token.onCancel(() => { late++; });
        expect(late).toBe(1);
    });

    test('cancelling a queued job removes it from scheduling', async () => {
        const queue = createResourceQueue({ now: makeClock().now });
        const ran = [];
        const exec = async (job) => { ran.push(job.requestId); };
        queue.submit({ requestId: 'keep', service: 'background', executor: exec });
        queue.submit({ requestId: 'drop', service: 'background', executor: exec });
        expect(queue.cancel('drop')).toEqual(expect.objectContaining({ ok: true, reason: 'cancelled' }));
        await queue.drain();
        expect(ran).toEqual(['keep']);
        expect(queue.getJob('drop').state).toBe('cancelled');
    });

    test('cancelling a running job discards its result', async () => {
        const queue = createResourceQueue({ now: makeClock().now });
        queue.submit({
            requestId: 'run-1', service: 'comfyui',
            executor: async (job) => { job.token.cancel(); return 'should-be-discarded'; },
        });
        const result = await queue.runNext();
        expect(result.state).toBe('cancelled');
        expect(result.result).toBeUndefined();
    });

    test('a job cancelled through its token while awaiting never succeeds', async () => {
        const queue = createResourceQueue({ now: makeClock().now });
        queue.submit({
            requestId: 'run-2', service: 'alltalk',
            executor: async (job) => { queue.cancel('run-2'); return 'late'; },
        });
        const result = await queue.runNext();
        expect(result.state).toBe('cancelled');
        expect(queue.getCancellationToken('run-2').cancelled).toBe(true);
    });

    test('cancelling a finished or unknown job is reported honestly', async () => {
        const queue = createResourceQueue({ now: makeClock().now });
        expect(queue.cancel('ghost')).toEqual(expect.objectContaining({ ok: false, reason: 'job_not_found' }));
        queue.submit({ requestId: 'j1', service: 'background', executor: okExecutor });
        await queue.drain();
        expect(queue.cancel('j1')).toEqual(expect.objectContaining({ ok: false, reason: 'job_already_finished' }));
    });
});

describe('timeout and finite retry with exponential backoff', () => {
    test('backoff doubles per attempt', () => {
        expect(backoffDelayMs(1)).toBe(DEFAULT_BASE_BACKOFF_MS);
        expect(backoffDelayMs(2)).toBe(DEFAULT_BASE_BACKOFF_MS * 2);
        expect(backoffDelayMs(3)).toBe(DEFAULT_BASE_BACKOFF_MS * 4);
        expect(backoffDelayMs(2, 500)).toBe(1000);
    });

    test('a failing job retries with backoff, then succeeds when due', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now, maxRetries: 3, baseBackoffMs: 1000 });
        let calls = 0;
        queue.submit({
            requestId: 'flaky', service: 'second-brain',
            executor: async () => { calls++; if (calls < 3) throw new Error('upstream_busy'); return 'recovered'; },
        });
        const first = await queue.runNext();
        expect(first.state).toBe('retry-scheduled');
        expect(first.nextAttemptAt).toBe(clock.now() + 1000);
        expect(await queue.runNext()).toBeNull(); // not due yet: no spin, no starvation of others
        clock.advance(1000);
        const second = await queue.runNext();
        expect(second.state).toBe('retry-scheduled');
        expect(second.nextAttemptAt).toBe(clock.now() + 2000);
        clock.advance(2000);
        const third = await queue.runNext();
        expect(third.state).toBe('succeeded');
        expect(third.result).toBe('recovered');
        expect(calls).toBe(3);
    });

    test('retries are finite: a permanently failing job ends failed', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now, maxRetries: 2, baseBackoffMs: 100 });
        let calls = 0;
        queue.submit({ requestId: 'bad', service: 'background', executor: async () => { calls++; throw new Error('always_down'); } });
        await queue.runNext();
        clock.advance(100); await queue.runNext();
        clock.advance(200);
        const last = await queue.runNext();
        expect(last.state).toBe('failed');
        expect(last.lastError).toBe('always_down');
        expect(calls).toBe(3); // 1 initial + 2 retries, then it stops
        expect(await queue.runNext()).toBeNull();
    });

    test('a job exceeding its timeout is timed out after finite retries', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now, maxRetries: 1, baseBackoffMs: 100 });
        queue.submit({
            requestId: 'slow', service: 'comfyui', timeoutMs: 5000,
            executor: async () => { clock.advance(6000); return 'too-late'; },
        });
        const first = await queue.runNext();
        expect(first.state).toBe('retry-scheduled');
        expect(first.lastError).toBe('job_timeout');
        clock.advance(100);
        const last = await queue.runNext();
        expect(last.state).toBe('timed-out');
    });

    test('a job inside its timeout succeeds normally', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now });
        queue.submit({
            requestId: 'fast', service: 'gufo-chat', timeoutMs: 5000,
            executor: async () => { clock.advance(4999); return 'reply'; },
        });
        const result = await queue.runNext();
        expect(result.state).toBe('succeeded');
        expect(result.result).toBe('reply');
    });

    test('a cancelled retry-scheduled job never runs again', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now, maxRetries: 5, baseBackoffMs: 100 });
        let calls = 0;
        queue.submit({ requestId: 'r1', service: 'background', executor: async () => { calls++; throw new Error('x'); } });
        await queue.runNext();
        expect(queue.getJob('r1').state).toBe('retry-scheduled');
        queue.cancel('r1');
        clock.advance(100000);
        expect(await queue.runNext()).toBeNull();
        expect(calls).toBe(1);
    });
});

describe('common service states and degraded mode (failure matrix)', () => {
    test('the six common service states are exactly the roadmap set', () => {
        expect(SERVICE_STATES).toEqual(['Ready', 'Loading', 'Busy', 'Offline', 'Degraded', 'Misconfigured']);
        const queue = createResourceQueue({ now: makeClock().now });
        for (const state of SERVICE_STATES) {
            expect(queue.setServiceState('alltalk', state).ok).toBe(true);
            expect(queue.getServiceState('alltalk')).toBe(state);
        }
        expect(queue.setServiceState('alltalk', 'Sleepy')).toEqual(expect.objectContaining({ ok: false, reason: 'unknown_service_state' }));
    });

    test('AllTalk offline: text chat continues without voice', () => {
        const mode = degradedModeFor({ alltalk: 'Offline' });
        expect(mode.textChat).toBe(true);
        expect(mode.voice).toBe(false);
        expect(mode.degraded).toBe(true);
        expect(mode.messages).toContain(FAILURE_MATRIX.alltalk.message);
    });

    test('ComfyUI offline: chat and voice continue, images unavailable', () => {
        const mode = degradedModeFor({ comfyui: 'Offline' });
        expect(mode.textChat).toBe(true);
        expect(mode.voice).toBe(true);
        expect(mode.images).toBe(false);
    });

    test('second brain offline: chat proceeds without knowledge, indicator noted', () => {
        const mode = degradedModeFor({ 'second-brain': 'Offline' });
        expect(mode.textChat).toBe(true);
        expect(mode.knowledge).toBe(false);
        expect(mode.messages.join(' ')).toMatch(/knowledge-status indicator/);
    });

    test('STT offline: typing fallback continues', () => {
        const mode = degradedModeFor({ stt: 'Offline' });
        expect(mode.textChat).toBe(true);
        expect(mode.typingFallback).toBe(true);
    });

    test('Gufo offline: inference unavailable but the mode is explicit, not silent', () => {
        const mode = degradedModeFor({ 'gufo-chat': 'Offline' });
        expect(mode.textChat).toBe(false);
        expect(mode.messages).toContain(FAILURE_MATRIX.gufo.message);
    });

    test('all Ready means not degraded, and the manager view agrees', () => {
        expect(degradedModeFor({}).degraded).toBe(false);
        const queue = createResourceQueue({ now: makeClock().now });
        expect(queue.degradedMode().degraded).toBe(false);
        queue.setServiceState('comfyui', 'Offline');
        const mode = queue.degradedMode();
        expect(mode.images).toBe(false);
        expect(mode.textChat).toBe(true);
    });
});

describe('RFST-016 race guard: cleanup blocked while jobs exist', () => {
    test('cleanup is allowed for an idle service and blocked by a queued job', () => {
        const queue = createResourceQueue({ now: makeClock().now });
        expect(queue.canCleanup('comfyui')).toEqual({ allowed: true, reason: 'ok', activeJobs: 0 });
        queue.submit({ requestId: 'img-1', service: 'comfyui', executor: okExecutor });
        const guard = queue.canCleanup('comfyui');
        expect(guard.allowed).toBe(false);
        expect(guard.reason).toBe('active_jobs_exist');
        expect(guard.activeJobs).toBe(1);
        // Other services are unaffected by ComfyUI work.
        expect(queue.canCleanup('alltalk').allowed).toBe(true);
    });

    test('cleanup stays blocked while a job runs or awaits retry, and frees after completion', async () => {
        const clock = makeClock();
        const queue = createResourceQueue({ now: clock.now, maxRetries: 1, baseBackoffMs: 100 });
        let guardDuringRun = null;
        queue.submit({
            requestId: 'img-1', service: 'comfyui',
            executor: async () => { guardDuringRun = queue.canCleanup('comfyui'); throw new Error('boom'); },
        });
        await queue.runNext();
        expect(guardDuringRun.allowed).toBe(false);
        expect(queue.getJob('img-1').state).toBe('retry-scheduled');
        expect(queue.canCleanup('comfyui').allowed).toBe(false);
        clock.advance(100);
        await queue.runNext();
        expect(queue.getJob('img-1').state).toBe('failed');
        expect(queue.canCleanup('comfyui').allowed).toBe(true);
    });

    test('cancelling the last queued job frees cleanup at once', () => {
        const queue = createResourceQueue({ now: makeClock().now });
        queue.submit({ requestId: 'img-1', service: 'comfyui', executor: okExecutor });
        queue.cancel('img-1');
        expect(queue.canCleanup('comfyui').allowed).toBe(true);
    });
});
