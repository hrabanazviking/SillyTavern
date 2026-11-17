/**
 * RFST-015 - Automatic image workflow router.
 *
 * Roadmap evidence required (section 14): "Correct category
 * selection plus manual override." Section 10 asks for request
 * categorization and automatic workflow selection over the
 * RFST-014 registry, with manual override from one global
 * control and visibility of the selected workflow/model.
 *
 * The router core (src/media/image-workflow-router-core.js) is
 * imported and exercised for real here and builds only on the
 * real RFST-014 registry core - nothing is replicated. Expected
 * picks follow from the registry deterministic scoring:
 * bundled default workflow 46 (availability 30 + priority 16),
 * bundled avatar workflow 44, installed models 40, ties broken
 * by priority then id ascending.
 *
 * Live evidence status: routing a job on a real ComfyUI needs
 * it running; it was NOT running and was not started for this
 * package, so the live leg is GATED (campaign/PROGRESS.md),
 * exactly as RFST-013/014 gated theirs. This suite proves
 * selection only - the router never dispatches a job.
 */
import { describe, test, expect } from '@jest/globals';

import {
    classifyRequest,
    routeRequest,
    routeImageRequest,
} from '../src/media/image-workflow-router-core.js';
import {
    DEFAULT_IMAGE_REGISTRY,
    emptyBenchmarks,
} from '../src/media/image-registry-core.js';

function fakeEntry(overrides = {}) {
    return {
        id: 'fake-entry',
        kind: 'checkpoint',
        label: 'Fake.safetensors',
        source: 'fake',
        availability: 'installed',
        categories: ['portrait'],
        tags: ['photoreal'],
        priority: 50,
        modelId: 'Fake.safetensors',
        workflowFile: null,
        family: 'sdxl',
        familyBasis: 'name-and-size-heuristic',
        sizeBytes: 1000,
        license: 'unknown',
        benchmarks: emptyBenchmarks(),
        ...overrides,
    };
}

describe('category selection', () => {
    test('a portrait request classifies as portrait', () => {
        const result = classifyRequest({ prompt: 'a portrait of the captain, close-up face' });
        expect(result.category).toBe('portrait');
        expect(result.via).toBe('keywords');
        expect(result.ambiguous).toBe(false);
    });
    test('a full-body request classifies as full-body', () => {
        expect(classifyRequest({ prompt: 'full body view of her standing pose in a new outfit' }).category).toBe('full-body');
    });
    test('a landscape request classifies as environment', () => {
        expect(classifyRequest({ prompt: 'a wide landscape of forest and mountains at dawn' }).category).toBe('environment');
    });
    test('a drawing request classifies as illustration', () => {
        expect(classifyRequest({ prompt: 'an anime illustration, a watercolor painting' }).category).toBe('illustration');
    });
    test('a continue-the-scene request classifies as scene-continuation', () => {
        expect(classifyRequest({ prompt: 'continue the scene, show the next scene' }).category).toBe('scene-continuation');
    });
    test('an inpaint request classifies as image-editing', () => {
        expect(classifyRequest({ prompt: 'inpaint the hands and retouch this picture' }).category).toBe('image-editing');
    });
    test('editing with a source image classifies as image-editing', () => {
        const result = classifyRequest({ prompt: 'change her dress to red', hasSourceImage: true });
        expect(result.category).toBe('image-editing');
        expect(result.via).toBe('source-image-edit');
    });
    test('an explicit category beats keyword signals', () => {
        const result = classifyRequest({ prompt: 'a portrait of a forest', category: 'environment' });
        expect(result.category).toBe('environment');
        expect(result.via).toBe('explicit-category');
        expect(result.confidence).toBe(1);
    });
    test('orientation hints classify only when no keyword fires', () => {
        expect(classifyRequest({ prompt: 'her smiling', orientation: 'portrait' }).category).toBe('portrait');
        expect(classifyRequest({ prompt: 'the wide valley', orientation: 'landscape' }).category).toBe('environment');
        expect(classifyRequest({ prompt: 'a portrait', orientation: 'landscape' }).category).toBe('portrait');
    });
    test('a signalless request reports no category instead of guessing', () => {
        const result = classifyRequest({ prompt: 'make something nice' });
        expect(result.category).toBeNull();
        expect(result.reason).toBe('no_category_signals');
        expect(result.confidence).toBe(0);
    });
    test('tied signals are reported ambiguous, never silently picked', () => {
        const result = classifyRequest({ prompt: 'portrait landscape' });
        expect(result.category).toBeNull();
        expect(result.ambiguous).toBe(true);
        expect(result.reason).toBe('ambiguous_category_signals');
    });
    test('invalid input never throws and never classifies', () => {
        expect(classifyRequest(null).category).toBeNull();
        expect(classifyRequest({ category: 'not-a-category', prompt: 'zzz' }).category).toBeNull();
        expect(classifyRequest(42).reason).toBe('no_category_signals');
    });
});

describe('automatic workflow selection', () => {
    test('portrait routes to the bundled default workflow and a real model', () => {
        const result = routeImageRequest({ prompt: 'a portrait of the captain, close-up face' });
        expect(result.ok).toBe(true);
        expect(result.via).toBe('automatic');
        expect(result.category).toBe('portrait');
        expect(result.workflow.id).toBe('bundled-default-txt2img');
        expect(result.entry.id).toBe('bundled-default-txt2img');
        expect(result.model.kind).toBe('checkpoint');
        expect(result.model.id).toBe('babes-by-stable-yogi-pony-v65');
    });
    test('image-editing routes to the only editing workflow, the avatar workflow', () => {
        const result = routeImageRequest({ prompt: 'edit this image of her avatar', hasSourceImage: true });
        expect(result.category).toBe('image-editing');
        expect(result.workflow.id).toBe('bundled-char-avatar-img2img');
        expect(result.entry.id).toBe('bundled-char-avatar-img2img');
    });
    test('environment, illustration, full-body and scene-continuation pick per category', () => {
        for (const [prompt, category] of [
            ['a wide landscape of forest and mountains', 'environment'],
            ['an anime illustration', 'illustration'],
            ['full body standing pose', 'full-body'],
            ['continue the scene', 'scene-continuation'],
        ]) {
            const result = routeImageRequest({ prompt });
            expect(result.category).toBe(category);
            expect(result.via).toBe('automatic');
            expect(result.workflow.id).toBe('bundled-default-txt2img');
            expect(result.workflow.categories).toContain(category);
            expect(result.ranking[0]).toBe('bundled-default-txt2img');
        }
    });
    test('the selected model always supports the routed category', () => {
        const result = routeImageRequest({ prompt: 'a wide landscape' });
        expect(result.model.categories).toContain('environment');
    });
});

describe('manual override always wins', () => {
    test('a named model override beats the automatic workflow pick', () => {
        const result = routeImageRequest({ prompt: 'a portrait of the captain', overrideId: 'juggernautxl-ragnarok' });
        expect(result.via).toBe('manual-override');
        expect(result.reason).toBe('override_applied');
        expect(result.entry.id).toBe('juggernautxl-ragnarok');
    });
    test('a workflow-file override wins even on a category mismatch, and says so', () => {
        const result = routeImageRequest({ prompt: 'a wide landscape', overrideId: 'Char_Avatar_Comfy_Workflow.json' });
        expect(result.via).toBe('manual-override');
        expect(result.entry.id).toBe('bundled-char-avatar-img2img');
        expect(result.categoryMismatch).toBe(true);
    });
    test('a model filename override wins', () => {
        const result = routeImageRequest({ prompt: 'a portrait', overrideId: 'flux1-dev.safetensors' });
        expect(result.via).toBe('manual-override');
        expect(result.entry.id).toBe('flux1-dev');
    });
    test('an override category beats keyword classification', () => {
        const result = routeImageRequest({ prompt: 'a portrait of the captain', overrideCategory: 'environment' });
        expect(result.via).toBe('manual-override');
        expect(result.reason).toBe('override_category_applied');
        expect(result.category).toBe('environment');
        expect(result.classification.category).toBe('environment');
    });
    test('the object form of override works for entry and category alike', () => {
        const byEntry = routeImageRequest({ prompt: 'a portrait', override: { entryId: 'realvisxl-v50-fp16' } });
        expect(byEntry.entry.id).toBe('realvisxl-v50-fp16');
        const byCategory = routeImageRequest({ prompt: 'a portrait', override: { category: 'illustration' } });
        expect(byCategory.category).toBe('illustration');
        expect(byCategory.via).toBe('manual-override');
    });
    test('every valid registry entry can be forced by override', () => {
        for (const entry of DEFAULT_IMAGE_REGISTRY) {
            const result = routeImageRequest({ prompt: 'a portrait', overrideId: entry.id });
            expect(result.via).toBe('manual-override');
            expect(result.entry.id).toBe(entry.id);
        }
    });
});

describe('deterministic fallback, never a throw', () => {
    test('an unknown request falls back to the top-ranked entry overall and says why', () => {
        const result = routeImageRequest({ prompt: 'make something nice' });
        expect(result.ok).toBe(true);
        expect(result.via).toBe('fallback');
        expect(result.reason).toBe('no_category_signals');
        expect(result.entry.id).toBe('bundled-default-txt2img');
    });
    test('an ambiguous request falls back the same deterministic way', () => {
        const result = routeImageRequest({ prompt: 'portrait landscape' });
        expect(result.via).toBe('fallback');
        expect(result.reason).toBe('ambiguous_category_signals');
        expect(result.entry.id).toBe('bundled-default-txt2img');
    });
    test('fallback is byte-identical across repeated calls', () => {
        const first = routeImageRequest({ prompt: 'make something nice' });
        const second = routeImageRequest({ prompt: 'make something nice' });
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
    test('an unknown override falls back to the automatic pick and says why', () => {
        const result = routeImageRequest({ prompt: 'a portrait', overrideId: 'no-such-entry' });
        expect(result.via).toBe('fallback');
        expect(result.reason).toBe('override_not_found');
        expect(result.ok).toBe(true);
        expect(result.entry.id).toBe('bundled-default-txt2img');
        expect(result.fallback.entry.id).toBe('bundled-default-txt2img');
    });
    test('a missing override entry falls back and says why', () => {
        const entries = [fakeEntry({ id: 'gone-model', availability: 'missing' }), fakeEntry({ id: 'here-model' })];
        const result = routeRequest(entries, { prompt: 'a portrait', overrideId: 'gone-model' });
        expect(result.via).toBe('fallback');
        expect(result.reason).toBe('override_unavailable');
        expect(result.entry.id).toBe('here-model');
    });
    test('an empty registry is a clean failure, not a crash', () => {
        const result = routeRequest([], { prompt: 'a portrait' });
        expect(result.ok).toBe(false);
        expect(result.entry).toBeNull();
        expect(routeRequest(null, null).ok).toBe(false);
    });
    test('routing mutates neither the registry nor the request', () => {
        const request = { prompt: 'a portrait of the captain' };
        const before = JSON.stringify(DEFAULT_IMAGE_REGISTRY);
        routeImageRequest(request);
        expect(JSON.stringify(DEFAULT_IMAGE_REGISTRY)).toBe(before);
        expect(request).toEqual({ prompt: 'a portrait of the captain' });
    });
});
