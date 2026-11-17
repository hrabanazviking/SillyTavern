/**
 * Optional context-sensitive character image suggestions (RFST-023).
 *
 * Roadmap evidence required (section 14): "Opt-in,
 * non-destructive triggers." Section 10 asks for global user
 * choices including optional image suggestions: the companion
 * may NOTICE a moment worth illustrating and propose an image,
 * but the user alone decides whether anything is generated.
 *
 * This dependency-free core builds ONLY on existing contracts:
 * the RFST-014 registry categories (src/media/image-registry-core.js)
 * for the category a suggestion sketches, and the RFST-015 router
 * seam (src/media/image-workflow-router-core.js) via an injected
 * router collaborator that is called only when the user accepts
 * a suggestion. It does not duplicate registry data, it never
 * dispatches or generates an image, and it never inserts
 * anything into the chat.
 *
 * Rules, enforced by construction:
 *  - OPT-IN ONLY, disabled by default. While disabled, context
 *    evaluation is a no-op rejected with a named reason: no
 *    suggestion is ever produced and no collaborator is called.
 *  - CONTEXT-SENSITIVE: signals are a deterministic keyword /
 *    signal classification, a pure function of the inputs
 *    (character present, scene/location change, outfit or
 *    appearance mention, new character introduction). No signal
 *    means no suggestion, with a named reason.
 *  - NON-DESTRUCTIVE: a suggestion is a proposal only. It never
 *    auto-generates, never inserts into chat, and the injected
 *    chat history is only fingerprinted, never written - every
 *    snapshot reports historyUnchanged (the RFST-022 pattern).
 *    The user must explicitly accept (which returns the request
 *    for the injected router seam) or dismiss (which records
 *    the dismissal and snoozes that trigger).
 *  - THROTTLED: repeated suggestions for the same character +
 *    trigger are suppressed by a cooldown window on the
 *    injected clock, a per-session maximum applies, and a
 *    dismissal snoozes that character + trigger for longer.
 *  - HONEST: an unknown character, missing context, or an
 *    unavailable suggester collaborator is recorded by name.
 *    Nothing ever throws, and no character is ever invented:
 *    a suggestion can only name a character from the provided
 *    roster / context.
 *
 * Live generation is GATED: ComfyUI was not started for this
 * package (see campaign/PROGRESS.md), exactly as RFST-013..016
 * gated their live legs. Accepting a suggestion only produces
 * the request (and, with an injected router, its route); it
 * never generates an image.
 */

import { IMAGE_CATEGORIES } from './image-registry-core.js';

export const DEFAULT_SUGGESTIONS_ENABLED = false;
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
export const DEFAULT_DISMISSAL_SNOOZE_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_PER_SESSION = 5;

export const REASON_DISABLED = 'suggestions_disabled';
export const REASON_NO_CONTEXT = 'no_context';
export const REASON_NO_SIGNAL = 'no_signal';
export const REASON_UNKNOWN_CHARACTER = 'unknown_character';
export const REASON_SUGGESTER_UNAVAILABLE = 'suggester_unavailable';
export const REASON_COOLDOWN = 'cooldown_active';
export const REASON_DISMISSED_SNOOZE = 'dismissed_snooze';
export const REASON_SESSION_LIMIT = 'session_limit_reached';
export const REASON_NOT_FOUND = 'suggestion_not_found';
export const REASON_ALREADY_RESOLVED = 'suggestion_already_resolved';

export const TRIGGER_KINDS = Object.freeze([
    'new-character',
    'scene-change',
    'outfit-mention',
    'appearance-mention',
    'character-present',
]);

const TRIGGER_CATEGORY = Object.freeze({
    'new-character': 'portrait',
    'scene-change': 'scene-continuation',
    'outfit-mention': 'full-body',
    'appearance-mention': 'portrait',
    'character-present': 'portrait',
});

const TRIGGER_CONFIDENCE = Object.freeze({
    'new-character': 0.9,
    'scene-change': 0.8,
    'outfit-mention': 0.75,
    'appearance-mention': 0.7,
    'character-present': 0.6,
});

const ARRIVAL_WORDS = Object.freeze(['entered', 'arrives', 'arrived', 'appears', 'appeared', 'walks in', 'walked in', 'steps in', 'stepped in', 'joins', 'joined', 'emerges', 'emerged']);
const SCENE_WORDS = Object.freeze(['the scene shifts', 'meanwhile', 'arrive at', 'arrives at', 'enter the', 'enters the', 'the scene changes', 'later, at', 'back at the']);
const OUTFIT_WORDS = Object.freeze(['wearing', 'outfit', 'dress', 'gown', 'armor', 'armour', 'cloak', 'uniform', 'robe', 'changed into', 'costume', 'attire']);
const APPEARANCE_WORDS = Object.freeze(['hair', 'eyes', 'beautiful', 'handsome', 'appearance', 'scar', 'freckles', 'smile', 'looks', 'features']);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRoster(roster) {
    if (!Array.isArray(roster)) {
        return [];
    }
    const names = [];
    for (const entry of roster) {
        if (typeof entry === 'string' && entry.trim().length > 0) {
            names.push(entry.trim());
        } else if (isPlainObject(entry) && typeof entry.name === 'string' && entry.name.trim().length > 0) {
            names.push(entry.name.trim());
        }
    }
    return names;
}

function messageText(message) {
    if (typeof message === 'string') {
        return message;
    }
    if (isPlainObject(message) && typeof message.text === 'string') {
        return message.text;
    }
    return '';
}

function messageName(message) {
    return isPlainObject(message) && typeof message.name === 'string' ? message.name : null;
}

function fingerprintHistory(history) {
    try {
        const value = typeof history === 'function' ? history() : history;
        const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash * 31) + text.charCodeAt(i)) | 0;
        }
        return text.length + ':' + hash;
    } catch {
        return 'unreadable';
    }
}

/**
 * Classifies the signals in a chat context against a roster.
 * Pure and deterministic: the same inputs always classify the
 * same way. Only roster characters can be signal subjects; a
 * named character outside the roster is reported, never used.
 * @param {object} [context] { messages, presentCharacters, sceneChanged, newCharacters }
 * @param {Array} [roster] Character names or { name } entries
 * @returns {object} { signals, unknownCharacters, hasContext }
 */
export function classifyContextSignals(context = {}, roster = []) {
    const safe = isPlainObject(context) ? context : {};
    const names = normalizeRoster(roster);
    const messages = Array.isArray(safe.messages) ? safe.messages : [];
    const texts = messages.map(messageText);
    const joined = texts.join('\n').toLowerCase();
    const hasContext = messages.length > 0
        || (Array.isArray(safe.presentCharacters) && safe.presentCharacters.length > 0)
        || safe.sceneChanged === true
        || (Array.isArray(safe.newCharacters) && safe.newCharacters.length > 0);
    const mentioned = names.filter((name) => joined.includes(name.toLowerCase())
        || texts.some((text, i) => messageName(messages[i]) === name));
    const presentList = Array.isArray(safe.presentCharacters)
        ? safe.presentCharacters.filter((name) => typeof name === 'string')
        : [];
    const present = names.filter((name) => presentList.includes(name) || mentioned.includes(name));
    const unknownCharacters = presentList.filter((name) => !names.includes(name));
    const signals = [];
    const newNames = Array.isArray(safe.newCharacters)
        ? safe.newCharacters.filter((name) => typeof name === 'string')
        : [];
    for (const name of names) {
        const lower = name.toLowerCase();
        const isNew = newNames.includes(name)
            || (joined.includes(lower) && ARRIVAL_WORDS.some((word) => joined.includes(word))
                && texts.some((text) => text.toLowerCase().includes(lower) && ARRIVAL_WORDS.some((word) => text.toLowerCase().includes(word))));
        if (isNew) {
            signals.push({ kind: 'new-character', character: name, detail: 'character_introduction' });
            continue;
        }
        if (!present.includes(name)) {
            continue;
        }
        const ownTexts = texts.filter((text, i) => text.toLowerCase().includes(lower) || messageName(messages[i]) === name);
        const ownJoined = ownTexts.join('\n').toLowerCase();
        if (OUTFIT_WORDS.some((word) => ownJoined.includes(word))) {
            signals.push({ kind: 'outfit-mention', character: name, detail: 'outfit_or_attire_mentioned' });
        } else if (APPEARANCE_WORDS.some((word) => ownJoined.includes(word))) {
            signals.push({ kind: 'appearance-mention', character: name, detail: 'appearance_described' });
        } else {
            signals.push({ kind: 'character-present', character: name, detail: 'character_present_in_scene' });
        }
    }
    if (safe.sceneChanged === true || SCENE_WORDS.some((word) => joined.includes(word))) {
        const subject = present[0] || mentioned[0] || null;
        if (subject) {
            signals.unshift({ kind: 'scene-change', character: subject, detail: 'scene_or_location_change' });
        }
    }
    const priority = { 'new-character': 0, 'scene-change': 1, 'outfit-mention': 2, 'appearance-mention': 3, 'character-present': 4 };
    signals.sort((a, b) => (priority[a.kind] - priority[b.kind]) || a.character.localeCompare(b.character));
    return { signals, unknownCharacters, hasContext, present };
}

function defaultPromptSketch(suggestion) {
    const sketches = {
        'new-character': 'a portrait introducing ' + suggestion.character,
        'scene-change': 'continue the scene with ' + suggestion.character + ' in the new location',
        'outfit-mention': 'full body view of ' + suggestion.character + ' in the mentioned outfit',
        'appearance-mention': 'a portrait of ' + suggestion.character + ' as just described',
        'character-present': 'a portrait of ' + suggestion.character,
    };
    return sketches[suggestion.trigger] || ('a portrait of ' + suggestion.character);
}

/**
 * Creates an opt-in image suggestion session.
 * @param {object} [options] { enabled, roster, clock, router, suggester, history, cooldownMs, dismissalSnoozeMs, maxPerSession }
 * @returns {object} Session with evaluate / accept / dismiss / snapshot
 */
export function createImageSuggestionSession(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    let enabled = opts.enabled === true;
    const roster = normalizeRoster(opts.roster);
    const clock = isPlainObject(opts.clock) && typeof opts.clock.now === 'function' ? opts.clock : { now: () => Date.now() };
    const router = typeof opts.router === 'function' ? opts.router : null;
    const suggester = typeof opts.suggester === 'function' ? opts.suggester : null;
    const cooldownMs = Number.isFinite(opts.cooldownMs) && opts.cooldownMs >= 0 ? opts.cooldownMs : DEFAULT_COOLDOWN_MS;
    const snoozeMs = Number.isFinite(opts.dismissalSnoozeMs) && opts.dismissalSnoozeMs >= 0 ? opts.dismissalSnoozeMs : DEFAULT_DISMISSAL_SNOOZE_MS;
    const maxPerSession = Number.isFinite(opts.maxPerSession) && opts.maxPerSession >= 0 ? Math.floor(opts.maxPerSession) : DEFAULT_MAX_PER_SESSION;
    const historyFingerprint = fingerprintHistory(opts.history);
    const suggestions = [];
    const lastSuggestedAt = new Map();
    const snoozedUntil = new Map();
    let sequence = 0;
    let produced = 0;

    const keyOf = (character, trigger) => character + '|' + trigger;

    function historyUnchanged() {
        return fingerprintHistory(opts.history) === historyFingerprint;
    }

    function reject(reason, extra = {}) {
        return { ok: false, suggestion: null, reason, historyUnchanged: historyUnchanged(), ...extra };
    }

    function evaluate(context = {}) {
        try {
            if (!enabled) {
                return reject(REASON_DISABLED);
            }
            const classified = classifyContextSignals(context, roster);
            if (!classified.hasContext) {
                return reject(REASON_NO_CONTEXT, { signals: [] });
            }
            if (classified.signals.length === 0) {
                if (classified.unknownCharacters.length > 0) {
                    return reject(REASON_UNKNOWN_CHARACTER, { signals: [], unknownCharacters: classified.unknownCharacters });
                }
                return reject(REASON_NO_SIGNAL, { signals: [] });
            }
            const signal = classified.signals[0];
            if (!roster.includes(signal.character)) {
                return reject(REASON_UNKNOWN_CHARACTER, { signals: classified.signals });
            }
            const now = clock.now();
            const key = keyOf(signal.character, signal.kind);
            if ((snoozedUntil.get(key) || 0) > now) {
                return reject(REASON_DISMISSED_SNOOZE, { signals: classified.signals, trigger: signal.kind, character: signal.character });
            }
            if (produced >= maxPerSession) {
                return reject(REASON_SESSION_LIMIT, { signals: classified.signals });
            }
            const last = lastSuggestedAt.get(key);
            if (typeof last === 'number' && now - last < cooldownMs) {
                return reject(REASON_COOLDOWN, { signals: classified.signals, trigger: signal.kind, character: signal.character });
            }
            const category = TRIGGER_CATEGORY[signal.kind];
            const base = {
                character: signal.character,
                category: IMAGE_CATEGORIES.includes(category) ? category : 'portrait',
                trigger: signal.kind,
            };
            let promptSketch = defaultPromptSketch(base);
            if (suggester) {
                let offered = null;
                try {
                    offered = suggester({ ...base, context, signal });
                } catch {
                    return reject(REASON_SUGGESTER_UNAVAILABLE, { signals: classified.signals });
                }
                if (!offered || typeof offered.promptSketch !== 'string' || offered.promptSketch.trim().length === 0) {
                    return reject(REASON_SUGGESTER_UNAVAILABLE, { signals: classified.signals });
                }
                promptSketch = offered.promptSketch;
                if (typeof offered.category === 'string' && IMAGE_CATEGORIES.includes(offered.category)) {
                    base.category = offered.category;
                }
            }
            sequence++;
            produced++;
            lastSuggestedAt.set(key, now);
            const suggestion = {
                id: 'suggestion-' + sequence,
                character: base.character,
                category: base.category,
                promptSketch,
                trigger: signal.kind,
                triggerReason: signal.detail,
                confidence: TRIGGER_CONFIDENCE[signal.kind],
                createdAt: now,
                status: 'pending',
            };
            suggestions.push(suggestion);
            return { ok: true, suggestion, reason: 'signal_fired', signals: classified.signals, historyUnchanged: historyUnchanged() };
        } catch {
            return reject('evaluation_error');
        }
    }

    function find(id) {
        return suggestions.find((entry) => entry.id === id) || null;
    }

    function accept(id) {
        const suggestion = find(id);
        if (!suggestion) {
            return { ok: false, reason: REASON_NOT_FOUND, request: null, route: null, historyUnchanged: historyUnchanged() };
        }
        if (suggestion.status !== 'pending') {
            return { ok: false, reason: REASON_ALREADY_RESOLVED, request: null, route: null, historyUnchanged: historyUnchanged() };
        }
        suggestion.status = 'accepted';
        const request = {
            prompt: suggestion.promptSketch,
            category: suggestion.category,
            character: suggestion.character,
            suggestionId: suggestion.id,
            trigger: suggestion.trigger,
        };
        let route = null;
        let routeReason = 'router_not_injected';
        if (router) {
            try {
                route = router(request);
                routeReason = 'routed_via_router_seam';
            } catch {
                route = null;
                routeReason = 'router_unavailable';
            }
        }
        return { ok: true, reason: 'accepted', request, route, routeReason, generatesImage: false, historyUnchanged: historyUnchanged() };
    }

    function dismiss(id) {
        const suggestion = find(id);
        if (!suggestion) {
            return { ok: false, reason: REASON_NOT_FOUND, historyUnchanged: historyUnchanged() };
        }
        if (suggestion.status !== 'pending') {
            return { ok: false, reason: REASON_ALREADY_RESOLVED, historyUnchanged: historyUnchanged() };
        }
        suggestion.status = 'dismissed';
        suggestion.dismissedAt = clock.now();
        snoozedUntil.set(keyOf(suggestion.character, suggestion.trigger), clock.now() + snoozeMs);
        return { ok: true, reason: 'dismissed', suggestion, snoozedTrigger: suggestion.trigger, historyUnchanged: historyUnchanged() };
    }

    function snapshot() {
        return {
            enabled,
            produced,
            pending: suggestions.filter((entry) => entry.status === 'pending').length,
            accepted: suggestions.filter((entry) => entry.status === 'accepted').length,
            dismissed: suggestions.filter((entry) => entry.status === 'dismissed').length,
            suggestions: suggestions.map((entry) => ({ ...entry })),
            historyUnchanged: historyUnchanged(),
        };
    }

    return {
        isEnabled: () => enabled,
        setEnabled: (value) => { enabled = value === true; return enabled; },
        evaluate,
        accept,
        dismiss,
        snapshot,
        historyUnchanged,
    };
}
