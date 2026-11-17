/**
 * RFST-022 - Optional hands-free VAD / barge-in.
 *
 * Roadmap evidence required (section 14): "Stable
 * end-to-end voice turn-taking." Section 8 (Phase 3)
 * acceptance: hands-free is added only after push-to-talk
 * is stable (RFST-009 DONE); it is an explicit user opt-in;
 * barge-in stops playback without rewriting chat history;
 * talk-over is handled and TTS / AllTalk playback cannot
 * feed back into the microphone as user speech; a single
 * utterance never yields duplicate user turns; typed and
 * push-to-talk fallbacks stay available when STT is down.
 *
 * The core (src/voice/hands-free-core.js) is imported and
 * exercised for real against mock audio frames, a mock STT
 * client, and a mock playback controller. An injected fake
 * clock makes thresholds, hangover, and sustain windows
 * deterministic.
 *
 * Live evidence status: no STT backend is installed on the
 * Z13 (RFST-008: Gufo ASR route 404, whisper not installed)
 * and live turn-taking also needs live TTS playback, so the
 * live leg is GATED (campaign/PROGRESS.md), exactly as
 * RFST-009 and RFST-013..021 gated theirs.
 */
import { describe, test, expect } from '@jest/globals';

import {
    DEFAULT_BARGE_IN_SUSTAIN_MS,
    DEFAULT_BARGE_IN_THRESHOLD,
    DEFAULT_ENABLED,
    DEFAULT_SILENCE_HANGOVER_MS,
    DEFAULT_SPEECH_THRESHOLD,
    HANDS_FREE_STATES,
    classifyFrameLevel,
    createHandsFreeSession,
} from '../src/voice/hands-free-core.js';

function makeClock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeMockStt({ text = 'hail and well met', failTimes = 0 } = {}) {
    const mock = {
        calls: [],
        failuresLeft: failTimes,
        async transcribe(request) {
            mock.calls.push(request);
            if (mock.failuresLeft > 0) {
                mock.failuresLeft--;
                throw new Error('stt_unavailable');
            }
            return { text };
        },
    };
    return mock;
}

function makePlayback() {
    const playback = {
        playing: false,
        stopCalls: 0,
        isPlaying() { return playback.playing; },
        stop() { playback.stopCalls++; playback.playing = false; },
    };
    return playback;
}

function makeSession(extra = {}) {
    const clock = makeClock();
    const stt = extra.stt || makeMockStt();
    const playback = extra.playback || makePlayback();
    const history = extra.history || [{ role: 'assistant', text: 'well met, wanderer' }];
    const sent = [];
    const barges = [];
    const session = createHandsFreeSession({
        client: stt,
        playback,
        history,
        now: clock.now,
        onSend: (m) => sent.push(m),
        onBargeIn: (b) => barges.push(b),
        ...(extra.sessionOptions || {}),
    });
    return { session, clock, stt, playback, history, sent, barges };
}

function speak(session, clock, { level = 0.7, frames = 5, stepMs = 100 } = {}) {
    let result = null;
    for (let i = 0; i < frames; i++) {
        result = session.ingestFrame({ level, at: clock.now() });
        clock.advance(stepMs);
    }
    return result;
}

function goSilent(session, clock, ms = DEFAULT_SILENCE_HANGOVER_MS + 100) {
    session.ingestFrame({ level: 0.05, at: clock.now() });
    clock.advance(ms);
    return session.tick(clock.now());
}

describe('opt-in: hands-free is off by default', () => {
    test('defaults are disabled with the documented thresholds', () => {
        expect(DEFAULT_ENABLED).toBe(false);
        expect(DEFAULT_SPEECH_THRESHOLD).toBe(0.5);
        expect(DEFAULT_BARGE_IN_THRESHOLD).toBe(0.85);
        expect(DEFAULT_SILENCE_HANGOVER_MS).toBe(800);
        expect(DEFAULT_BARGE_IN_SUSTAIN_MS).toBe(300);
        expect(HANDS_FREE_STATES).toContain('listening');
        expect(HANDS_FREE_STATES).toContain('speech');
    });
    test('a disabled session ignores every frame and stays in push-to-talk mode', () => {
        const { session, clock } = makeSession();
        const result = session.ingestFrame({ level: 0.9, at: clock.now() });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('hands_free_disabled');
        expect(result.event).toBe('ignored_disabled');
        expect(session.snapshot().mode).toBe('push_to_talk');
        expect(session.snapshot().utteranceCount).toBe(0);
    });
    test('start() without the opt-in is rejected', () => {
        const { session } = makeSession();
        expect(session.start().reason).toBe('hands_free_disabled');
    });
    test('enable() is the explicit opt-in and disable() returns to push-to-talk', () => {
        const { session, clock } = makeSession();
        expect(session.enable().ok).toBe(true);
        expect(session.snapshot().enabled).toBe(true);
        expect(session.snapshot().mode).toBe('hands_free');
        expect(session.snapshot().state).toBe('listening');
        expect(speak(session, clock).event).toBe('speech');
        expect(session.disable().ok).toBe(true);
        expect(session.snapshot().mode).toBe('push_to_talk');
        expect(session.ingestFrame({ level: 0.9, at: clock.now() }).reason).toBe('hands_free_disabled');
    });
    test('a session constructed with enabled:true starts opted in', () => {
        const { session } = makeSession({ sessionOptions: { enabled: true } });
        expect(session.snapshot().enabled).toBe(true);
        expect(session.start().ok).toBe(true);
    });
});

describe('VAD speech detection', () => {
    test('classifyFrameLevel separates silence, speech and loud frames', () => {
        expect(classifyFrameLevel(0.1)).toBe('silence');
        expect(classifyFrameLevel(0.6)).toBe('speech');
        expect(classifyFrameLevel(0.95)).toBe('loud');
        expect(classifyFrameLevel(Number.NaN)).toBe('silence');
        expect(classifyFrameLevel(0.6, { speechThreshold: 0.7 })).toBe('silence');
    });
    test('speech frames open an utterance and silence below the threshold does not', () => {
        const { session, clock } = makeSession();
        session.enable();
        expect(session.ingestFrame({ level: 0.1, at: clock.now() }).event).toBe('idle');
        const started = session.ingestFrame({ level: 0.7, at: clock.now() });
        expect(started.event).toBe('speech_started');
        expect(started.state).toBe('speech');
        expect(started.utteranceId).toBe(1);
    });
    test('speech ends only after the full silence hangover elapses', () => {
        const { session, clock } = makeSession();
        session.enable();
        speak(session, clock, { frames: 5 });
        session.ingestFrame({ level: 0.05, at: clock.now() });
        clock.advance(400);
        expect(session.tick(clock.now()).event).toBe('tick');
        expect(session.snapshot().state).toBe('silence');
        clock.advance(500);
        const ended = session.tick(clock.now());
        expect(ended.event).toBe('speech_ended');
        expect(ended.state).toBe('utterance_ready');
    });
    test('a short mid-utterance pause does not split one utterance into two turns', async () => {
        const { session, clock, stt, sent } = makeSession();
        session.enable();
        speak(session, clock, { frames: 3 });
        session.ingestFrame({ level: 0.05, at: clock.now() });
        clock.advance(300);
        speak(session, clock, { frames: 3 });
        goSilent(session, clock);
        expect(session.snapshot().utteranceCount).toBe(1);
        expect((await session.transcribePending()).ok).toBe(true);
        expect(stt.calls).toHaveLength(1);
        expect(session.send().ok).toBe(true);
        expect(sent).toHaveLength(1);
    });
    test('a blip shorter than the minimum speech span is dropped as noise', () => {
        const { session, clock } = makeSession();
        session.enable();
        session.ingestFrame({ level: 0.7, at: clock.now() });
        clock.advance(50);
        const dropped = goSilent(session, clock);
        expect(dropped.event).toBe('utterance_dropped');
        expect(session.snapshot().droppedUtterances).toBe(1);
        expect(session.snapshot().state).toBe('listening');
    });
    test('custom thresholds and hangover are honored', () => {
        const { session, clock } = makeSession({ sessionOptions: { speechThreshold: 0.2, silenceHangoverMs: 200 } });
        session.enable();
        expect(session.ingestFrame({ level: 0.3, at: clock.now() }).event).toBe('speech_started');
        expect(session.snapshot().thresholds.speechThreshold).toBe(0.2);
        expect(session.snapshot().thresholds.silenceHangoverMs).toBe(200);
    });
    test('turn timing is tracked on the injected clock', async () => {
        const { session, clock } = makeSession();
        session.enable();
        speak(session, clock, { frames: 5, stepMs: 100 });
        goSilent(session, clock);
        await session.transcribePending();
        const { timing } = session.snapshot();
        expect(timing.listeningStartedAt).not.toBeNull();
        expect(timing.speechStartedAt).not.toBeNull();
        expect(timing.speechEndedAt).not.toBeNull();
        expect(timing.speechDurationMs).toBe(400);
        expect(timing.transcriptionStartedAt).not.toBeNull();
        expect(timing.roundTripMs).not.toBeNull();
    });
});

describe('end-to-end turn-taking against mock STT', () => {
    test('one utterance is transcribed once and sent exactly once', async () => {
        const { session, clock, stt, sent } = makeSession();
        session.enable();
        speak(session, clock);
        goSilent(session, clock);
        const transcribed = await session.transcribePending();
        expect(transcribed.ok).toBe(true);
        expect(transcribed.state).toBe('preview');
        expect(transcribed.transcript).toBe('hail and well met');
        expect(stt.calls).toHaveLength(1);
        expect(stt.calls[0].utteranceId).toBe(1);
        expect(session.send().ok).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toBe('hail and well met');
        expect(sent[0].source).toBe('hands_free');
    });
    test('a second transcribe for the same utterance is rejected as a duplicate', async () => {
        const { session, clock, stt } = makeSession();
        session.enable();
        speak(session, clock);
        goSilent(session, clock);
        await session.transcribePending();
        const again = await session.transcribePending();
        expect(again.ok).toBe(false);
        expect(again.duplicate).toBe(true);
        expect(stt.calls).toHaveLength(1);
    });
    test('a second send for the same utterance is rejected as a duplicate', async () => {
        const { session, clock, sent } = makeSession();
        session.enable();
        speak(session, clock);
        goSilent(session, clock);
        await session.transcribePending();
        expect(session.send().ok).toBe(true);
        const again = session.send();
        expect(again.duplicate).toBe(true);
        expect(again.reason).toBe('duplicate_send_rejected');
        expect(sent).toHaveLength(1);
    });
    test('transcribe with no closed utterance is rejected honestly', async () => {
        const { session } = makeSession();
        session.enable();
        expect((await session.transcribePending()).reason).toBe('no_utterance_to_transcribe');
    });
    test('frames arriving while an utterance is pending are ignored, not a new turn', async () => {
        const { session, clock } = makeSession();
        session.enable();
        speak(session, clock);
        goSilent(session, clock);
        const result = session.ingestFrame({ level: 0.7, at: clock.now() });
        expect(result.event).toBe('ignored_pending');
        expect(session.snapshot().utteranceCount).toBe(1);
    });
    test('nextTurn() after a send reopens listening for a fresh utterance', async () => {
        const { session, clock, sent } = makeSession();
        session.enable();
        speak(session, clock);
        goSilent(session, clock);
        await session.transcribePending();
        session.send();
        expect(session.nextTurn().ok).toBe(true);
        expect(session.snapshot().state).toBe('listening');
        speak(session, clock);
        goSilent(session, clock);
        await session.transcribePending();
        expect(session.send().ok).toBe(true);
        expect(sent).toHaveLength(2);
        expect(sent[1].sendToken).not.toBe(sent[0].sendToken);
    });
});

describe('barge-in and the feedback guard', () => {
    test('ordinary playback levels are suppressed as echo and never open a turn', () => {
        const { session, clock, playback } = makeSession();
        session.enable();
        playback.playing = true;
        for (let i = 0; i < 6; i++) {
            expect(session.ingestFrame({ level: 0.7, at: clock.now() }).event).toBe('echo_suppressed');
            clock.advance(100);
        }
        expect(session.snapshot().echoSuppressedFrames).toBe(6);
        expect(session.snapshot().utteranceCount).toBe(0);
        expect(playback.stopCalls).toBe(0);
    });
    test('a short loud burst during playback does not barge in', () => {
        const { session, clock, playback } = makeSession();
        session.enable();
        playback.playing = true;
        session.ingestFrame({ level: 0.95, at: clock.now() });
        clock.advance(100);
        const result = session.ingestFrame({ level: 0.95, at: clock.now() });
        expect(result.event).toBe('echo_suppressed');
        expect(playback.stopCalls).toBe(0);
        expect(session.snapshot().bargeInCount).toBe(0);
    });
    test('sustained loud speech during playback barges in and stops playback exactly once', async () => {
        const { session, clock, playback, barges, sent } = makeSession();
        session.enable();
        playback.playing = true;
        session.ingestFrame({ level: 0.95, at: clock.now() });
        clock.advance(200);
        session.ingestFrame({ level: 0.95, at: clock.now() });
        clock.advance(200);
        const result = session.ingestFrame({ level: 0.95, at: clock.now() });
        expect(result.event).toBe('barge_in');
        expect(result.bargedIn).toBe(true);
        expect(playback.stopCalls).toBe(1);
        expect(playback.playing).toBe(false);
        expect(barges).toHaveLength(1);
        expect(session.snapshot().bargeInCount).toBe(1);
        // The barged-in speech is the start of a real user turn.
        speak(session, clock, { level: 0.7, frames: 3 });
        goSilent(session, clock);
        expect((await session.transcribePending()).ok).toBe(true);
        expect(session.send().ok).toBe(true);
        expect(sent).toHaveLength(1);
        expect(playback.stopCalls).toBe(1);
    });
    test('barge-in never modifies or rewrites chat history', () => {
        const history = [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'well met' }];
        const before = JSON.stringify(history);
        const { session, clock, playback } = makeSession({ history });
        session.enable();
        playback.playing = true;
        session.ingestFrame({ level: 0.95, at: clock.now() });
        clock.advance(400);
        const result = session.ingestFrame({ level: 0.95, at: clock.now() });
        expect(result.event).toBe('barge_in');
        expect(JSON.stringify(history)).toBe(before);
        expect(history).toHaveLength(2);
        expect(result.historyUnchanged).toBe(true);
        expect(session.snapshot().historyUnchanged).toBe(true);
    });
    test('loud speech while nothing is playing is ordinary speech, not a barge-in', () => {
        const { session, clock, playback } = makeSession();
        session.enable();
        const result = session.ingestFrame({ level: 0.95, at: clock.now() });
        expect(result.event).toBe('speech_started');
        expect(session.snapshot().bargeInCount).toBe(0);
        expect(playback.stopCalls).toBe(0);
    });
    test('after a barge-in, renewed playback echo is suppressed again', () => {
        const { session, clock, playback } = makeSession();
        session.enable();
        playback.playing = true;
        session.ingestFrame({ level: 0.95, at: clock.now() });
        clock.advance(400);
        session.ingestFrame({ level: 0.95, at: clock.now() });
        expect(playback.stopCalls).toBe(1);
        session.stop();
        playback.playing = true;
        session.enable();
        expect(session.ingestFrame({ level: 0.7, at: clock.now() }).event).toBe('echo_suppressed');
        expect(playback.stopCalls).toBe(1);
    });
});

describe('fallback when STT is unavailable', () => {
    test('a missing STT client fails honestly and offers the fallback', async () => {
        const clock = makeClock();
        const session = createHandsFreeSession({ client: null, playback: makePlayback(), now: clock.now });
        session.enable();
        speak(session, clock);
        goSilent(session, clock);
        const result = await session.transcribePending();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('stt_client_unavailable');
        expect(result.fallbackAvailable).toBe(true);
        expect(result.fallbackReason).toBe('stt_client_unavailable');
    });
    test('an STT error is recorded and the typed fallback sends through the same path', async () => {
        const { session, clock, sent } = makeSession({ stt: makeMockStt({ failTimes: 99 }) });
        session.enable();
        speak(session, clock);
        goSilent(session, clock);
        const failed = await session.transcribePending();
        expect(failed.ok).toBe(false);
        expect(failed.lastError).toBe('stt_unavailable');
        const typed = session.enterTypedFallback('typed instead');
        expect(typed.ok).toBe(true);
        expect(typed.mode).toBe('typed');
        expect(session.typeText('typed instead, corrected').ok).toBe(true);
        expect(session.send().ok).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toBe('typed instead, corrected');
        expect(sent[0].source).toBe('typed');
        expect(session.send().duplicate).toBe(true);
    });
    test('fallbackToPushToTalk turns hands-free off and records the reason', async () => {
        const { session, clock } = makeSession({ stt: makeMockStt({ failTimes: 99 }) });
        session.enable();
        speak(session, clock);
        goSilent(session, clock);
        await session.transcribePending();
        const result = session.fallbackToPushToTalk();
        expect(result.ok).toBe(true);
        expect(result.fellBack).toBe(true);
        expect(result.mode).toBe('push_to_talk');
        expect(result.enabled).toBe(false);
        expect(result.fallbackReason).toBe('stt_unavailable');
        expect(session.ingestFrame({ level: 0.9, at: clock.now() }).reason).toBe('hands_free_disabled');
    });
    test('stop() ends listening with no utterance opened', () => {
        const { session, clock } = makeSession();
        session.enable();
        expect(session.stop().ok).toBe(true);
        expect(session.snapshot().state).toBe('stopped');
        expect(session.snapshot().utteranceCount).toBe(0);
        expect(clock.now()).toBeGreaterThan(0);
    });
});
