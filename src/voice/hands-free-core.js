/**
 * Optional hands-free VAD / barge-in (RFST-022).
 *
 * Roadmap evidence required (section 14): "Stable end-to-end
 * voice turn-taking." Section 8 (Phase 3) acceptance: add
 * optional VAD / hands-free ONLY after push-to-talk is stable
 * (RFST-009 is DONE, so this package is eligible); audio stop
 * or barge-in stops playback without rewriting chat history;
 * talk-over / interruption is handled; microphone feedback
 * loops from TTS / AllTalk playback are avoided; hands-free
 * is an explicit, user-controlled opt-in.
 *
 * This dependency-free core implements that turn-taking
 * session against injected collaborators, exactly as
 * RFST-009 injected its STT client and clock:
 *  - an audio frame stream: the host feeds frames of the
 *    shape { level } (0..1) via ingestFrame(); the core
 *    performs voice-activity detection (VAD) itself from
 *    those levels, so tests drive it with mock frames and
 *    no microphone, audio device, or VAD library is needed;
 *  - an STT client with an async transcribe(request) method
 *    (a mock in tests, the RFST-009 local STT contract in
 *    production);
 *  - a playback controller with isPlaying() and stop()
 *    (the AllTalk / TTS playback host in production, a mock
 *    in tests);
 *  - an injected clock, so thresholds, hangover, sustain
 *    windows, and timing are deterministic in tests.
 *
 * Opt-in rule: hands-free is DISABLED by default. While it
 * is disabled every frame is rejected and the session does
 * nothing at all, so push-to-talk behavior (RFST-009) is
 * completely unchanged. enable() is the explicit user
 * opt-in; disable() returns to push-to-talk at any moment.
 *
 * VAD rule: a frame at or above speechThreshold starts (or
 * continues) speech. Speech ends only after the level has
 * stayed below the threshold for the full silenceHangoverMs
 * (checked on later frames and on tick()), so short pauses
 * inside one utterance never split it into two turns. A
 * closed utterance is transcribed exactly once and sent
 * exactly once: each utterance carries one send token and
 * duplicate transcribe / send calls for it are rejected,
 * in the spirit of the RFST-009 dedupe guard.
 *
 * Barge-in rule: while playback is active, frames are NOT
 * treated as user speech by default - that is the feedback
 * guard, because the microphone can hear the TTS / AllTalk
 * playback itself. Only a frame at or above the (higher)
 * bargeInThreshold, sustained continuously for at least
 * bargeInSustainMs, counts as a deliberate talk-over: the
 * core then calls playback.stop() exactly once, records a
 * barge-in, and treats that sustained speech as the start
 * of a new user utterance. Short loud bursts of playback
 * echo never stop playback and never open a turn.
 *
 * History rule: barge-in stops PLAYBACK only. The core
 * never writes to chat history: it only reads the injected
 * history (array or getter) to fingerprint it, and every
 * snapshot reports historyUnchanged so a host (and the
 * test suite) can prove a barge-in left history untouched.
 *
 * Fallback rule: when STT is unavailable (no client, or a
 * transcription error), the session records the failure
 * and can fall back to push-to-talk mode or to the typed
 * path, which goes through the same preview / send path
 * as a transcript - manual typing stays fully functional,
 * as in RFST-009.
 *
 * Live turn-taking is GATED: no STT backend is installed
 * on the Z13 (RFST-008: Gufo ASR route 404, whisper not
 * installed), so this core is proven against mock VAD
 * frames / STT / playback only (see campaign/PROGRESS.md),
 * exactly as RFST-009 and RFST-013..021 gated their live
 * legs. The live leg additionally needs live TTS playback
 * to barge in on.
 */

export const HANDS_FREE_STATES = Object.freeze([
    'idle',
    'listening',
    'speech',
    'silence',
    'utterance_ready',
    'transcribing',
    'preview',
    'sent',
    'fallback',
    'error',
    'stopped',
]);

export const DEFAULT_ENABLED = false;
export const DEFAULT_SPEECH_THRESHOLD = 0.5;
export const DEFAULT_BARGE_IN_THRESHOLD = 0.85;
export const DEFAULT_SILENCE_HANGOVER_MS = 800;
export const DEFAULT_BARGE_IN_SUSTAIN_MS = 300;
export const DEFAULT_MIN_SPEECH_MS = 120;

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function positiveNumber(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function threshold(value, fallback) {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

/**
 * Classifies one audio level against the VAD thresholds.
 * @param {number} level Frame level, 0..1
 * @param {object} [options] { speechThreshold, bargeInThreshold }
 * @returns {'silence'|'speech'|'loud'} Frame class
 */
export function classifyFrameLevel(level, options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const speech = threshold(opts.speechThreshold, DEFAULT_SPEECH_THRESHOLD);
    const barge = threshold(opts.bargeInThreshold, DEFAULT_BARGE_IN_THRESHOLD);
    if (!Number.isFinite(level) || level < speech) {
        return 'silence';
    }
    return level >= barge ? 'loud' : 'speech';
}

function fingerprintHistory(history) {
    if (!Array.isArray(history)) {
        return null;
    }
    let hash = 0;
    const text = JSON.stringify(history);
    for (let i = 0; i < text.length; i++) {
        hash = ((hash * 31) + text.charCodeAt(i)) | 0;
    }
    return { length: history.length, hash };
}

/**
 * Creates one hands-free turn-taking session.
 * @param {object} options
 * @param {object} [options.client] Injected STT client with
 *  an async transcribe(request) method; request is
 *  { utteranceId, frames, durationMs, attempt } and it
 *  resolves to { text, final? } or bare text.
 * @param {object} [options.playback] Injected playback
 *  controller with isPlaying() and stop() methods.
 * @param {boolean|Function} [options.playbackActive]
 *  Playback flag or getter, used when no controller given.
 * @param {boolean} [options.enabled] Initial opt-in;
 *  default false (hands-free off).
 * @param {number} [options.speechThreshold] VAD speech level.
 * @param {number} [options.bargeInThreshold] Barge-in level.
 * @param {number} [options.silenceHangoverMs] Silence that
 *  must elapse before speech is considered ended.
 * @param {number} [options.bargeInSustainMs] How long a loud
 *  level must be sustained during playback to barge in.
 * @param {number} [options.minSpeechMs] Minimum speech span
 *  for an utterance to be transcribed; shorter blips are
 *  dropped as noise.
 * @param {Function} [options.onSend] Host send callback,
 *  called exactly once per utterance with
 *  { text, sendToken, utteranceId, source }.
 * @param {Function} [options.onBargeIn] Host callback fired
 *  once per barge-in with { utteranceId, at }.
 * @param {Array|Function} [options.history] Chat history
 *  (array or getter) that is fingerprinted, never written.
 * @param {Function} [options.now] Clock, defaults to Date.now.
 * @returns {object} Session (see methods inline)
 */
export function createHandsFreeSession(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const client = isPlainObject(opts.client) ? opts.client : null;
    const playback = isPlainObject(opts.playback) ? opts.playback : null;
    const onSend = typeof opts.onSend === 'function' ? opts.onSend : null;
    const onBargeIn = typeof opts.onBargeIn === 'function' ? opts.onBargeIn : null;
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    const speechThreshold = threshold(opts.speechThreshold, DEFAULT_SPEECH_THRESHOLD);
    const bargeInThreshold = threshold(opts.bargeInThreshold, DEFAULT_BARGE_IN_THRESHOLD);
    const silenceHangoverMs = positiveNumber(opts.silenceHangoverMs, DEFAULT_SILENCE_HANGOVER_MS);
    const bargeInSustainMs = positiveNumber(opts.bargeInSustainMs, DEFAULT_BARGE_IN_SUSTAIN_MS);
    const minSpeechMs = positiveNumber(opts.minSpeechMs, DEFAULT_MIN_SPEECH_MS);

    let enabled = opts.enabled === true;
    let mode = enabled ? 'hands_free' : 'push_to_talk';
    let state = 'idle';
    let sessionCounter = 0;
    let utteranceCounter = 0;
    let currentUtteranceId = null;
    let frames = [];
    let speechStartedAt = null;
    let lastSpeechAt = null;
    let silenceStartedAt = null;
    let loudStartedAt = null;
    let transcript = '';
    let previewKind = null;
    let sendToken = null;
    let sentToken = null;
    let sentText = null;
    let attempt = 0;
    let bargeInCount = 0;
    let echoSuppressedFrames = 0;
    let droppedUtterances = 0;
    let lastError = null;
    let fallbackReason = null;
    let timing = freshTiming();
    const historyAtStart = readHistory();

    function readHistory() {
        const history = typeof opts.history === 'function' ? opts.history() : opts.history;
        return fingerprintHistory(history);
    }

    function historyUnchanged() {
        const current = readHistory();
        if (historyAtStart === null || current === null) {
            return true;
        }
        return current.length === historyAtStart.length && current.hash === historyAtStart.hash;
    }

    function freshTiming() {
        return {
            listeningStartedAt: null,
            speechStartedAt: null,
            speechEndedAt: null,
            transcriptionStartedAt: null,
            transcriptionEndedAt: null,
            previewAt: null,
            sentAt: null,
            speechDurationMs: null,
            transcriptionDurationMs: null,
            roundTripMs: null,
        };
    }

    function playbackActive() {
        if (playback && typeof playback.isPlaying === 'function') {
            return playback.isPlaying() === true;
        }
        if (typeof opts.playbackActive === 'function') {
            return opts.playbackActive() === true;
        }
        return opts.playbackActive === true;
    }

    function durations() {
        const span = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null);
        return {
            ...timing,
            speechDurationMs: span(timing.speechStartedAt, timing.speechEndedAt),
            transcriptionDurationMs: span(timing.transcriptionStartedAt, timing.transcriptionEndedAt),
            roundTripMs: span(timing.speechStartedAt, timing.transcriptionEndedAt),
        };
    }

    function snapshot() {
        return {
            enabled,
            mode,
            state,
            sessionId: `hf-session-${sessionCounter}`,
            utteranceId: currentUtteranceId,
            utteranceCount: utteranceCounter,
            frameCount: frames.length,
            transcript,
            previewKind,
            isFinal: previewKind === 'final' || previewKind === 'typed',
            sendToken,
            sent: sentToken !== null,
            sentText,
            playbackActive: playbackActive(),
            bargeInCount,
            echoSuppressedFrames,
            droppedUtterances,
            historyUnchanged: historyUnchanged(),
            fallbackAvailable: true,
            fallbackReason,
            lastError,
            thresholds: { speechThreshold, bargeInThreshold, silenceHangoverMs, bargeInSustainMs, minSpeechMs },
            timing: durations(),
        };
    }

    function beginUtterance(at, viaBargeIn) {
        utteranceCounter++;
        currentUtteranceId = utteranceCounter;
        frames = [];
        speechStartedAt = at;
        lastSpeechAt = at;
        silenceStartedAt = null;
        timing.speechStartedAt = at;
        timing.speechEndedAt = null;
        state = 'speech';
        return { utteranceId: currentUtteranceId, viaBargeIn: viaBargeIn === true };
    }

    function closeUtterance(at) {
        timing.speechEndedAt = lastSpeechAt;
        const durationMs = Math.max(0, lastSpeechAt - speechStartedAt);
        silenceStartedAt = null;
        loudStartedAt = null;
        if (durationMs < minSpeechMs) {
            droppedUtterances++;
            currentUtteranceId = null;
            frames = [];
            speechStartedAt = null;
            lastSpeechAt = null;
            state = enabled ? 'listening' : state;
            return { closed: false, reason: 'utterance_too_short', at };
        }
        state = 'utterance_ready';
        return { closed: true, reason: 'speech_ended', utteranceId: currentUtteranceId, durationMs, at };
    }

    function maybeCloseUtterance(at) {
        if ((state === 'speech' || state === 'silence') && silenceStartedAt !== null
            && at - silenceStartedAt >= silenceHangoverMs) {
            return closeUtterance(at);
        }
        return null;
    }

    /** Explicit user opt-in: turns hands-free listening on. */
    function enable() {
        enabled = true;
        mode = 'hands_free';
        sessionCounter++;
        timing.listeningStartedAt = now();
        if (state === 'idle' || state === 'stopped' || state === 'fallback') {
            state = 'listening';
        }
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    /** Opts back out: hands-free off, push-to-talk behavior. */
    function disable() {
        enabled = false;
        mode = 'push_to_talk';
        loudStartedAt = null;
        if (state === 'listening' || state === 'silence') {
            state = 'idle';
        }
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    /** Starts listening; requires the explicit opt-in first. */
    function start() {
        if (!enabled) {
            return { ok: false, reason: 'hands_free_disabled', ...snapshot() };
        }
        sessionCounter++;
        timing.listeningStartedAt = now();
        state = 'listening';
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    /** Stops listening entirely; no utterance is opened. */
    function stop() {
        state = 'stopped';
        loudStartedAt = null;
        silenceStartedAt = null;
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    /**
     * Feeds one audio frame { level, at? } into the VAD.
     * Returns the snapshot plus an `event` naming what the
     * frame did: 'ignored_disabled', 'echo_suppressed',
     * 'barge_in', 'speech_started', 'speech', 'silence',
     * 'speech_ended', 'utterance_dropped', or 'idle'.
     */
    function ingestFrame(frame) {
        const safe = isPlainObject(frame) ? frame : {};
        const at = Number.isFinite(safe.at) ? safe.at : now();
        const level = Number.isFinite(safe.level) ? safe.level : 0;
        if (!enabled) {
            return { ok: false, reason: 'hands_free_disabled', event: 'ignored_disabled', ...snapshot() };
        }
        if (mode !== 'hands_free') {
            return { ok: false, reason: 'not_in_hands_free_mode', event: 'ignored_mode', ...snapshot() };
        }
        if (state === 'idle' || state === 'stopped' || state === 'fallback') {
            state = 'listening';
        }
        if (state === 'utterance_ready' || state === 'transcribing' || state === 'preview' || state === 'sent') {
            return { ok: false, reason: 'utterance_pending', event: 'ignored_pending', ...snapshot() };
        }
        const cls = classifyFrameLevel(level, { speechThreshold, bargeInThreshold });
        if (playbackActive()) {
            // Feedback guard: playback frames are echo, not
            // user speech, unless loudly sustained (barge-in).
            if (cls !== 'loud') {
                echoSuppressedFrames++;
                loudStartedAt = null;
                return { ok: true, reason: 'ok', event: 'echo_suppressed', ...snapshot() };
            }
            if (loudStartedAt === null) {
                loudStartedAt = at;
                echoSuppressedFrames++;
                return { ok: true, reason: 'ok', event: 'echo_suppressed', ...snapshot() };
            }
            if (at - loudStartedAt < bargeInSustainMs) {
                echoSuppressedFrames++;
                return { ok: true, reason: 'ok', event: 'echo_suppressed', ...snapshot() };
            }
            // Deliberate talk-over: stop playback ONCE, keep
            // chat history untouched, open a user utterance.
            if (playback && typeof playback.stop === 'function') {
                playback.stop();
            }
            bargeInCount++;
            const begun = beginUtterance(loudStartedAt, true);
            frames.push({ level, at });
            lastSpeechAt = at;
            loudStartedAt = null;
            if (onBargeIn) {
                onBargeIn({ utteranceId: begun.utteranceId, at });
            }
            return { ok: true, reason: 'ok', event: 'barge_in', bargedIn: true, ...snapshot() };
        }
        loudStartedAt = null;
        if (cls === 'silence') {
            if (state === 'speech' || state === 'silence') {
                if (silenceStartedAt === null) {
                    silenceStartedAt = at;
                    state = 'silence';
                }
                const closed = maybeCloseUtterance(at);
                if (closed && closed.closed) {
                    return { ok: true, reason: 'ok', event: 'speech_ended', ...snapshot() };
                }
                if (closed && !closed.closed) {
                    return { ok: true, reason: 'ok', event: 'utterance_dropped', ...snapshot() };
                }
                return { ok: true, reason: 'ok', event: 'silence', ...snapshot() };
            }
            return { ok: true, reason: 'ok', event: 'idle', ...snapshot() };
        }
        // Speech (or loud speech while nothing is playing).
        frames.push({ level, at });
        if (state === 'silence') {
            // A pause shorter than the hangover: the same
            // utterance resumes, it is not a new turn.
            lastSpeechAt = at;
            silenceStartedAt = null;
            state = 'speech';
            return { ok: true, reason: 'ok', event: 'speech', ...snapshot() };
        }
        if (state !== 'speech') {
            const begun = beginUtterance(at, false);
            frames.push({ level, at });
            return { ok: true, reason: 'ok', event: 'speech_started', utteranceId: begun.utteranceId, ...snapshot() };
        }
        lastSpeechAt = at;
        silenceStartedAt = null;
        state = 'speech';
        return { ok: true, reason: 'ok', event: 'speech', ...snapshot() };
    }

    /**
     * Advances the clock without a frame, so a trailing
     * silence hangover can close the current utterance.
     */
    function tick(atMs) {
        const at = Number.isFinite(atMs) ? atMs : now();
        const closed = maybeCloseUtterance(at);
        if (closed && closed.closed) {
            return { ok: true, reason: 'ok', event: 'speech_ended', ...snapshot() };
        }
        if (closed && !closed.closed) {
            return { ok: true, reason: 'ok', event: 'utterance_dropped', ...snapshot() };
        }
        return { ok: true, reason: 'ok', event: 'tick', ...snapshot() };
    }

    /**
     * Transcribes the closed utterance exactly once. A
     * second call for the same utterance is rejected, so a
     * single utterance can never yield duplicate turns.
     */
    async function transcribePending() {
        if (state === 'preview' && sendToken !== null) {
            return { ok: false, reason: 'already_transcribed', duplicate: true, ...snapshot() };
        }
        if (state !== 'utterance_ready' || currentUtteranceId === null) {
            return { ok: false, reason: 'no_utterance_to_transcribe', ...snapshot() };
        }
        if (!client || typeof client.transcribe !== 'function') {
            state = 'error';
            lastError = 'stt_client_unavailable';
            fallbackReason = lastError;
            return { ok: false, reason: lastError, ...snapshot() };
        }
        attempt++;
        const request = {
            utteranceId: currentUtteranceId,
            frames: [...frames],
            frameCount: frames.length,
            durationMs: Math.max(0, (lastSpeechAt ?? 0) - (speechStartedAt ?? 0)),
            attempt,
        };
        state = 'transcribing';
        timing.transcriptionStartedAt = now();
        try {
            const response = await client.transcribe(request);
            timing.transcriptionEndedAt = now();
            const text = typeof response === 'string'
                ? response.trim()
                : cleanString(isPlainObject(response) ? (response.text ?? response.transcript ?? '') : '');
            const isFinal = !isPlainObject(response)
                || (response.final !== false && response.isFinal !== false && response.partial !== true);
            if (!isFinal) {
                state = 'utterance_ready';
                return { ok: false, reason: 'partial_transcript_not_final', ...snapshot() };
            }
            transcript = text;
            previewKind = 'final';
            sendToken = `hf-${sessionCounter}-${currentUtteranceId}-${attempt}-${text.length}`;
            timing.previewAt = now();
            state = 'preview';
            return { ok: true, reason: 'ok', ...snapshot() };
        } catch (error) {
            timing.transcriptionEndedAt = now();
            state = 'error';
            lastError = error instanceof Error ? error.message : 'stt_request_failed';
            fallbackReason = lastError;
            return { ok: false, reason: lastError, ...snapshot() };
        }
    }

    /**
     * Sends the transcribed utterance exactly once; a
     * second send for the same token is a duplicate.
     */
    function send() {
        if (sentToken !== null && sendToken !== null && sentToken === sendToken) {
            return { ok: false, reason: 'duplicate_send_rejected', duplicate: true, ...snapshot() };
        }
        if (state === 'sent') {
            return { ok: false, reason: 'duplicate_send_rejected', duplicate: true, ...snapshot() };
        }
        if (state !== 'preview' || !transcript) {
            return { ok: false, reason: 'nothing_to_send', ...snapshot() };
        }
        if (onSend) {
            onSend({ text: transcript, sendToken, utteranceId: currentUtteranceId, sessionId: `hf-session-${sessionCounter}`, source: mode === 'typed' ? 'typed' : 'hands_free' });
        }
        sentToken = sendToken;
        sentText = transcript;
        timing.sentAt = now();
        state = 'sent';
        return { ok: true, reason: 'ok', duplicate: false, ...snapshot() };
    }

    /** Prepares the session for the next utterance. */
    function nextTurn() {
        if (state !== 'sent' && state !== 'preview' && state !== 'error') {
            return { ok: false, reason: 'turn_not_complete', ...snapshot() };
        }
        currentUtteranceId = null;
        frames = [];
        transcript = '';
        previewKind = null;
        sendToken = null;
        speechStartedAt = null;
        lastSpeechAt = null;
        silenceStartedAt = null;
        state = enabled && mode === 'hands_free' ? 'listening' : 'idle';
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    /** Falls back to push-to-talk mode (hands-free off). */
    function fallbackToPushToTalk(reason = 'stt_unavailable') {
        fallbackReason = reason;
        enabled = false;
        mode = 'push_to_talk';
        state = 'fallback';
        return { ok: true, reason: 'ok', fellBack: true, ...snapshot() };
    }

    /**
     * Enters the typed fallback through the same preview /
     * send path as a transcript, for when STT is down.
     */
    function enterTypedFallback(text = '') {
        mode = 'typed';
        if (currentUtteranceId === null) {
            utteranceCounter++;
            currentUtteranceId = utteranceCounter;
        }
        transcript = cleanString(text);
        previewKind = 'typed';
        sendToken = `hf-${sessionCounter}-${currentUtteranceId}-typed-${transcript.length}`;
        timing.previewAt = now();
        state = 'preview';
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    /** Updates typed-fallback text while in preview. */
    function typeText(text) {
        if (mode !== 'typed' || state !== 'preview') {
            return enterTypedFallback(text);
        }
        transcript = cleanString(text);
        sendToken = `hf-${sessionCounter}-${currentUtteranceId}-typed-${transcript.length}`;
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    return {
        enable,
        disable,
        start,
        stop,
        ingestFrame,
        tick,
        transcribePending,
        send,
        nextTurn,
        fallbackToPushToTalk,
        enterTypedFallback,
        typeText,
        getSnapshot: snapshot,
        snapshot,
    };
}
