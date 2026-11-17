/**
 * RFST-009 - Push-to-talk and transcript correction.
 *
 * Roadmap evidence required (section 14): "No duplicate
 * messages; typed fallback." Section 8 (Phase 3) acceptance:
 * push-to-talk transcribes and returns text for optional
 * edit; the user can cancel and retry an STT request; no
 * double-send after reconnect or partial transcription; TTS
 * playback does not recursively trigger another user
 * message; all cloud STT options stay disabled (local-only
 * endpoints); manual typing stays fully functional when STT
 * is unavailable.
 *
 * The core (src/voice/push-to-talk-core.js) is imported and
 * exercised for real against a mock STT client implementing
 * the OpenAI-compatible contract of section 8:
 * POST /v1/audio/transcriptions -> { text }. An injected fake
 * clock makes timing and timeout cases deterministic.
 *
 * Live evidence status: no STT backend is installed on the
 * Z13 (RFST-008: Gufo ASR route 404, whisper not installed),
 * so the live leg is GATED (campaign/PROGRESS.md), exactly as
 * RFST-013..016 gated theirs.
 */
import { describe, test, expect } from '@jest/globals';

import {
    ALLOWED_AUDIO_FORMATS,
    DEFAULT_AUTO_SEND,
    DEFAULT_MAX_UPLOAD_BYTES,
    createPushToTalkSession,
    extractTranscript,
    normalizeAudioFormat,
    validateAudioUpload,
    validateSttEndpoint,
} from '../src/voice/push-to-talk-core.js';

const LOCAL_ENDPOINT = 'http://z13-host:8750/v1/audio/transcriptions';
const AUDIO = { format: 'webm', sizeBytes: 2048, data: 'fake-audio-bytes' };

function makeClock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeMockStt({ text = 'hail and well met', failTimes = 0, clock = null, advanceMs = 0, partialFirst = false } = {}) {
    const mock = {
        calls: [],
        uploads: [],
        failuresLeft: failTimes,
        async upload(request) {
            mock.uploads.push(request);
            return { ok: true };
        },
        async transcribe(request) {
            mock.calls.push(request);
            if (clock && advanceMs) {
                clock.advance(advanceMs);
            }
            if (mock.failuresLeft > 0) {
                mock.failuresLeft--;
                throw new Error('stt_unavailable');
            }
            if (partialFirst && mock.calls.length === 1) {
                return { text: 'hail and', final: false };
            }
            return { text };
        },
    };
    return mock;
}

function makeSession(mock, clock, extra = {}) {
    const sent = [];
    const session = createPushToTalkSession({
        client: mock,
        endpoint: LOCAL_ENDPOINT,
        now: clock.now,
        onSend: (message) => sent.push(message),
        ...extra,
    });
    return { session, sent };
}


describe('local-only STT endpoint validation', () => {
    test('loopback, private, tailnet and LAN endpoints are accepted', () => {
        expect(validateSttEndpoint('http://127.0.0.1:8750/v1/audio/transcriptions').ok).toBe(true);
        expect(validateSttEndpoint('http://localhost:8750/v1/audio/transcriptions').ok).toBe(true);
        expect(validateSttEndpoint('http://192.168.1.20:8750/v1/audio/transcriptions').ok).toBe(true);
        expect(validateSttEndpoint('http://10.0.0.5:8750/v1/audio/transcriptions').ok).toBe(true);
        expect(validateSttEndpoint('http://z13-host.example.ts.net:8750/v1/audio/transcriptions').ok).toBe(true);
        expect(validateSttEndpoint('http://z13-host:8750/v1/audio/transcriptions').ok).toBe(true);
    });
    test('public and cloud recognizer endpoints are rejected', () => {
        expect(validateSttEndpoint('https://api.openai.com/v1/audio/transcriptions')).toEqual(
            expect.objectContaining({ ok: false, reason: 'endpoint_not_local' }));
        expect(validateSttEndpoint('https://speech.example-cloud.com/transcribe').ok).toBe(false);
    });
    test('missing, malformed and non-http endpoints are rejected', () => {
        expect(validateSttEndpoint('').reason).toBe('endpoint_missing');
        expect(validateSttEndpoint('not a url').reason).toBe('endpoint_invalid');
        expect(validateSttEndpoint('ftp://127.0.0.1/x').reason).toBe('endpoint_protocol_not_allowed');
    });
    test('a session pointed at a public endpoint never uploads', async () => {
        const clock = makeClock();
        const mock = makeMockStt();
        const { session } = makeSession(mock, clock, { endpoint: 'https://api.openai.com/v1/audio/transcriptions' });
        session.beginCapture();
        const result = await session.endCapture(AUDIO);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('endpoint_not_local');
        expect(mock.calls).toHaveLength(0);
        expect(mock.uploads).toHaveLength(0);
    });
});


describe('bounded upload: formats and size', () => {
    test('the allowlist covers the common audio formats', () => {
        for (const format of ['webm', 'ogg', 'wav', 'mp3', 'm4a', 'flac']) {
            expect(ALLOWED_AUDIO_FORMATS).toContain(format);
            expect(validateAudioUpload({ format, sizeBytes: 100 }).ok).toBe(true);
        }
    });
    test('MIME types and filenames normalize to allowlisted formats', () => {
        expect(normalizeAudioFormat('audio/webm;codecs=opus')).toBe('webm');
        expect(normalizeAudioFormat('audio/mpeg')).toBe('mp3');
        expect(normalizeAudioFormat('note.WAV')).toBe('wav');
        expect(normalizeAudioFormat('application/pdf')).toBe('');
    });
    test('disallowed formats, empty audio and oversize uploads are rejected', () => {
        expect(validateAudioUpload({ format: 'exe', sizeBytes: 10 }).reason).toBe('audio_format_not_allowed');
        expect(validateAudioUpload({ format: 'webm', sizeBytes: 0 }).reason).toBe('audio_empty');
        expect(validateAudioUpload({ format: 'webm', sizeBytes: DEFAULT_MAX_UPLOAD_BYTES + 1 }).reason).toBe('audio_too_large');
    });
    test('an oversize capture fails in-session and offers the typed fallback', async () => {
        const clock = makeClock();
        const mock = makeMockStt();
        const { session } = makeSession(mock, clock, { maxUploadBytes: 1024 });
        session.beginCapture();
        const result = await session.endCapture({ format: 'webm', sizeBytes: 4096 });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('audio_too_large');
        expect(result.fallbackAvailable).toBe(true);
        expect(mock.calls).toHaveLength(0);
    });
});

describe('push-to-talk lifecycle and timing', () => {
    test('idle -> recording -> uploading -> transcribing -> preview with a final transcript', async () => {
        const clock = makeClock();
        const mock = makeMockStt({ clock, advanceMs: 1200 });
        const { session, sent } = makeSession(mock, clock);
        expect(session.snapshot().state).toBe('idle');
        expect(session.beginCapture().ok).toBe(true);
        expect(session.snapshot().state).toBe('recording');
        clock.advance(3000);
        const result = await session.endCapture(AUDIO);
        expect(result.ok).toBe(true);
        expect(result.state).toBe('preview');
        expect(result.transcript).toBe('hail and well met');
        expect(result.previewKind).toBe('final');
        expect(result.isFinal).toBe(true);
        expect(mock.uploads).toHaveLength(1);
        expect(mock.calls).toHaveLength(1);
        expect(mock.calls[0].endpoint).toBe(LOCAL_ENDPOINT);
        expect(sent).toHaveLength(0); // auto-send is off by default
    });
    test('capture, upload, transcription and round-trip timing are recorded', async () => {
        const clock = makeClock();
        const mock = makeMockStt({ clock, advanceMs: 1200 });
        const { session } = makeSession(mock, clock);
        session.beginCapture();
        clock.advance(3000);
        await session.endCapture(AUDIO);
        const { timing } = session.snapshot();
        expect(timing.captureDurationMs).toBe(3000);
        expect(timing.uploadDurationMs).not.toBeNull();
        expect(timing.transcriptionDurationMs).toBe(1200);
        expect(timing.roundTripMs).toBe(4200);
        expect(timing.previewAt).not.toBeNull();
    });
    test('a slow STT request past the timeout fails honestly and keeps the audio for retry', async () => {
        const clock = makeClock();
        const mock = makeMockStt({ clock, advanceMs: 60_000 });
        const { session } = makeSession(mock, clock, { requestTimeoutMs: 30_000 });
        session.beginCapture();
        const result = await session.endCapture(AUDIO);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('stt_request_timeout');
        expect(result.state).toBe('error');
    });
    test('beginCapture during an active capture is rejected', () => {
        const clock = makeClock();
        const { session } = makeSession(makeMockStt(), clock);
        expect(session.beginCapture().ok).toBe(true);
        expect(session.beginCapture().reason).toBe('capture_already_active');
    });
});


describe('partial vs final transcripts and correction', () => {
    test('a partial transcript is held apart and can never be sent', async () => {
        const clock = makeClock();
        const mock = makeMockStt({ partialFirst: true });
        const { session, sent } = makeSession(mock, clock);
        session.beginCapture();
        const result = await session.endCapture(AUDIO);
        expect(result.previewKind).toBe('partial');
        expect(result.partialTranscript).toBe('hail and');
        expect(result.transcript).toBe('');
        expect(result.isFinal).toBe(false);
        expect(session.send().reason).toBe('partial_transcript_not_sendable');
        expect(sent).toHaveLength(0);
    });
    test('extractTranscript distinguishes partial and final payloads', () => {
        expect(extractTranscript({ text: 'a', final: false })).toEqual({ text: 'a', isFinal: false });
        expect(extractTranscript({ text: 'a', partial: true }).isFinal).toBe(false);
        expect(extractTranscript({ text: 'a' })).toEqual({ text: 'a', isFinal: true });
        expect(extractTranscript('a')).toEqual({ text: 'a', isFinal: true });
    });
    test('the user may edit and correct the transcript before send', async () => {
        const clock = makeClock();
        const mock = makeMockStt({ text: 'their is a storm' });
        const { session, sent } = makeSession(mock, clock);
        session.beginCapture();
        await session.endCapture(AUDIO);
        const edited = session.editTranscript('there is a storm');
        expect(edited.ok).toBe(true);
        expect(edited.edited).toBe(true);
        expect(session.send().ok).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toBe('there is a storm');
    });
    test('auto-send defaults off and, when explicitly enabled, sends exactly once', async () => {
        expect(DEFAULT_AUTO_SEND).toBe(false);
        const clock = makeClock();
        const mock = makeMockStt();
        const { session, sent } = makeSession(mock, clock, { autoSend: true });
        session.beginCapture();
        const result = await session.endCapture(AUDIO);
        expect(result.autoSent).toBe(true);
        expect(session.snapshot().state).toBe('sent');
        expect(sent).toHaveLength(1);
        expect(session.send().reason).toBe('duplicate_send_rejected');
        expect(sent).toHaveLength(1);
    });
});


describe('cancel and retry', () => {
    test('cancel during recording ends the capture with nothing sent', () => {
        const clock = makeClock();
        const { session, sent } = makeSession(makeMockStt(), clock);
        session.beginCapture();
        const result = session.cancel();
        expect(result.ok).toBe(true);
        expect(session.snapshot().state).toBe('cancelled');
        expect(session.send().ok).toBe(false);
        expect(sent).toHaveLength(0);
    });
    test('cancel during transcription drops the late result', async () => {
        const clock = makeClock();
        let sessionRef = null;
        const mock = {
            calls: [],
            async transcribe(request) {
                mock.calls.push(request);
                sessionRef.cancel();
                return { text: 'late words' };
            },
        };
        const { session, sent } = makeSession(mock, clock);
        sessionRef = session;
        session.beginCapture();
        const result = await session.endCapture(AUDIO);
        expect(result.reason).toBe('cancelled');
        expect(session.snapshot().state).toBe('cancelled');
        expect(session.snapshot().transcript).toBe('');
        expect(sent).toHaveLength(0);
    });
    test('retry reuses the captured audio as a fresh attempt', async () => {
        const clock = makeClock();
        const mock = makeMockStt({ failTimes: 1 });
        const { session, sent } = makeSession(mock, clock);
        session.beginCapture();
        const first = await session.endCapture(AUDIO);
        expect(first.ok).toBe(false);
        expect(first.state).toBe('error');
        const retried = await session.retry();
        expect(retried.ok).toBe(true);
        expect(retried.attempt).toBe(2);
        expect(mock.calls).toHaveLength(2);
        expect(mock.calls[1].audio).toBe(AUDIO);
        expect(session.send().ok).toBe(true);
        expect(sent).toHaveLength(1);
    });
    test('retry with no captured audio is rejected honestly', async () => {
        const clock = makeClock();
        const { session } = makeSession(makeMockStt(), clock);
        expect((await session.retry()).reason).toBe('no_audio_to_retry');
    });
});

describe('no duplicate messages', () => {
    test('a second send for the same finalized transcript is rejected', async () => {
        const clock = makeClock();
        const { session, sent } = makeSession(makeMockStt(), clock);
        session.beginCapture();
        await session.endCapture(AUDIO);
        expect(session.send().ok).toBe(true);
        const again = session.send();
        expect(again.ok).toBe(false);
        expect(again.duplicate).toBe(true);
        expect(again.reason).toBe('duplicate_send_rejected');
        expect(sent).toHaveLength(1);
    });
    test('reconnect never resets the dedupe guard', async () => {
        const clock = makeClock();
        const { session, sent } = makeSession(makeMockStt(), clock);
        session.beginCapture();
        await session.endCapture(AUDIO);
        session.send();
        const after = session.reconnect();
        expect(after.sent).toBe(true);
        expect(session.send().duplicate).toBe(true);
        expect(sent).toHaveLength(1);
    });
    test('a partial followed by the final transcript yields exactly one send', async () => {
        const clock = makeClock();
        const { session, sent } = makeSession(makeMockStt(), clock);
        session.beginCapture();
        await session.endCapture(AUDIO);
        session.applyTranscriptResult({ text: 'hail and', final: false });
        expect(session.send().ok).toBe(false);
        session.applyTranscriptResult({ text: 'hail and well met' });
        expect(session.send().ok).toBe(true);
        expect(session.send().duplicate).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toBe('hail and well met');
    });
    test('a new capture after a send is a new logical message with a new token', async () => {
        const clock = makeClock();
        const { session, sent } = makeSession(makeMockStt(), clock);
        session.beginCapture();
        await session.endCapture(AUDIO);
        session.send();
        const firstToken = sent[0].sendToken;
        session.beginCapture();
        await session.endCapture(AUDIO);
        expect(session.send().ok).toBe(true);
        expect(sent).toHaveLength(2);
        expect(sent[1].sendToken).not.toBe(firstToken);
    });
});


describe('typed fallback', () => {
    test('when STT errors, typed text goes through the same preview/edit/send path', async () => {
        const clock = makeClock();
        const mock = makeMockStt({ failTimes: 99 });
        const { session, sent } = makeSession(mock, clock);
        session.beginCapture();
        const failed = await session.endCapture(AUDIO);
        expect(failed.ok).toBe(false);
        expect(failed.fallbackAvailable).toBe(true);
        const typed = session.enterTypedFallback('typed instead');
        expect(typed.ok).toBe(true);
        expect(typed.mode).toBe('typed');
        expect(typed.state).toBe('preview');
        expect(session.editTranscript('typed instead, corrected').ok).toBe(true);
        expect(session.send().ok).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toBe('typed instead, corrected');
        expect(sent[0].source).toBe('typed');
        expect(session.send().duplicate).toBe(true);
    });
    test('with no STT client at all, typing is a fully functional path from idle', () => {
        const clock = makeClock();
        const sent = [];
        const session = createPushToTalkSession({
            client: null,
            endpoint: LOCAL_ENDPOINT,
            now: clock.now,
            onSend: (m) => sent.push(m),
        });
        session.enterTypedFallback();
        expect(session.typeText('manual words').ok).toBe(true);
        expect(session.send().ok).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toBe('manual words');
    });
    test('an STT failure state reports its reason for the fallback', async () => {
        const clock = makeClock();
        const mock = makeMockStt({ failTimes: 1 });
        const { session } = makeSession(mock, clock);
        session.beginCapture();
        const failed = await session.endCapture(AUDIO);
        expect(failed.fallbackReason).toBe('stt_unavailable');
        expect(failed.lastError).toBe('stt_unavailable');
    });
});


describe('TTS playback guard', () => {
    test('beginCapture is rejected while playback is active via the setter', () => {
        const clock = makeClock();
        const { session } = makeSession(makeMockStt(), clock);
        session.setPlaybackActive(true);
        const result = session.beginCapture();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('tts_playback_active');
        expect(session.snapshot().state).toBe('idle');
        session.setPlaybackActive(false);
        expect(session.beginCapture().ok).toBe(true);
    });
    test('beginCapture is rejected while a playback getter reports active', () => {
        const clock = makeClock();
        let playing = true;
        const { session } = makeSession(makeMockStt(), clock, { playbackActive: () => playing });
        expect(session.beginCapture().reason).toBe('tts_playback_active');
        playing = false;
        expect(session.beginCapture().ok).toBe(true);
    });
});
