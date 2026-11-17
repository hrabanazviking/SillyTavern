/**
 * RFST-023 - Optional context-sensitive character image suggestions.
 *
 * Roadmap evidence required (section 14): "Opt-in,
 * non-destructive triggers." Section 10 asks for global user
 * choices including optional image suggestions.
 *
 * The suggestions core (src/media/image-suggestions-core.js) is
 * imported and exercised for real here, against a mock router
 * seam (the RFST-015 contract), a mock suggester collaborator,
 * and an injected fake clock. It builds only on the real
 * RFST-014 registry categories - nothing is replicated.
 *
 * Live evidence status: generating an image from an accepted
 * suggestion needs a running ComfyUI; it was NOT running and
 * was not started for this package, so the live generation leg
 * is GATED (campaign/PROGRESS.md), exactly as RFST-013..016
 * gated theirs. This suite proves suggestions only - the core
 * never dispatches or generates an image.
 */
import { describe, test, expect } from '@jest/globals';

import {
    DEFAULT_COOLDOWN_MS,
    DEFAULT_MAX_PER_SESSION,
    DEFAULT_SUGGESTIONS_ENABLED,
    classifyContextSignals,
    createImageSuggestionSession,
} from '../src/media/image-suggestions-core.js';
import { IMAGE_CATEGORIES } from '../src/media/image-registry-core.js';

const ROSTER = ['Aria', 'Bram'];

function makeClock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeRouter() {
    const mock = {
        calls: [],
        route(request) {
            mock.calls.push(request);
            return { ok: true, via: 'automatic', category: request.category };
        },
    };
    mock.fn = (request) => mock.route(request);
    return mock;
}

function session(overrides = {}) {
    return createImageSuggestionSession({ enabled: true, roster: ROSTER, clock: makeClock(), ...overrides });
}

const OUTFIT_CONTEXT = { messages: [{ name: 'Aria', text: 'Aria is wearing a crimson gown tonight.' }] };

describe('opt-in only, disabled by default', () => {
    test('suggestions are disabled by default', () => {
        expect(DEFAULT_SUGGESTIONS_ENABLED).toBe(false);
        const s = createImageSuggestionSession({ roster: ROSTER, clock: makeClock() });
        expect(s.isEnabled()).toBe(false);
    });
    test('while disabled no suggestion is ever produced', () => {
        const s = createImageSuggestionSession({ roster: ROSTER, clock: makeClock() });
        const result = s.evaluate(OUTFIT_CONTEXT);
        expect(result.ok).toBe(false);
        expect(result.suggestion).toBeNull();
        expect(result.reason).toBe('suggestions_disabled');
        expect(s.snapshot().produced).toBe(0);
    });
    test('while disabled evaluation is a no-op: no collaborator is called', () => {
        const router = makeRouter();
        let suggesterCalls = 0;
        const s = createImageSuggestionSession({
            roster: ROSTER, clock: makeClock(), router: router.fn,
            suggester: () => { suggesterCalls++; return { promptSketch: 'x' }; },
        });
        s.evaluate(OUTFIT_CONTEXT);
        expect(suggesterCalls).toBe(0);
        expect(router.calls).toHaveLength(0);
    });
    test('disabling after enabling stops suggestions again', () => {
        const s = session();
        s.setEnabled(false);
        expect(s.evaluate(OUTFIT_CONTEXT).reason).toBe('suggestions_disabled');
    });
});

describe('context-sensitive triggers', () => {
    test('an outfit mention suggests a full-body image of that character', () => {
        const result = session().evaluate(OUTFIT_CONTEXT);
        expect(result.ok).toBe(true);
        expect(result.suggestion.character).toBe('Aria');
        expect(result.suggestion.trigger).toBe('outfit-mention');
        expect(result.suggestion.category).toBe('full-body');
        expect(result.suggestion.promptSketch).toContain('Aria');
        expect(result.suggestion.confidence).toBeGreaterThan(0);
    });
    test('an appearance mention suggests a portrait', () => {
        const result = session().evaluate({ messages: [{ text: 'Aria smiled, her dark hair falling over one shoulder.' }] });
        expect(result.ok).toBe(true);
        expect(result.suggestion.trigger).toBe('appearance-mention');
        expect(result.suggestion.category).toBe('portrait');
    });
    test('a new character introduction suggests an introducing portrait', () => {
        const result = session().evaluate({ messages: [{ text: 'Bram entered the hall and bowed.' }] });
        expect(result.ok).toBe(true);
        expect(result.suggestion.character).toBe('Bram');
        expect(result.suggestion.trigger).toBe('new-character');
    });
    test('an explicit newCharacters signal fires without keyword text', () => {
        const result = session().evaluate({ messages: [{ text: 'A stranger approaches.' }], newCharacters: ['Bram'] });
        expect(result.ok).toBe(true);
        expect(result.suggestion.trigger).toBe('new-character');
        expect(result.suggestion.character).toBe('Bram');
    });
    test('a scene change suggests scene continuation for a present character', () => {
        const result = session().evaluate({ messages: [{ text: 'Aria nodded.' }], presentCharacters: ['Aria'], sceneChanged: true });
        expect(result.ok).toBe(true);
        expect(result.suggestion.trigger).toBe('scene-change');
        expect(result.suggestion.category).toBe('scene-continuation');
    });
    test('a merely present character suggests a portrait', () => {
        const result = session().evaluate({ messages: [{ text: 'Aria waited by the door.' }] });
        expect(result.ok).toBe(true);
        expect(result.suggestion.trigger).toBe('character-present');
        expect(result.suggestion.category).toBe('portrait');
    });
    test('every suggested category is a real registry category', () => {
        for (const context of [OUTFIT_CONTEXT, { messages: [{ text: 'Bram entered.' }] }]) {
            const result = session().evaluate(context);
            expect(IMAGE_CATEGORIES).toContain(result.suggestion.category);
        }
    });
    test('classification is deterministic: same inputs, same signals', () => {
        const first = classifyContextSignals(OUTFIT_CONTEXT, ROSTER);
        const second = classifyContextSignals(OUTFIT_CONTEXT, ROSTER);
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
    test('no signal means no suggestion, with a named reason', () => {
        const result = session().evaluate({ messages: [{ text: 'The rain kept falling.' }] });
        expect(result.ok).toBe(false);
        expect(result.suggestion).toBeNull();
        expect(result.reason).toBe('no_signal');
    });
    test('missing context is reported honestly, never a suggestion', () => {
        expect(session().evaluate({}).reason).toBe('no_context');
        expect(session().evaluate({ messages: [] }).reason).toBe('no_context');
        expect(session().evaluate(null).reason).toBe('no_context');
    });
});

describe('honesty: never invent a character', () => {
    test('a present character outside the roster is reported unknown', () => {
        const result = session().evaluate({ messages: [{ text: 'Someone waits.' }], presentCharacters: ['Zoltan'] });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('unknown_character');
        expect(result.unknownCharacters).toContain('Zoltan');
    });
    test('a character in the text but not the roster yields no suggestion', () => {
        const result = session().evaluate({ messages: [{ text: 'Zoltan is wearing a black cloak.' }] });
        expect(result.ok).toBe(false);
        expect(result.suggestion).toBeNull();
    });
    test('an empty roster never produces a suggestion', () => {
        const s = createImageSuggestionSession({ enabled: true, roster: [], clock: makeClock() });
        expect(s.evaluate(OUTFIT_CONTEXT).ok).toBe(false);
    });
    test('an unavailable suggester is recorded, never a throw', () => {
        const s = session({ suggester: () => { throw new Error('down'); } });
        const result = s.evaluate(OUTFIT_CONTEXT);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('suggester_unavailable');
    });
    test('a suggester returning nothing is recorded as unavailable', () => {
        const s = session({ suggester: () => null });
        expect(s.evaluate(OUTFIT_CONTEXT).reason).toBe('suggester_unavailable');
    });
    test('a suggester sketch wins when it offers one', () => {
        const s = session({ suggester: () => ({ promptSketch: 'custom sketch of Aria' }) });
        expect(s.evaluate(OUTFIT_CONTEXT).suggestion.promptSketch).toBe('custom sketch of Aria');
    });
    test('invalid input never throws', () => {
        const s = session();
        expect(() => s.evaluate(42)).not.toThrow();
        expect(() => s.accept('nope')).not.toThrow();
        expect(() => s.dismiss(undefined)).not.toThrow();
        expect(s.evaluate(42).ok).toBe(false);
    });
});

describe('non-destructive: proposals only', () => {
    test('evaluation never calls the router and never generates', () => {
        const router = makeRouter();
        const s = session({ router: router.fn });
        s.evaluate(OUTFIT_CONTEXT);
        expect(router.calls).toHaveLength(0);
    });
    test('chat history is fingerprinted only and stays unchanged', () => {
        const history = [{ name: 'Aria', text: 'Aria is wearing a crimson gown.' }];
        const before = JSON.stringify(history);
        const s = session({ history });
        const evaluated = s.evaluate(OUTFIT_CONTEXT);
        const accepted = s.accept(evaluated.suggestion.id);
        expect(evaluated.historyUnchanged).toBe(true);
        expect(accepted.historyUnchanged).toBe(true);
        expect(s.snapshot().historyUnchanged).toBe(true);
        expect(JSON.stringify(history)).toBe(before);
    });
    test('accept returns the request for the router seam, exactly once', () => {
        const router = makeRouter();
        const s = session({ router: router.fn });
        const { suggestion } = s.evaluate(OUTFIT_CONTEXT);
        const result = s.accept(suggestion.id);
        expect(result.ok).toBe(true);
        expect(result.generatesImage).toBe(false);
        expect(result.request.category).toBe('full-body');
        expect(result.request.character).toBe('Aria');
        expect(result.request.prompt).toBe(suggestion.promptSketch);
        expect(router.calls).toHaveLength(1);
        expect(router.calls[0]).toEqual(result.request);
        expect(result.route.ok).toBe(true);
    });
    test('accept without an injected router still returns the request', () => {
        const s = session();
        const { suggestion } = s.evaluate(OUTFIT_CONTEXT);
        const result = s.accept(suggestion.id);
        expect(result.ok).toBe(true);
        expect(result.route).toBeNull();
        expect(result.routeReason).toBe('router_not_injected');
    });
    test('a resolved suggestion cannot be accepted or dismissed twice', () => {
        const s = session();
        const { suggestion } = s.evaluate(OUTFIT_CONTEXT);
        expect(s.accept(suggestion.id).ok).toBe(true);
        expect(s.accept(suggestion.id).reason).toBe('suggestion_already_resolved');
        expect(s.dismiss(suggestion.id).reason).toBe('suggestion_already_resolved');
    });
    test('unknown suggestion ids are named failures, not throws', () => {
        const s = session();
        expect(s.accept('suggestion-99').reason).toBe('suggestion_not_found');
        expect(s.dismiss('suggestion-99').reason).toBe('suggestion_not_found');
    });
    test('dismiss records the dismissal in the snapshot', () => {
        const s = session();
        const { suggestion } = s.evaluate(OUTFIT_CONTEXT);
        expect(s.dismiss(suggestion.id).ok).toBe(true);
        const snap = s.snapshot();
        expect(snap.dismissed).toBe(1);
        expect(snap.suggestions[0].status).toBe('dismissed');
    });
});

describe('throttling and cooldown', () => {
    test('a duplicate character+trigger inside the cooldown is suppressed', () => {
        const s = session();
        expect(s.evaluate(OUTFIT_CONTEXT).ok).toBe(true);
        const again = s.evaluate(OUTFIT_CONTEXT);
        expect(again.ok).toBe(false);
        expect(again.reason).toBe('cooldown_active');
    });
    test('the same trigger fires again after the cooldown window', () => {
        const clock = makeClock();
        const s = session({ clock });
        expect(s.evaluate(OUTFIT_CONTEXT).ok).toBe(true);
        clock.advance(DEFAULT_COOLDOWN_MS + 1);
        expect(s.evaluate(OUTFIT_CONTEXT).ok).toBe(true);
    });
    test('a different character is not suppressed by another cooldown', () => {
        const s = session();
        expect(s.evaluate(OUTFIT_CONTEXT).ok).toBe(true);
        const other = s.evaluate({ messages: [{ text: 'Bram is wearing a travelling cloak.' }] });
        expect(other.ok).toBe(true);
        expect(other.suggestion.character).toBe('Bram');
    });
    test('dismissal snoozes that trigger beyond the plain cooldown', () => {
        const clock = makeClock();
        const s = session({ clock });
        const { suggestion } = s.evaluate(OUTFIT_CONTEXT);
        s.dismiss(suggestion.id);
        clock.advance(DEFAULT_COOLDOWN_MS + 1);
        const result = s.evaluate(OUTFIT_CONTEXT);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('dismissed_snooze');
    });
    test('the per-session maximum caps suggestions', () => {
        const clock = makeClock();
        const s = session({ clock, maxPerSession: 2 });
        expect(s.evaluate(OUTFIT_CONTEXT).ok).toBe(true);
        clock.advance(DEFAULT_COOLDOWN_MS + 1);
        expect(s.evaluate(OUTFIT_CONTEXT).ok).toBe(true);
        clock.advance(DEFAULT_COOLDOWN_MS + 1);
        expect(s.evaluate(OUTFIT_CONTEXT).reason).toBe('session_limit_reached');
        expect(DEFAULT_MAX_PER_SESSION).toBeGreaterThan(0);
    });
});
