/**
 * Push-to-talk and transcript correction (RFST-009).
 *
 * Roadmap evidence required (section 14): "No duplicate
 * messages; typed fallback." Section 8 (Phase 3) asks for
 * push-to-talk as the first, most reliable voice input mode:
 * speech is sent to a LOCAL STT endpoint (never an external
 * recognizer), common audio formats with bounded upload size
 * and timeouts are supported, partial and final transcripts
 * are clearly distinguished, the user may correct/edit the
 * transcript before send, auto-send is explicit and
 * user-controlled, cancel and retry work, TTS playback never
 * recursively creates a user message, manual typing stays a
 * fully functional fallback when STT is unavailable, and
 * capture / upload / transcription timing is tracked.
 *
 * This dependency-free core implements that session against
 * the OpenAI-compatible STT contract documented in section 8:
 *  - POST /v1/audio/transcriptions -> { text: "..." }
 * The client is injected (a fetch-based client in production,
 * a mock in tests, exactly as RFST-013 mocked ComfyUI), and
 * the clock is injected so timing and timeouts are
 * deterministic in tests.
 *
 * Session lifecycle:
 *   idle -> recording -> uploading -> transcribing -> preview
 *   -> sent, with cancelled / error / typed branches. A final
 *   transcript lands in preview; a partial transcript is held
 *   separately (previewKind: 'partial') and can never be sent.
 *   The user edits in preview (editTranscript). Send is
 *   idempotent: each finalized transcript cycle carries one
 *   send token, a second send for the same token is rejected
 *   as a duplicate, and reconnect() never resets that guard -
 *   so a reconnect or a partial-then-final sequence yields
 *   exactly one logical user message.
 *
 * Local-only rule: the configured STT endpoint must resolve
 * to a loopback, private, link-local, .local / .lan / .home,
 * single-label LAN, or tailnet (.ts.net) address. Public or
 * cloud recognizer endpoints are rejected before any upload.
 *
 * TTS-playback guard: the host sets playbackActive while TTS
 * audio is playing (option, setter, or getter function).
 * beginCapture is rejected while it is set, so playback can
 * never be captured and turned back into a user message.
 *
 * Live transcription is GATED: no STT backend is installed on
 * the Z13 (RFST-008: Gufo ASR route 404, whisper not
 * installed), so this core is proven against a mock STT
 * client only (see campaign/PROGRESS.md), exactly as
 * RFST-013..016 gated their live legs.
 */

export const SESSION_STATES = Object.freeze([
    'idle',
    'recording',
    'uploading',
    'transcribing',
    'preview',
    'sent',
    'cancelled',
    'error',
]);

export const ALLOWED_AUDIO_FORMATS = Object.freeze([
    'webm',
    'ogg',
    'wav',
    'mp3',
    'm4a',
    'flac',
]);

export const AUDIO_MIME_TYPES = Object.freeze({
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
});

export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_AUTO_SEND = false;

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Normalizes an audio format hint (extension, filename, or
 * MIME type) to a bare extension, or '' when unrecognized.
 * @param {string} hint Format hint
 * @returns {string} Bare extension such as 'webm', or ''
 */
export function normalizeAudioFormat(hint) {
    const raw = cleanString(hint).toLowerCase();
    if (!raw) {
        return '';
    }
    if (Object.hasOwn(AUDIO_MIME_TYPES, raw)) {
        return AUDIO_MIME_TYPES[raw];
    }
    const bare = raw.split(';')[0].split('/').pop().split('.').pop();
    return ALLOWED_AUDIO_FORMATS.includes(bare) ? bare : '';
}

/**
 * Validates one captured-audio upload against the allowlist
 * and the bounded size.
 * @param {object} audio { format|mimeType|filename, sizeBytes|byteLength }
 * @param {object} [options] { maxUploadBytes }
 * @returns {{ok: boolean, reason: string, format: string, sizeBytes: number}}
 */
export function validateAudioUpload(audio, options = {}) {
    const safe = isPlainObject(audio) ? audio : {};
    const opts = isPlainObject(options) ? options : {};
    const max = Number.isFinite(opts.maxUploadBytes) && opts.maxUploadBytes > 0
        ? opts.maxUploadBytes
        : DEFAULT_MAX_UPLOAD_BYTES;
    const format = normalizeAudioFormat(safe.format || safe.mimeType || safe.filename || safe.name || '');
    if (!format) {
        return { ok: false, reason: 'audio_format_not_allowed', format: '', sizeBytes: 0 };
    }
    const sizeBytes = Number.isFinite(safe.sizeBytes)
        ? safe.sizeBytes
        : (Number.isFinite(safe.byteLength) ? safe.byteLength : (safe.data && Number.isFinite(safe.data.byteLength) ? safe.data.byteLength : 0));
    if (sizeBytes <= 0) {
        return { ok: false, reason: 'audio_empty', format, sizeBytes };
    }
    if (sizeBytes > max) {
        return { ok: false, reason: 'audio_too_large', format, sizeBytes };
    }
    return { ok: true, reason: 'ok', format, sizeBytes };
}

function isPrivateIpv4(host) {
    const parts = host.split('.');
    if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) {
        return false;
    }
    const [a, b] = parts.map(Number);
    if (parts.some((p) => Number(p) > 255)) {
        return false;
    }
    if (a === 10 || a === 127) {
        return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
        return true;
    }
    if (a === 192 && b === 168) {
        return true;
    }
    if (a === 169 && b === 254) {
        return true;
    }
    if (a === 100 && b >= 64 && b <= 127) {
        return true; // CGNAT range, used by tailnets.
    }
    return false;
}

/**
 * Decides whether an STT endpoint is local-only: loopback,
 * private / link-local / tailnet IP, a .local / .lan / .home
 * / .ts.net name, or a single-label LAN hostname. Public and
 * cloud recognizer endpoints are rejected.
 * @param {string} endpoint Endpoint URL
 * @returns {{ok: boolean, reason: string, host: string}}
 */
export function validateSttEndpoint(endpoint) {
    const raw = cleanString(endpoint);
    if (!raw) {
        return { ok: false, reason: 'endpoint_missing', host: '' };
    }
    let url;
    try {
        url = new URL(raw);
    } catch {
        return { ok: false, reason: 'endpoint_invalid', host: '' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, reason: 'endpoint_protocol_not_allowed', host: '' };
    }
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) {
        return { ok: true, reason: 'ok', host };
    }
    if (isPrivateIpv4(host)) {
        return { ok: true, reason: 'ok', host };
    }
    if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home') || host.endsWith('.ts.net') || host.endsWith('.internal')) {
        return { ok: true, reason: 'ok', host };
    }
    if (!host.includes('.')) {
        return { ok: true, reason: 'ok', host }; // Single-label LAN / tailnet name.
    }
    return { ok: false, reason: 'endpoint_not_local', host };
}

/**
 * Extracts transcript text and finality from an
 * OpenAI-compatible transcription response.
 * @param {object|string} response { text, final? } or bare text
 * @returns {{text: string, isFinal: boolean}}
 */
export function extractTranscript(response) {
    if (typeof response === 'string') {
        return { text: response.trim(), isFinal: true };
    }
    if (!isPlainObject(response)) {
        return { text: '', isFinal: false };
    }
    const text = cleanString(response.text ?? response.transcript ?? '');
    const isFinal = response.final !== false && response.isFinal !== false && response.partial !== true;
    return { text, isFinal };
}

/**
 * Creates one push-to-talk session.
 * @param {object} options
 * @param {object} options.client Injected STT client with an
 *  async transcribe(request) method (and optional async
 *  upload(request)); request is { endpoint, audio, format,
 *  sizeBytes, attempt, cancelled } and transcribe resolves to
 *  an OpenAI-compatible { text, final? } payload.
 * @param {string} options.endpoint Local STT endpoint URL.
 * @param {boolean} [options.autoSend] Default false; send
 *  automatically on a final transcript only when true.
 * @param {number} [options.maxUploadBytes] Upload bound.
 * @param {number} [options.requestTimeoutMs] Request timeout,
 *  measured on the injected clock.
 * @param {Function} [options.onSend] Host send callback,
 *  called exactly once per finalized transcript cycle with
 *  { text, sendToken, sessionId, source }.
 * @param {boolean|Function} [options.playbackActive] TTS
 *  playback guard: boolean or getter function.
 * @param {Function} [options.now] Clock, defaults to Date.now.
 * @returns {object} Session (see methods inline)
 */
export function createPushToTalkSession(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const client = isPlainObject(opts.client) ? opts.client : null;
    const endpoint = cleanString(opts.endpoint);
    const autoSend = opts.autoSend === true;
    const maxUploadBytes = Number.isFinite(opts.maxUploadBytes) && opts.maxUploadBytes > 0
        ? opts.maxUploadBytes
        : DEFAULT_MAX_UPLOAD_BYTES;
    const requestTimeoutMs = Number.isFinite(opts.requestTimeoutMs) && opts.requestTimeoutMs > 0
        ? opts.requestTimeoutMs
        : DEFAULT_REQUEST_TIMEOUT_MS;
    const onSend = typeof opts.onSend === 'function' ? opts.onSend : null;
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

    let sessionCounter = 0;
    let state = 'idle';
    let mode = 'voice'; // 'voice' | 'typed'
    let captureId = 0;
    let attempt = 0;
    let generation = 0; // bumped by cancel; stale results are dropped
    let audio = null;
    let transcript = '';
    let partialTranscript = '';
    let previewKind = null; // 'final' | 'partial' | 'typed'
    let edited = false;
    let sourceText = '';
    let sendToken = null;
    let sentToken = null;
    let sentText = null;
    let lastError = null;
    let fallbackReason = null;
    let cancelRequested = false;
    let timing = freshTiming();
    let sessionPlaybackFlag = opts.playbackActive === true;

    function freshTiming() {
        return {
            captureStartedAt: null,
            captureEndedAt: null,
            uploadStartedAt: null,
            uploadEndedAt: null,
            transcriptionStartedAt: null,
            transcriptionEndedAt: null,
            previewAt: null,
            sentAt: null,
            captureDurationMs: null,
            uploadDurationMs: null,
            transcriptionDurationMs: null,
            roundTripMs: null,
        };
    }

    function playbackActive() {
        if (typeof opts.playbackActive === 'function') {
            return opts.playbackActive() === true;
        }
        return sessionPlaybackFlag === true;
    }

    function durations() {
        const span = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null);
        return {
            ...timing,
            captureDurationMs: span(timing.captureStartedAt, timing.captureEndedAt),
            uploadDurationMs: span(timing.uploadStartedAt, timing.uploadEndedAt),
            transcriptionDurationMs: span(timing.transcriptionStartedAt, timing.transcriptionEndedAt),
            roundTripMs: span(timing.captureStartedAt, timing.transcriptionEndedAt),
        };
    }

    function snapshot() {
        return {
            state,
            mode,
            sessionId: `ptt-session-${sessionCounter}`,
            captureId,
            attempt,
            transcript,
            partialTranscript,
            previewKind,
            isFinal: previewKind === 'final' || previewKind === 'typed',
            edited,
            autoSend,
            sendToken,
            sent: sentToken !== null,
            sentText,
            playbackActive: playbackActive(),
            fallbackAvailable: true,
            fallbackReason,
            lastError,
            timing: durations(),
        };
    }

    function newSendToken() {
        return `ptt-${sessionCounter}-${captureId}-${attempt}-${transcript.length}`;
    }

    /** Sets the host-side TTS playback guard flag. */
    function setPlaybackActive(value) {
        sessionPlaybackFlag = value === true;
        return snapshot();
    }

    /**
     * Begins microphone capture. Rejected while TTS playback
     * is active, so playback can never become a user message.
     * @returns {{ok: boolean, reason: string}}
     */
    function beginCapture() {
        if (playbackActive()) {
            return { ok: false, reason: 'tts_playback_active', ...snapshot() };
        }
        if (state === 'recording' || state === 'uploading' || state === 'transcribing') {
            return { ok: false, reason: 'capture_already_active', ...snapshot() };
        }
        sessionCounter++;
        captureId++;
        attempt = 0;
        generation++;
        mode = 'voice';
        audio = null;
        transcript = '';
        partialTranscript = '';
        previewKind = null;
        edited = false;
        sourceText = '';
        sendToken = null;
        sentToken = null;
        sentText = null;
        lastError = null;
        fallbackReason = null;
        cancelRequested = false;
        timing = freshTiming();
        timing.captureStartedAt = now();
        state = 'recording';
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    /**
     * Applies one transcription payload: partial text is held
     * apart from the final transcript and can never be sent.
     * @param {object|string} response STT payload
     * @returns {object} Snapshot fields
     */
    function applyTranscriptResult(response) {
        const { text, isFinal } = extractTranscript(response);
        if (!isFinal) {
            partialTranscript = text;
            previewKind = 'partial';
            state = 'preview';
            timing.previewAt = now();
            return snapshot();
        }
        transcript = text;
        sourceText = text;
        partialTranscript = '';
        previewKind = 'final';
        edited = false;
        sendToken = newSendToken();
        state = 'preview';
        timing.previewAt = now();
        return snapshot();
    }

    async function runTranscription() {
        const myGeneration = generation;
        attempt++;
        cancelRequested = false;
        const endpointCheck = validateSttEndpoint(endpoint);
        if (!endpointCheck.ok) {
            state = 'error';
            lastError = endpointCheck.reason;
            fallbackReason = endpointCheck.reason;
            return { ok: false, reason: endpointCheck.reason, ...snapshot() };
        }
        if (!client || typeof client.transcribe !== 'function') {
            state = 'error';
            lastError = 'stt_client_unavailable';
            fallbackReason = lastError;
            return { ok: false, reason: lastError, ...snapshot() };
        }
        const check = validateAudioUpload(audio, { maxUploadBytes });
        if (!check.ok) {
            state = 'error';
            lastError = check.reason;
            fallbackReason = check.reason;
            return { ok: false, reason: check.reason, ...snapshot() };
        }
        const request = {
            endpoint,
            audio,
            format: check.format,
            sizeBytes: check.sizeBytes,
            attempt,
            isCancelled: () => cancelRequested || myGeneration !== generation,
        };
        const startedAt = now();
        try {
            state = 'uploading';
            timing.uploadStartedAt = now();
            if (typeof client.upload === 'function') {
                await client.upload(request);
            }
            timing.uploadEndedAt = now();
            if (request.isCancelled()) {
                state = 'cancelled';
                return { ok: false, reason: 'cancelled', ...snapshot() };
            }
            state = 'transcribing';
            timing.transcriptionStartedAt = now();
            const response = await client.transcribe(request);
            timing.transcriptionEndedAt = now();
            if (request.isCancelled()) {
                state = 'cancelled';
                return { ok: false, reason: 'cancelled', ...snapshot() };
            }
            if (now() - startedAt > requestTimeoutMs) {
                state = 'error';
                lastError = 'stt_request_timeout';
                fallbackReason = lastError;
                return { ok: false, reason: lastError, ...snapshot() };
            }
            const applied = applyTranscriptResult(response);
            if (previewKind === 'final' && autoSend) {
                const sent = send();
                return { ok: sent.ok, reason: sent.reason, autoSent: sent.ok, ...snapshot() };
            }
            return { ok: true, reason: 'ok', ...applied };
        } catch (error) {
            if (request.isCancelled()) {
                state = 'cancelled';
                return { ok: false, reason: 'cancelled', ...snapshot() };
            }
            state = 'error';
            lastError = error instanceof Error ? error.message : 'stt_request_failed';
            fallbackReason = lastError;
            return { ok: false, reason: lastError, ...snapshot() };
        }
    }

    /**
     * Ends capture with the recorded audio and runs the
     * upload + transcription phases.
     * @param {object} capturedAudio { format, sizeBytes, data? }
     * @returns {Promise<object>} Result + snapshot fields
     */
    async function endCapture(capturedAudio) {
        if (state !== 'recording') {
            return { ok: false, reason: 'not_recording', ...snapshot() };
        }
        audio = isPlainObject(capturedAudio) ? capturedAudio : null;
        timing.captureEndedAt = now();
        return runTranscription();
    }

    /**
     * Cancels capture or an in-flight STT request. The audio
     * is retained so retry() can reuse it.
     * @returns {object} Result + snapshot fields
     */
    function cancel() {
        if (state === 'recording') {
            generation++;
            state = 'cancelled';
            return { ok: true, reason: 'cancelled', cancellable: true, ...snapshot() };
        }
        if (state === 'uploading' || state === 'transcribing') {
            cancelRequested = true;
            generation++;
            state = 'cancelled';
            return { ok: true, reason: 'cancelled', cancellable: true, ...snapshot() };
        }
        return { ok: false, reason: 'nothing_to_cancel', cancellable: false, ...snapshot() };
    }

    /**
     * Retries transcription with the retained audio; each
     * retry is a fresh attempt with a fresh generation.
     * @returns {Promise<object>} Result + snapshot fields
     */
    async function retry() {
        if (!audio) {
            return { ok: false, reason: 'no_audio_to_retry', ...snapshot() };
        }
        if (state !== 'cancelled' && state !== 'error') {
            return { ok: false, reason: 'retry_not_available', ...snapshot() };
        }
        generation++;
        lastError = null;
        return runTranscription();
    }

    /**
     * Corrects/edits the previewed transcript before send.
     * Only a final or typed preview can be edited.
     * @param {string} text Corrected text
     * @returns {object} Result + snapshot fields
     */
    function editTranscript(text) {
        if (state !== 'preview' || (previewKind !== 'final' && previewKind !== 'typed')) {
            return { ok: false, reason: 'no_final_transcript_to_edit', ...snapshot() };
        }
        transcript = cleanString(text);
        edited = transcript !== sourceText;
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    /**
     * Enters the typed fallback: manual typing goes through
     * the same preview / edit / send path as a transcript.
     * @param {string} [text] Typed text
     * @returns {object} Result + snapshot fields
     */
    function enterTypedFallback(text = '') {
        mode = 'typed';
        if (captureId === 0) {
            captureId++;
        }
        transcript = cleanString(text);
        sourceText = transcript;
        partialTranscript = '';
        previewKind = 'typed';
        edited = false;
        sendToken = newSendToken();
        state = 'preview';
        timing.previewAt = now();
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    /** Updates typed-fallback text while in preview. */
    function typeText(text) {
        if (mode !== 'typed' || state !== 'preview') {
            return enterTypedFallback(text);
        }
        return editTranscript(text);
    }

    /**
     * Sends the finalized transcript exactly once. A second
     * send for the same send token - after reconnect, after a
     * partial-then-final sequence, or a plain double call -
     * is rejected as a duplicate and never re-invokes onSend.
     * @returns {object} Result + snapshot fields
     */
    function send() {
        if (sentToken !== null && sendToken !== null && sentToken === sendToken) {
            return { ok: false, reason: 'duplicate_send_rejected', duplicate: true, ...snapshot() };
        }
        if (state === 'sent') {
            return { ok: false, reason: 'duplicate_send_rejected', duplicate: true, ...snapshot() };
        }
        if (previewKind === 'partial') {
            return { ok: false, reason: 'partial_transcript_not_sendable', ...snapshot() };
        }
        if (state !== 'preview' || !transcript) {
            return { ok: false, reason: 'nothing_to_send', ...snapshot() };
        }
        if (onSend) {
            onSend({ text: transcript, sendToken, sessionId: `ptt-session-${sessionCounter}`, source: mode });
        }
        sentToken = sendToken;
        sentText = transcript;
        timing.sentAt = now();
        state = 'sent';
        return { ok: true, reason: 'ok', duplicate: false, ...snapshot() };
    }

    /**
     * Simulates a transport reconnect: state, transcript and
     * the dedupe guard all survive untouched.
     * @returns {object} Snapshot fields
     */
    function reconnect() {
        return snapshot();
    }

    return {
        beginCapture,
        endCapture,
        applyTranscriptResult,
        cancel,
        retry,
        editTranscript,
        enterTypedFallback,
        typeText,
        send,
        reconnect,
        setPlaybackActive,
        getSnapshot: snapshot,
        snapshot,
    };
}
