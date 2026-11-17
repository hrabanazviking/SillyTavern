/**
 * Multi-character voice routing refinements (RFST-024).
 *
 * Roadmap evidence required (section 14): "Group chat
 * speaker handling tested." In a group chat several
 * characters (and a narrator) share one conversation, so a
 * single message can contain several speakers' lines and
 * narration interleaved; every spoken segment must reach
 * the voice of the character who actually speaks it.
 *
 * This dependency-free core implements that routing
 * against injected collaborators, exactly as RFST-009 /
 * RFST-022 injected their STT client, playback controller
 * and clock:
 *  - a segmenter seam: messages may arrive already
 *    segmented in the RFST-007 shape ({ type, text } from
 *    parseMessageSegments in
 *    public/scripts/extensions/tts/segmentation.js), or as
 *    raw text plus an injected segment(text) function with
 *    that same output shape. This core CONSUMES the
 *    RFST-007 output shape; it never re-implements
 *    segmentation.
 *  - a renderer / TTS client (the RFST-006 AllTalk
 *    contract in production, a mock in tests) with a
 *    render(route) method (speak(route) is also accepted).
 *    The core only SELECTS routes; dispatch happens
 *    through this injected seam, exactly once per routed
 *    segment.
 *  - an injected clock, so routing records are
 *    deterministic in tests.
 *
 * Routing rules:
 *  - Dialogue segments are voiced by the message speaker's
 *    assigned voice (per-character voice assignments).
 *  - Narration segments (RFST-007 types 'other' and
 *    'action', plus an explicit 'narration' type) are
 *    voiced by the narrator voice when one is configured.
 *  - A KNOWN character with no voice assignment uses the
 *    configured default / fallback voice, and that
 *    fallback use is always recorded on the route and in
 *    the result - a voice is never invented or randomized
 *    silently. With no fallback voice configured, the
 *    segment is reported unrouted, never guessed.
 *  - An UNKNOWN speaker (not in the roster and not in the
 *    voice assignments, and not a special speaker) is
 *    reported honestly in unknownSpeakers and its dialogue
 *    is NOT voiced as someone else.
 *  - Speaker changes are handled in order: messages are
 *    routed in list order and segments in message order,
 *    so interleaved speakers keep their turn order.
 *  - Duplicate routing of the same message is rejected:
 *    each message id (or a content fingerprint when no id
 *    is given) may be routed only once per router, in the
 *    RFST-009 dedupe spirit; a repeat is reported as a
 *    duplicate and dispatches nothing.
 *  - While the router is disabled (the global voice off
 *    state) no routing happens at all and nothing is
 *    dispatched.
 *
 * History rule: routing never mutates chat history or the
 * routed messages. The core only reads the injected
 * history (array or getter) to fingerprint it, and every
 * result reports historyUnchanged so a host (and the test
 * suite) can prove routing left history untouched.
 *
 * Nothing in this core ever throws: malformed messages,
 * missing collaborators and renderer failures are
 * recorded and reported in the result.
 *
 * Live group voice render is GATED: the live leg needs a
 * live AllTalk render (RFST-006: live render GATED on GPU
 * headroom), so this core is proven against a mock
 * renderer only (see campaign/PROGRESS.md), exactly as
 * RFST-006..023 gated their live legs.
 */

export const ROUTER_STATES = Object.freeze([
    'idle',
    'routing',
    'routed',
    'disabled',
    'error',
]);

export const DEFAULT_ENABLED = false;
export const NARRATOR_SPEAKER = 'narrator';
export const USER_SPEAKER = 'user';
export const NARRATION_SEGMENT_TYPES = Object.freeze(['other', 'action', 'narration']);
export const DIALOGUE_SEGMENT_TYPES = Object.freeze(['dialogue']);

export const SPECIAL_SPEAKERS = Object.freeze([NARRATOR_SPEAKER, USER_SPEAKER]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeSpeaker(value) {
    return cleanString(value).toLowerCase();
}

function fingerprintValue(value) {
    let hash = 0;
    const text = JSON.stringify(value) ?? '';
    for (let i = 0; i < text.length; i++) {
        hash = ((hash * 31) + text.charCodeAt(i)) | 0;
    }
    return { length: Array.isArray(value) ? value.length : text.length, hash };
}

function fingerprintHistory(history) {
    if (!Array.isArray(history)) {
        return null;
    }
    const fp = fingerprintValue(history);
    return { length: fp.length, hash: fp.hash };
}

/**
 * Normalizes a voice-assignment table (plain object or Map)
 * into a Map keyed by normalized speaker name.
 * @param {object|Map} assignments Speaker -> voice id
 * @returns {Map<string, string>} Normalized assignments
 */
export function normalizeVoiceAssignments(assignments) {
    const out = new Map();
    if (assignments instanceof Map) {
        for (const [key, value] of assignments.entries()) {
            const speaker = normalizeSpeaker(String(key));
            const voice = cleanString(typeof value === 'string' ? value : (isPlainObject(value) ? (value.voice ?? value.voiceId ?? '') : ''));
            if (speaker && voice) out.set(speaker, voice);
        }
        return out;
    }
    if (isPlainObject(assignments)) {
        for (const [key, value] of Object.entries(assignments)) {
            const speaker = normalizeSpeaker(key);
            const voice = cleanString(typeof value === 'string' ? value : (isPlainObject(value) ? (value.voice ?? value.voiceId ?? '') : ''));
            if (speaker && voice) out.set(speaker, voice);
        }
    }
    return out;
}

/**
 * Decides whether a segment type is narration (narrator
 * voice) rather than a character's spoken dialogue.
 * @param {string} type RFST-007 segment type
 * @returns {boolean} True for narration segment types
 */
export function isNarrationSegment(type) {
    return NARRATION_SEGMENT_TYPES.includes(cleanString(type).toLowerCase());
}

/**
 * Resolves the voice for one segment of one speaker.
 * @param {object} input { speaker, segmentType,
 *  assignments, roster, narratorVoice, defaultVoice }
 * @returns {object} { ok, voice, voiceSource, speaker,
 *  known, usedFallback, reason } - voiceSource is one of
 *  'assigned' | 'narrator' | 'fallback' | 'none'.
 */
export function resolveVoiceForSegment(input = {}) {
    const safe = isPlainObject(input) ? input : {};
    const speaker = normalizeSpeaker(safe.speaker ?? safe.speakerId ?? safe.name ?? '');
    const segmentType = cleanString(safe.segmentType ?? safe.type ?? 'dialogue').toLowerCase() || 'dialogue';
    const assignments = safe.assignments instanceof Map
        ? safe.assignments : normalizeVoiceAssignments(safe.assignments);
    const roster = new Set();
    if (Array.isArray(safe.roster)) {
        for (const entry of safe.roster) {
            const name = normalizeSpeaker(typeof entry === 'string' ? entry : (isPlainObject(entry) ? (entry.id ?? entry.name ?? entry.speaker ?? '') : ''));
            if (name) roster.add(name);
        }
    }
    const narratorVoice = cleanString(safe.narratorVoice ?? '');
    const defaultVoice = cleanString(safe.defaultVoice ?? safe.fallbackVoice ?? '');
    const isSpecial = SPECIAL_SPEAKERS.includes(speaker);
    const known = isSpecial || roster.has(speaker) || assignments.has(speaker);
    if (!speaker) {
        return { ok: false, voice: '', voiceSource: 'none', speaker, known: false, usedFallback: false, reason: 'speaker_missing' };
    }
    if (isNarrationSegment(segmentType) || speaker === NARRATOR_SPEAKER) {
        if (narratorVoice) {
            return { ok: true, voice: narratorVoice, voiceSource: 'narrator', speaker, known: true, usedFallback: false, reason: 'ok' };
        }
        if (speaker !== NARRATOR_SPEAKER && assignments.has(speaker)) {
            return { ok: true, voice: assignments.get(speaker), voiceSource: 'assigned', speaker, known: true, usedFallback: false, reason: 'ok' };
        }
        if (defaultVoice) {
            return { ok: true, voice: defaultVoice, voiceSource: 'fallback', speaker, known: true, usedFallback: true, reason: 'ok' };
        }
        return { ok: false, voice: '', voiceSource: 'none', speaker, known: true, usedFallback: false, reason: 'narrator_voice_not_configured' };
    }
    if (!known) {
        return { ok: false, voice: '', voiceSource: 'none', speaker, known: false, usedFallback: false, reason: 'unknown_speaker' };
    }
    if (assignments.has(speaker)) {
        return { ok: true, voice: assignments.get(speaker), voiceSource: 'assigned', speaker, known: true, usedFallback: false, reason: 'ok' };
    }
    if (defaultVoice) {
        return { ok: true, voice: defaultVoice, voiceSource: 'fallback', speaker, known: true, usedFallback: true, reason: 'ok' };
    }
    return { ok: false, voice: '', voiceSource: 'none', speaker, known: true, usedFallback: false, reason: 'voice_not_assigned' };
}

/**
 * Creates one multi-character voice router.
 * @param {object} options
 * @param {object} [options.renderer] Injected TTS/render
 *  collaborator with render(route) (or speak(route));
 *  route is { messageId, speaker, segmentIndex,
 *  segmentType, text, voice, voiceSource, usedFallback }.
 * @param {object} [options.client] Alias for renderer.
 * @param {object|Map} [options.voiceAssignments]
 *  Per-character voice assignments, speaker -> voice id.
 * @param {Array} [options.roster] Known speakers (names or
 *  { id|name } entries). A speaker in neither the roster
 *  nor the assignments is unknown and never voiced.
 * @param {string} [options.narratorVoice] Narrator voice.
 * @param {string} [options.defaultVoice] Fallback voice for
 *  known characters with no assignment (also accepted as
 *  options.fallbackVoice).
 * @param {Function} [options.segment] Injected RFST-007
 *  segmenter for raw-text messages:
 *  segment(text) -> [{ type, text }].
 * @param {boolean} [options.enabled] Initial state;
 *  default false (global voice off produces no routing).
 * @param {Array|Function} [options.history] Chat history
 *  (array or getter), fingerprinted, never written.
 * @param {Function} [options.onRoute] Optional observer
 *  called once per selected route (dispatch still happens
 *  only through the renderer seam).
 * @param {Function} [options.now] Clock, defaults Date.now.
 * @returns {object} Router (see methods inline)
 */
export function createMultiCharacterVoiceRouter(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const renderer = isPlainObject(opts.renderer) ? opts.renderer
        : (isPlainObject(opts.client) ? opts.client : null);
    const segmentFn = typeof opts.segment === 'function' ? opts.segment
        : (typeof opts.segmentMessage === 'function' ? opts.segmentMessage : null);
    const onRoute = typeof opts.onRoute === 'function' ? opts.onRoute : null;
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    const assignments = normalizeVoiceAssignments(opts.voiceAssignments ?? opts.assignments);
    const rosterInput = Array.isArray(opts.roster) ? opts.roster : [];
    const narratorVoice = cleanString(opts.narratorVoice ?? '');
    const defaultVoice = cleanString(opts.defaultVoice ?? opts.fallbackVoice ?? '');

    let enabled = opts.enabled === true;
    let state = enabled ? 'idle' : 'disabled';
    let routeCounter = 0;
    let routedMessageCount = 0;
    let fallbackUseCount = 0;
    let lastError = null;
    const routedIds = new Set();
    const unknownSpeakerSet = new Set();
    const historyAtStart = readHistory();

    function readHistory() {
        const history = typeof opts.history === 'function' ? opts.history() : opts.history;
        return fingerprintHistory(history);
    }

    function historyUnchanged() {
        const current = readHistory();
        if (historyAtStart === null || current === null) return true;
        return current.length === historyAtStart.length && current.hash === historyAtStart.hash;
    }

    function snapshot() {
        return {
            enabled,
            state,
            routedMessageCount,
            routedSegmentCount: routeCounter,
            fallbackUseCount,
            unknownSpeakers: [...unknownSpeakerSet],
            routedMessageIds: [...routedIds],
            narratorVoice: narratorVoice || null,
            defaultVoice: defaultVoice || null,
            assignedSpeakers: [...assignments.keys()],
            historyUnchanged: historyUnchanged(),
            lastError,
        };
    }

    /** Explicitly turns group voice routing on. */
    function enable() {
        enabled = true;
        if (state === 'disabled') state = 'idle';
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    /** Global off: no routing, no dispatch. */
    function disable() {
        enabled = false;
        state = 'disabled';
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    function setEnabled(value) {
        return value === true ? enable() : disable();
    }

    /** Clears the dedupe guard (a genuinely new turn set). */
    function reset() {
        routedIds.clear();
        state = enabled ? 'idle' : 'disabled';
        return { ok: true, reason: 'ok', ...snapshot() };
    }

    function messageSpeaker(message) {
        if (!isPlainObject(message)) return '';
        return normalizeSpeaker(message.speaker ?? message.speakerId ?? message.character ?? message.name ?? message.author ?? '');
    }

    function messageSegments(message) {
        if (!isPlainObject(message)) return { ok: false, reason: 'message_not_an_object', segments: [] };
        if (Array.isArray(message.segments)) {
            const segments = [];
            for (const seg of message.segments) {
                if (isPlainObject(seg) && cleanString(seg.text)) {
                    segments.push({ type: cleanString(seg.type).toLowerCase() || 'dialogue', text: cleanString(seg.text) });
                } else if (typeof seg === 'string' && cleanString(seg)) {
                    segments.push({ type: 'dialogue', text: cleanString(seg) });
                }
            }
            return { ok: true, reason: 'ok', segments };
        }
        const text = cleanString(message.text ?? message.content ?? message.message ?? '');
        if (!text) return { ok: false, reason: 'message_has_no_segments', segments: [] };
        if (segmentFn) {
            try {
                const produced = segmentFn(text, message);
                if (Array.isArray(produced)) {
                    const segments = produced
                        .filter((seg) => isPlainObject(seg) && cleanString(seg.text))
                        .map((seg) => ({ type: cleanString(seg.type).toLowerCase() || 'other', text: cleanString(seg.text) }));
                    return { ok: segments.length > 0, reason: segments.length > 0 ? 'ok' : 'segmenter_produced_no_segments', segments };
                }
            } catch (error) {
                return { ok: false, reason: error instanceof Error ? error.message : 'segmenter_failed', segments: [] };
            }
            return { ok: false, reason: 'segmenter_produced_no_segments', segments: [] };
        }
        // No segmenter injected: the whole text is one
        // dialogue segment (no segmentation re-implemented).
        return { ok: true, reason: 'ok', segments: [{ type: 'dialogue', text }] };
    }

    function messageId(message, speaker, segments) {
        if (isPlainObject(message)) {
            const id = message.id ?? message.messageId ?? message.uid;
            if (id !== undefined && id !== null && cleanString(String(id))) return String(id);
        }
        const fp = fingerprintValue({ speaker, segments });
        return `fp-${fp.hash}-${fp.length}`;
    }

    async function dispatch(route) {
        if (!renderer) return { ok: false, reason: 'renderer_unavailable' };
        const method = typeof renderer.render === 'function' ? 'render'
            : (typeof renderer.speak === 'function' ? 'speak' : null);
        if (!method) return { ok: false, reason: 'renderer_unavailable' };
        try {
            await renderer[method](route);
            return { ok: true, reason: 'ok' };
        } catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : 'render_failed' };
        }
    }

    /**
     * Routes one group-chat turn / message list, in order.
     * Accepts a single message object or an array. Each
     * message: { id?, speaker, segments? | text? }. Dispatch
     * happens through the injected renderer exactly once
     * per routed segment. Never throws.
     * @param {object|Array} input Message or message list
     * @returns {Promise<object>} { ok, reason, routes,
     *  dispatched, fallbacks, unknownSpeakers, duplicates,
     *  unrouted, failures, historyUnchanged, ... }
     */
    async function routeMessages(input) {
        const messages = Array.isArray(input) ? input : (isPlainObject(input) ? [input] : []);
        const base = {
            routes: [], dispatched: 0, fallbacks: [], unknownSpeakers: [],
            duplicates: [], unrouted: [], failures: [],
        };
        if (!enabled) {
            return { ok: false, reason: 'voice_routing_disabled', ...base, historyUnchanged: historyUnchanged(), ...snapshot() };
        }
        if (messages.length === 0) {
            return { ok: false, reason: 'no_messages', ...base, historyUnchanged: historyUnchanged(), ...snapshot() };
        }
        state = 'routing';
        const routedAt = now();
        for (const message of messages) {
            const speaker = messageSpeaker(message);
            const extracted = messageSegments(message);
            const id = messageId(message, speaker, extracted.segments);
            if (routedIds.has(id)) {
                base.duplicates.push({ messageId: id, speaker, reason: 'duplicate_message_rejected' });
                continue;
            }
            if (!speaker) {
                base.unrouted.push({ messageId: id, speaker, reason: 'speaker_missing' });
                continue;
            }
            if (!extracted.ok || extracted.segments.length === 0) {
                base.unrouted.push({ messageId: id, speaker, reason: extracted.reason });
                continue;
            }
            // Mark before dispatch: a message is routed at
            // most once, even if a render call fails.
            routedIds.add(id);
            routedMessageCount++;
            for (let index = 0; index < extracted.segments.length; index++) {
                const segment = extracted.segments[index];
                const resolved = resolveVoiceForSegment({
                    speaker, segmentType: segment.type,
                    assignments, roster: rosterInput, narratorVoice, defaultVoice,
                });
                if (!resolved.ok) {
                    if (resolved.reason === 'unknown_speaker') {
                        unknownSpeakerSet.add(speaker);
                        if (!base.unknownSpeakers.includes(speaker)) base.unknownSpeakers.push(speaker);
                    }
                    base.unrouted.push({ messageId: id, speaker, segmentIndex: index, segmentType: segment.type, reason: resolved.reason });
                    continue;
                }
                const route = {
                    messageId: id, speaker, segmentIndex: index,
                    segmentType: segment.type, text: segment.text,
                    voice: resolved.voice, voiceSource: resolved.voiceSource,
                    usedFallback: resolved.usedFallback, routedAt,
                };
                if (resolved.usedFallback) {
                    fallbackUseCount++;
                    base.fallbacks.push({ ...route });
                }
                const sent = await dispatch(route);
                if (!sent.ok) {
                    lastError = sent.reason;
                    base.failures.push({ ...route, reason: sent.reason });
                    continue;
                }
                routeCounter++;
                base.routes.push(route);
                base.dispatched++;
                if (onRoute) {
                    try { onRoute(route); } catch { /* observer errors never break routing */ }
                }
            }
        }
        state = base.failures.length > 0 ? 'error' : 'routed';
        const ok = base.routes.length > 0 || (base.duplicates.length > 0 && base.unrouted.length === 0);
        return {
            ok,
            reason: base.failures.length > 0 ? 'render_failed'
                : (base.routes.length > 0 ? 'ok'
                    : (base.duplicates.length > 0 ? 'duplicate_message_rejected' : 'nothing_routed')),
            ...base,
            historyUnchanged: historyUnchanged(),
            ...snapshot(),
        };
    }

    return {
        enable, disable, setEnabled, reset,
        routeMessages,
        routeTurn: routeMessages,
        routeMessage: routeMessages,
        resolveVoice: (input) => resolveVoiceForSegment({
            ...(isPlainObject(input) ? input : {}),
            assignments, roster: rosterInput, narratorVoice, defaultVoice,
        }),
        getSnapshot: snapshot,
        snapshot,
    };
}
