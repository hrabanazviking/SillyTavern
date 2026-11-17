/**
 * RFST-024 - Multi-character voice routing refinements.
 *
 * Roadmap evidence required (section 14): "Group chat
 * speaker handling tested."
 *
 * The core (src/voice/multi-character-voice-core.js) is
 * imported and exercised for real against a mock renderer
 * (the RFST-006 AllTalk seam in production) and the REAL
 * RFST-007 segmenter (parseMessageSegments) for the
 * raw-text path: the core consumes its { type, text }
 * output shape and never re-implements segmentation.
 *
 * Live evidence status: live group voice render needs a
 * live AllTalk render, which is GATED on GPU headroom
 * (RFST-006), so the live leg is GATED
 * (campaign/PROGRESS.md), exactly as RFST-006..023 gated
 * theirs.
 */
import { describe, test, expect } from '@jest/globals';

import {
    DEFAULT_ENABLED,
    NARRATION_SEGMENT_TYPES,
    ROUTER_STATES,
    createMultiCharacterVoiceRouter,
    isNarrationSegment,
    normalizeVoiceAssignments,
    resolveVoiceForSegment,
} from '../src/voice/multi-character-voice-core.js';
import { parseMessageSegments } from '../public/scripts/extensions/tts/segmentation.js';

function makeRenderer({ failFor = null } = {}) {
    const renderer = {
        calls: [],
        async render(route) {
            renderer.calls.push(route);
            if (failFor && route.speaker === failFor) throw new Error('render_failed_mock');
            return { ok: true };
        },
    };
    return renderer;
}

function makeRouter(extra = {}) {
    const renderer = extra.renderer || makeRenderer();
    const history = extra.history || [{ speaker: 'aria', text: 'earlier line' }];
    const router = createMultiCharacterVoiceRouter({
        renderer,
        history,
        voiceAssignments: { Aria: 'voice-aria', Bram: 'voice-bram' },
        roster: ['Aria', 'Bram', 'Celia'],
        narratorVoice: 'voice-narrator',
        defaultVoice: 'voice-default',
        enabled: true,
        ...(extra.routerOptions || {}),
    });
    return { router, renderer, history };
}

const dlg = (text) => ({ type: 'dialogue', text });
const nar = (text) => ({ type: 'other', text });
const act = (text) => ({ type: 'action', text });

describe('defaults and pure helpers', () => {
    test('router is disabled by default with documented constants', () => {
        expect(DEFAULT_ENABLED).toBe(false);
        expect(ROUTER_STATES).toContain('routed');
        expect(NARRATION_SEGMENT_TYPES).toContain('other');
        expect(NARRATION_SEGMENT_TYPES).toContain('action');
    });
    test('normalizeVoiceAssignments accepts objects, Maps and voice objects', () => {
        const fromObject = normalizeVoiceAssignments({ Aria: 'v1', Bram: { voice: 'v2' } });
        expect(fromObject.get('aria')).toBe('v1');
        expect(fromObject.get('bram')).toBe('v2');
        const fromMap = normalizeVoiceAssignments(new Map([['Celia', 'v3']]));
        expect(fromMap.get('celia')).toBe('v3');
        expect(normalizeVoiceAssignments(null).size).toBe(0);
        expect(normalizeVoiceAssignments({ Aria: '' }).size).toBe(0);
    });
    test('isNarrationSegment separates narration from dialogue', () => {
        expect(isNarrationSegment('other')).toBe(true);
        expect(isNarrationSegment('action')).toBe(true);
        expect(isNarrationSegment('narration')).toBe(true);
        expect(isNarrationSegment('dialogue')).toBe(false);
        expect(isNarrationSegment('')).toBe(false);
    });
    test('resolveVoiceForSegment: assigned dialogue and narrator narration', () => {
        const base = { assignments: { Aria: 'voice-aria' }, roster: ['Aria'], narratorVoice: 'voice-narrator', defaultVoice: 'voice-default' };
        const d = resolveVoiceForSegment({ ...base, speaker: 'Aria', segmentType: 'dialogue' });
        expect(d).toMatchObject({ ok: true, voice: 'voice-aria', voiceSource: 'assigned', usedFallback: false });
        const n = resolveVoiceForSegment({ ...base, speaker: 'Aria', segmentType: 'other' });
        expect(n).toMatchObject({ ok: true, voice: 'voice-narrator', voiceSource: 'narrator' });
    });
    test('resolveVoiceForSegment: unknown speaker and missing speaker are honest', () => {
        const base = { assignments: {}, roster: ['Aria'], narratorVoice: 'vn', defaultVoice: 'vd' };
        expect(resolveVoiceForSegment({ ...base, speaker: 'Ghost', segmentType: 'dialogue' }).reason).toBe('unknown_speaker');
        expect(resolveVoiceForSegment({ ...base, speaker: '', segmentType: 'dialogue' }).reason).toBe('speaker_missing');
    });
});

describe('disabled / global-off state', () => {
    test('a router constructed without enabled routes nothing and dispatches nothing', async () => {
        const renderer = makeRenderer();
        const router = createMultiCharacterVoiceRouter({ renderer, voiceAssignments: { Aria: 'v' }, roster: ['Aria'] });
        const result = await router.routeMessages([{ id: 'm1', speaker: 'Aria', segments: [dlg('hello')] }]);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('voice_routing_disabled');
        expect(result.routes).toHaveLength(0);
        expect(renderer.calls).toHaveLength(0);
        expect(router.snapshot().state).toBe('disabled');
    });
    test('enable() turns routing on and disable() turns it back off', async () => {
        const renderer = makeRenderer();
        const router = createMultiCharacterVoiceRouter({ renderer, voiceAssignments: { Aria: 'v' }, roster: ['Aria'] });
        expect(router.enable().ok).toBe(true);
        expect((await router.routeMessages([{ id: 'm1', speaker: 'Aria', segments: [dlg('hi')] }])).dispatched).toBe(1);
        expect(router.disable().ok).toBe(true);
        const off = await router.routeMessages([{ id: 'm2', speaker: 'Aria', segments: [dlg('again')] }]);
        expect(off.reason).toBe('voice_routing_disabled');
        expect(renderer.calls).toHaveLength(1);
    });
    test('setEnabled mirrors enable/disable', async () => {
        const { router } = makeRouter({ routerOptions: { enabled: false } });
        expect(router.snapshot().enabled).toBe(false);
        router.setEnabled(true);
        expect(router.snapshot().enabled).toBe(true);
        router.setEnabled(false);
        expect(router.snapshot().enabled).toBe(false);
    });
});

describe('group-chat speaker routing', () => {
    test('dialogue is dispatched to the speaker assigned voice exactly once per segment', async () => {
        const { router, renderer } = makeRouter();
        const result = await router.routeMessages([
            { id: 'm1', speaker: 'Aria', segments: [dlg('First line.'), dlg('Second line.')] },
        ]);
        expect(result.ok).toBe(true);
        expect(result.dispatched).toBe(2);
        expect(renderer.calls).toHaveLength(2);
        expect(renderer.calls.map((c) => c.voice)).toEqual(['voice-aria', 'voice-aria']);
        expect(renderer.calls.map((c) => c.segmentIndex)).toEqual([0, 1]);
        expect(renderer.calls[0].voiceSource).toBe('assigned');
    });
    test('narration and action segments go to the narrator voice, dialogue to the character', async () => {
        const { router, renderer } = makeRouter();
        await router.routeMessages([
            { id: 'm1', speaker: 'Bram', segments: [nar('The hall fell silent.'), act('He sets down his cup.'), dlg('You came.')] },
        ]);
        expect(renderer.calls.map((c) => [c.segmentType, c.voice])).toEqual([
            ['other', 'voice-narrator'], ['action', 'voice-narrator'], ['dialogue', 'voice-bram'],
        ]);
    });
    test('a narrator-speaker message is voiced by the narrator voice', async () => {
        const { router, renderer } = makeRouter();
        await router.routeMessages([{ id: 'n1', speaker: 'Narrator', segments: [dlg('Once, long ago.')] }]);
        expect(renderer.calls).toHaveLength(1);
        expect(renderer.calls[0].voice).toBe('voice-narrator');
        expect(renderer.calls[0].voiceSource).toBe('narrator');
    });
    test('speaker changes across a turn are dispatched in list order', async () => {
        const { router, renderer } = makeRouter();
        await router.routeMessages([
            { id: 'm1', speaker: 'Aria', segments: [dlg('Aria speaks.')] },
            { id: 'm2', speaker: 'Bram', segments: [dlg('Bram answers.')] },
            { id: 'm3', speaker: 'Aria', segments: [dlg('Aria again.')] },
        ]);
        expect(renderer.calls.map((c) => [c.speaker, c.voice])).toEqual([
            ['aria', 'voice-aria'], ['bram', 'voice-bram'], ['aria', 'voice-aria'],
        ]);
    });
    test('segments within one message keep their original order', async () => {
        const { router, renderer } = makeRouter();
        await router.routeMessages([
            { id: 'm1', speaker: 'Aria', segments: [nar('Before.'), dlg('One.'), nar('Middle.'), dlg('Two.')] },
        ]);
        expect(renderer.calls.map((c) => c.text)).toEqual(['Before.', 'One.', 'Middle.', 'Two.']);
    });
    test('raw text is routed through the injected real RFST-007 segmenter', async () => {
        const { router, renderer } = makeRouter({
            routerOptions: { segment: (text) => parseMessageSegments(text, { multiVoiceEnabled: true }) },
        });
        const result = await router.routeMessages([
            { id: 'm1', speaker: 'Aria', text: '*She smiles slowly.* "Hello there."' },
        ]);
        expect(result.dispatched).toBe(2);
        expect(renderer.calls.map((c) => [c.segmentType, c.voice, c.text])).toEqual([
            ['action', 'voice-narrator', 'She smiles slowly.'],
            ['dialogue', 'voice-aria', 'Hello there.'],
        ]);
    });
    test('raw text without an injected segmenter is one dialogue segment (no re-segmentation)', async () => {
        const { router, renderer } = makeRouter();
        await router.routeMessages([{ id: 'm1', speaker: 'Bram', text: 'A plain spoken line.' }]);
        expect(renderer.calls).toHaveLength(1);
        expect(renderer.calls[0]).toMatchObject({ segmentType: 'dialogue', voice: 'voice-bram', text: 'A plain spoken line.' });
    });
    test('speaker matching is case-insensitive and trims whitespace', async () => {
        const { router, renderer } = makeRouter();
        await router.routeMessages([{ id: 'm1', speaker: '  ARIA ', segments: [dlg('Loud and clear.')] }]);
        expect(renderer.calls[0].voice).toBe('voice-aria');
    });
});

describe('fallback voice for unassigned characters', () => {
    test('a known character with no assignment uses the fallback voice and the use is recorded', async () => {
        const { router, renderer } = makeRouter();
        const result = await router.routeMessages([{ id: 'm1', speaker: 'Celia', segments: [dlg('I have no voice of my own.')] }]);
        expect(result.dispatched).toBe(1);
        expect(renderer.calls[0].voice).toBe('voice-default');
        expect(renderer.calls[0].voiceSource).toBe('fallback');
        expect(renderer.calls[0].usedFallback).toBe(true);
        expect(result.fallbacks).toHaveLength(1);
        expect(result.fallbacks[0].speaker).toBe('celia');
        expect(router.snapshot().fallbackUseCount).toBe(1);
    });
    test('fallback is deterministic: the same unassigned character always gets the same fallback voice', async () => {
        const { router, renderer } = makeRouter();
        await router.routeMessages([
            { id: 'm1', speaker: 'Celia', segments: [dlg('One.')] },
            { id: 'm2', speaker: 'Celia', segments: [dlg('Two.')] },
        ]);
        expect(renderer.calls.map((c) => c.voice)).toEqual(['voice-default', 'voice-default']);
    });
    test('with no fallback voice configured an unassigned character is reported, never guessed', async () => {
        const { router, renderer } = makeRouter({ routerOptions: { defaultVoice: '' } });
        const result = await router.routeMessages([{ id: 'm1', speaker: 'Celia', segments: [dlg('Unvoiced.')] }]);
        expect(result.dispatched).toBe(0);
        expect(renderer.calls).toHaveLength(0);
        expect(result.unrouted).toHaveLength(1);
        expect(result.unrouted[0].reason).toBe('voice_not_assigned');
    });
    test('narration falls back to the speaker assigned voice when no narrator voice is configured', async () => {
        const { router, renderer } = makeRouter({ routerOptions: { narratorVoice: '' } });
        await router.routeMessages([{ id: 'm1', speaker: 'Aria', segments: [nar('Her own narration.')] }]);
        expect(renderer.calls[0].voice).toBe('voice-aria');
        expect(renderer.calls[0].voiceSource).toBe('assigned');
    });
    test('a narrator message with no narrator voice and no fallback is reported honestly', async () => {
        const { router, renderer } = makeRouter({ routerOptions: { narratorVoice: '', defaultVoice: '' } });
        const result = await router.routeMessages([{ id: 'n1', speaker: 'Narrator', segments: [nar('Silence.')] }]);
        expect(result.dispatched).toBe(0);
        expect(renderer.calls).toHaveLength(0);
        expect(result.unrouted[0].reason).toBe('narrator_voice_not_configured');
    });
});

describe('unknown speakers are reported, never voiced as someone else', () => {
    test('unknown dialogue is not dispatched and the speaker is reported', async () => {
        const { router, renderer } = makeRouter();
        const result = await router.routeMessages([{ id: 'm1', speaker: 'Ghost', segments: [dlg('Boo.')] }]);
        expect(result.dispatched).toBe(0);
        expect(renderer.calls).toHaveLength(0);
        expect(result.unknownSpeakers).toEqual(['ghost']);
        expect(result.unrouted[0].reason).toBe('unknown_speaker');
        expect(router.snapshot().unknownSpeakers).toEqual(['ghost']);
    });
    test('an unknown speaker does not stop known speakers in the same turn', async () => {
        const { router, renderer } = makeRouter();
        const result = await router.routeMessages([
            { id: 'm1', speaker: 'Ghost', segments: [dlg('Boo.')] },
            { id: 'm2', speaker: 'Aria', segments: [dlg('I am still here.')] },
        ]);
        expect(result.unknownSpeakers).toEqual(['ghost']);
        expect(renderer.calls).toHaveLength(1);
        expect(renderer.calls[0].voice).toBe('voice-aria');
    });
    test('narration attached to an unknown speaker still goes to the narrator, not to a character voice', async () => {
        const { router, renderer } = makeRouter();
        const result = await router.routeMessages([
            { id: 'm1', speaker: 'Ghost', segments: [nar('Something moved in the dark.'), dlg('Boo.')] },
        ]);
        expect(renderer.calls).toHaveLength(1);
        expect(renderer.calls[0].voice).toBe('voice-narrator');
        expect(result.unknownSpeakers).toEqual(['ghost']);
        expect(result.unrouted).toHaveLength(1);
    });
});

describe('duplicate routing is rejected (RFST-009 dedupe spirit)', () => {
    test('routing the same message id twice dispatches it only once', async () => {
        const { router, renderer } = makeRouter();
        const message = { id: 'm1', speaker: 'Aria', segments: [dlg('Once only.')] };
        expect((await router.routeMessages([message])).dispatched).toBe(1);
        const again = await router.routeMessages([message]);
        expect(again.dispatched).toBe(0);
        expect(again.duplicates).toHaveLength(1);
        expect(again.duplicates[0].reason).toBe('duplicate_message_rejected');
        expect(renderer.calls).toHaveLength(1);
    });
    test('the same content without an id is deduped by fingerprint', async () => {
        const { router, renderer } = makeRouter();
        await router.routeMessages([{ speaker: 'Bram', segments: [dlg('Same words.')] }]);
        const again = await router.routeMessages([{ speaker: 'Bram', segments: [dlg('Same words.')] }]);
        expect(again.duplicates).toHaveLength(1);
        expect(renderer.calls).toHaveLength(1);
    });
    test('different messages from the same speaker are not duplicates', async () => {
        const { router, renderer } = makeRouter();
        const result = await router.routeMessages([
            { id: 'm1', speaker: 'Aria', segments: [dlg('First.')] },
            { id: 'm2', speaker: 'Aria', segments: [dlg('Second.')] },
        ]);
        expect(result.duplicates).toHaveLength(0);
        expect(renderer.calls).toHaveLength(2);
    });
    test('reset() clears the dedupe guard for a genuinely new turn set', async () => {
        const { router, renderer } = makeRouter();
        const message = { id: 'm1', speaker: 'Aria', segments: [dlg('Encore.')] };
        await router.routeMessages([message]);
        expect(router.reset().ok).toBe(true);
        expect((await router.routeMessages([message])).dispatched).toBe(1);
        expect(renderer.calls).toHaveLength(2);
    });
});

describe('history and inputs are never mutated', () => {
    test('routing leaves the injected chat history untouched (fingerprint proof)', async () => {
        const history = [{ speaker: 'aria', text: 'earlier' }, { speaker: 'bram', text: 'also earlier' }];
        const before = JSON.stringify(history);
        const { router } = makeRouter({ history });
        const result = await router.routeMessages([
            { id: 'm1', speaker: 'Aria', segments: [dlg('New line.'), nar('A pause.')] },
            { id: 'm2', speaker: 'Ghost', segments: [dlg('Boo.')] },
        ]);
        expect(JSON.stringify(history)).toBe(before);
        expect(history).toHaveLength(2);
        expect(result.historyUnchanged).toBe(true);
        expect(router.snapshot().historyUnchanged).toBe(true);
    });
    test('routing does not mutate the routed messages themselves', async () => {
        const { router } = makeRouter();
        const messages = [{ id: 'm1', speaker: 'Aria', segments: [dlg('Keep me intact.')] }];
        const before = JSON.stringify(messages);
        await router.routeMessages(messages);
        expect(JSON.stringify(messages)).toBe(before);
    });
    test('a history getter is fingerprinted the same way', async () => {
        const history = [{ speaker: 'aria', text: 'x' }];
        const { router } = makeRouter({ routerOptions: { history: () => history } });
        const result = await router.routeMessages([{ id: 'm1', speaker: 'Aria', segments: [dlg('Hi.')] }]);
        expect(result.historyUnchanged).toBe(true);
    });
});

describe('renderer seam and failure honesty', () => {
    test('with no renderer, routes fail honestly and nothing throws', async () => {
        const router = createMultiCharacterVoiceRouter({
            voiceAssignments: { Aria: 'voice-aria' }, roster: ['Aria'], enabled: true,
        });
        const result = await router.routeMessages([{ id: 'm1', speaker: 'Aria', segments: [dlg('Hello?')] }]);
        expect(result.ok).toBe(false);
        expect(result.dispatched).toBe(0);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].reason).toBe('renderer_unavailable');
        expect(router.snapshot().lastError).toBe('renderer_unavailable');
    });
    test('a renderer failure on one speaker does not stop the rest of the turn', async () => {
        const renderer = makeRenderer({ failFor: 'bram' });
        const { router } = makeRouter({ renderer });
        const result = await router.routeMessages([
            { id: 'm1', speaker: 'Bram', segments: [dlg('This render fails.')] },
            { id: 'm2', speaker: 'Aria', segments: [dlg('This one works.')] },
        ]);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].speaker).toBe('bram');
        expect(result.dispatched).toBe(1);
        expect(result.routes[0].speaker).toBe('aria');
    });
    test('a speak() seam is accepted as the dispatch collaborator', async () => {
        const spoken = [];
        const renderer = { async speak(route) { spoken.push(route); } };
        const { router } = makeRouter({ renderer });
        await router.routeMessages([{ id: 'm1', speaker: 'Aria', segments: [dlg('Via speak.')] }]);
        expect(spoken).toHaveLength(1);
        expect(spoken[0].voice).toBe('voice-aria');
    });
    test('onRoute observes each dispatched route once and a throwing observer breaks nothing', async () => {
        const observed = [];
        const { router, renderer } = makeRouter({
            routerOptions: { onRoute: (route) => { observed.push(route); if (observed.length === 1) throw new Error('observer boom'); } },
        });
        const result = await router.routeMessages([
            { id: 'm1', speaker: 'Aria', segments: [dlg('One.'), dlg('Two.')] },
        ]);
        expect(result.dispatched).toBe(2);
        expect(observed).toHaveLength(2);
        expect(renderer.calls).toHaveLength(2);
    });
});

describe('malformed input is reported, never thrown', () => {
    test('an empty message list is an honest no_messages result', async () => {
        const { router } = makeRouter();
        const result = await router.routeMessages([]);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('no_messages');
    });
    test('a message with no speaker is unrouted with speaker_missing', async () => {
        const { router, renderer } = makeRouter();
        const result = await router.routeMessages([{ id: 'm1', segments: [dlg('Who said this?')] }]);
        expect(result.dispatched).toBe(0);
        expect(renderer.calls).toHaveLength(0);
        expect(result.unrouted[0].reason).toBe('speaker_missing');
    });
    test('a message with no segments and no text is unrouted honestly', async () => {
        const { router } = makeRouter();
        const result = await router.routeMessages([{ id: 'm1', speaker: 'Aria' }]);
        expect(result.dispatched).toBe(0);
        expect(result.unrouted[0].reason).toBe('message_has_no_segments');
    });
    test('non-object entries and garbage input never throw', async () => {
        const { router } = makeRouter();
        const result = await router.routeMessages([null, 42, 'text']);
        expect(result.dispatched).toBe(0);
        expect(result.unrouted.length).toBeGreaterThan(0);
        const garbage = await router.routeMessages(undefined);
        expect(garbage.ok).toBe(false);
    });
    test('snapshot reports assignments, voices and counters', async () => {
        const { router } = makeRouter();
        await router.routeMessages([{ id: 'm1', speaker: 'Celia', segments: [dlg('Count me.')] }]);
        const snap = router.snapshot();
        expect(snap.assignedSpeakers).toEqual(expect.arrayContaining(['aria', 'bram']));
        expect(snap.narratorVoice).toBe('voice-narrator');
        expect(snap.defaultVoice).toBe('voice-default');
        expect(snap.routedMessageCount).toBe(1);
        expect(snap.routedSegmentCount).toBe(1);
        expect(snap.fallbackUseCount).toBe(1);
    });
});
