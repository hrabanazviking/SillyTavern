/**
 * RFST-014 - Image model/workflow inventory and benchmarks.
 *
 * Roadmap evidence required (section 14): "Reviewed local
 * registry with scoring." Section 10 asks for an inventory of
 * the owner's ComfyUI vault (names/metadata only, no models in
 * Git), benchmark scoring on anatomy / identity continuity /
 * prompt fidelity / runtime / memory / artifact rate, and a
 * registry RFST-015's router can select from with manual
 * override.
 *
 * The registry core (src/media/image-registry-core.js) is a
 * dependency-free module and IS imported and exercised for real
 * here (RFST-007/011/012 pattern) - nothing is replicated. The
 * bundled workflow JSON files are read from the repo and
 * analysed structurally. Fake entries exercise scoring with
 * known benchmarks; the real registry's benchmarks are all
 * unknown by design.
 *
 * Live evidence status: real benchmarking needs a running
 * ComfyUI. At inventory time (2026-11-17, read-only probe)
 * ComfyUI on the Z13 was NOT running (no process, port 8188
 * closed) and no service was started for this package, so the
 * benchmark leg is GATED (campaign/PROGRESS.md) and every real
 * benchmark dimension is honestly null here - never invented.
 */
import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    IMAGE_CATEGORIES,
    BENCHMARK_DIMENSIONS,
    DEFAULT_IMAGE_REGISTRY,
    emptyBenchmarks,
    validateEntry,
    validateRegistry,
    analyzeWorkflow,
    buildModelEntry,
    scoreEntry,
    rankEntries,
    resolveSelection,
    registrySummary,
} from '../src/media/image-registry-core.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readBundledWorkflow(name) {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'default', 'content', name), 'utf8'));
}

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

describe('reviewed local registry', () => {
    test('the shipped registry validates clean with unique ids', () => {
        const result = validateRegistry(DEFAULT_IMAGE_REGISTRY);
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
        expect(DEFAULT_IMAGE_REGISTRY.length).toBe(28);
    });

    test('inventory counts match the read-only vault probe', () => {
        const summary = registrySummary(DEFAULT_IMAGE_REGISTRY);
        expect(summary.byKind).toEqual({
            workflow: 2,
            checkpoint: 15,
            'diffusion-model': 5,
            lora: 2,
            'text-encoder': 3,
            vae: 1,
        });
        expect(summary.byAvailability).toEqual({ bundled: 2, installed: 26 });
    });

    test('spot-checked sizes match the probed vault bytes', () => {
        const byId = new Map(DEFAULT_IMAGE_REGISTRY.map((entry) => [entry.id, entry]));
        expect(byId.get('v15-pruned-emaonly').sizeBytes).toBe(4265146304);
        expect(byId.get('flux1-dev').sizeBytes).toBe(23802932552);
        expect(byId.get('ae-vae').sizeBytes).toBe(335304388);
    });

    test('every real benchmark is honestly unknown, never invented', () => {
        for (const entry of DEFAULT_IMAGE_REGISTRY) {
            for (const dimension of BENCHMARK_DIMENSIONS) {
                expect(entry.benchmarks[dimension]).toBeNull();
            }
            const score = scoreEntry(entry);
            expect(score.scoredDimensions).toEqual([]);
            expect(score.unknownDimensions).toEqual([...BENCHMARK_DIMENSIONS]);
            expect(score.breakdown.coverage).toBe(0);
            expect(score.breakdown.quality).toBe(0);
        }
        const summary = registrySummary(DEFAULT_IMAGE_REGISTRY);
        expect(summary.benchmarkedEntries).toBe(0);
        expect(summary.unbenchmarkedEntries).toBe(28);
    });

    test('entries carry metadata only: no paths, no assets, frozen', () => {
        expect(Object.isFrozen(DEFAULT_IMAGE_REGISTRY)).toBe(true);
        for (const entry of DEFAULT_IMAGE_REGISTRY) {
            expect(Object.isFrozen(entry)).toBe(true);
            const serialized = JSON.stringify(entry);
            expect(serialized).not.toMatch(/\/(home|mnt)\//);
            expect(serialized).not.toMatch(/\.gguf/);
            expect(entry.license).toBe('unknown');
        }
    });

    test('every roadmap category is covered by the registry', () => {
        const summary = registrySummary(DEFAULT_IMAGE_REGISTRY);
        for (const category of IMAGE_CATEGORIES) {
            expect(summary.byCategory[category]).toBeGreaterThan(0);
        }
        const editing = DEFAULT_IMAGE_REGISTRY.filter((entry) => entry.categories.includes('image-editing'));
        expect(editing.map((entry) => entry.id)).toEqual(['bundled-char-avatar-img2img']);
    });

    test('the avatar workflow honestly records its missing node', () => {
        const avatar = DEFAULT_IMAGE_REGISTRY.find((entry) => entry.id === 'bundled-char-avatar-img2img');
        expect(avatar.structure.externalNodes).toEqual(['ETN_LoadImageBase64']);
        expect(avatar.compatibilityNote).toMatch(/NOT present/);
    });
});

describe('workflow structural analysis (real bundled files)', () => {
    test('default workflow is API format with the ST placeholders', () => {
        const analysis = analyzeWorkflow(readBundledWorkflow('Default_Comfy_Workflow.json'));
        expect(analysis.apiFormat).toBe(true);
        expect(analysis.nodeCount).toBe(7);
        expect(analysis.hasKSampler).toBe(true);
        expect(analysis.hasSaveImage).toBe(true);
        expect(analysis.hasCheckpointLoader).toBe(true);
        expect(analysis.placeholders).toEqual(expect.arrayContaining(['%prompt%', '%negative_prompt%', '%model%', '%seed%']));
        expect(analysis.externalNodes).toEqual([]);
    });

    test('avatar workflow needs the external ETN node and img2img inputs', () => {
        const analysis = analyzeWorkflow(readBundledWorkflow('Char_Avatar_Comfy_Workflow.json'));
        expect(analysis.apiFormat).toBe(true);
        expect(analysis.nodeCount).toBe(9);
        expect(analysis.externalNodes).toEqual(['ETN_LoadImageBase64']);
        expect(analysis.placeholders).toContain('%char_avatar%');
    });

    test('UI-format and non-workflow values are not API format', () => {
        expect(analyzeWorkflow({ nodes: [], links: [] }).apiFormat).toBe(false);
        expect(analyzeWorkflow(null).nodeCount).toBe(0);
        expect(analyzeWorkflow('nope').apiFormat).toBe(false);
    });
});

describe('validation', () => {
    test('rejects duplicate ids, bad categories, bad benchmarks', () => {
        expect(validateRegistry([fakeEntry(), fakeEntry()]).valid).toBe(false);
        expect(validateEntry(fakeEntry({ categories: ['space-opera'] })).valid).toBe(false);
        expect(validateEntry(fakeEntry({ categories: [] })).valid).toBe(false);
        expect(validateEntry(fakeEntry({ kind: 'spaceship' })).valid).toBe(false);
        expect(validateEntry(fakeEntry({ priority: 101 })).valid).toBe(false);
        expect(validateEntry(fakeEntry({ sizeBytes: -1 })).valid).toBe(false);
        const badBench = fakeEntry();
        badBench.benchmarks = { ...emptyBenchmarks(), anatomy: 1.5 };
        expect(validateEntry(badBench).valid).toBe(false);
        const badRuntime = fakeEntry();
        badRuntime.benchmarks = { ...emptyBenchmarks(), runtimeMs: -5 };
        expect(validateEntry(badRuntime).valid).toBe(false);
        expect(validateEntry(null).valid).toBe(false);
        expect(validateRegistry('nope').valid).toBe(false);
    });

    test('accepts measured runtime/memory above 1 (they are not ratios)', () => {
        const measured = fakeEntry();
        measured.benchmarks = { ...emptyBenchmarks(), runtimeMs: 4200, memoryMb: 6100 };
        expect(validateEntry(measured).valid).toBe(true);
    });

    test('buildModelEntry turns a discovered row into a valid entry', () => {
        const entry = buildModelEntry({ id: 'fake-disc', fileName: 'Fake XL.safetensors', kind: 'checkpoint', family: 'sdxl', sizeBytes: 123, tags: ['photoreal'] });
        expect(validateEntry(entry).valid).toBe(true);
        expect(entry.availability).toBe('installed');
        expect(entry.benchmarks).toEqual(emptyBenchmarks());
    });
});

describe('scoring determinism', () => {
    test('same entry scores identically on repeated calls', () => {
        const entry = fakeEntry();
        expect(scoreEntry(entry)).toEqual(scoreEntry(entry));
        expect(scoreEntry(entry).total).toBe(40);
    });

    test('known benchmarks raise coverage and quality monotonically', () => {
        const unknown = scoreEntry(fakeEntry());
        const partial = fakeEntry();
        partial.benchmarks = { ...emptyBenchmarks(), anatomy: 0.5, promptFidelity: 0.5 };
        const full = fakeEntry();
        full.benchmarks = { anatomy: 1, identityContinuity: 1, promptFidelity: 1, runtimeMs: 1000, memoryMb: 2000, artifactRate: 0 };
        expect(scoreEntry(partial).total).toBeGreaterThan(unknown.total);
        expect(scoreEntry(full).total).toBeGreaterThan(scoreEntry(partial).total);
        expect(scoreEntry(full).scoredDimensions).toEqual([...BENCHMARK_DIMENSIONS]);
        expect(scoreEntry(full).unknownDimensions).toEqual([]);
    });

    test('a high artifact rate scores below the same entry with a low one', () => {
        const clean = fakeEntry();
        clean.benchmarks = { ...emptyBenchmarks(), artifactRate: 0 };
        const messy = fakeEntry();
        messy.benchmarks = { ...emptyBenchmarks(), artifactRate: 1 };
        expect(scoreEntry(clean).total).toBeGreaterThan(scoreEntry(messy).total);
    });

    test('missing availability scores zero availability points', () => {
        expect(scoreEntry(fakeEntry({ availability: 'missing' })).breakdown.availability).toBe(0);
        expect(scoreEntry(fakeEntry({ availability: 'unknown' })).breakdown.availability).toBe(10);
    });

    test('ranking is order-independent and tie-breaks by priority then id', () => {
        const a = fakeEntry({ id: 'a-entry', priority: 50 });
        const b = fakeEntry({ id: 'b-entry', priority: 50 });
        const c = fakeEntry({ id: 'c-entry', priority: 90 });
        const forward = rankEntries([a, b, c]).map((entry) => entry.id);
        const reversed = rankEntries([c, b, a]).map((entry) => entry.id);
        expect(forward).toEqual(reversed);
        expect(forward).toEqual(['c-entry', 'a-entry', 'b-entry']);
    });

    test('ranking filters by category, kind and tags without mutating inputs', () => {
        const portrait = fakeEntry({ id: 'p1' });
        const scenery = fakeEntry({ id: 's1', categories: ['environment'], tags: ['scenery'] });
        const input = [portrait, scenery];
        const snapshot = JSON.stringify(input);
        expect(rankEntries(input, { category: 'environment' }).map((entry) => entry.id)).toEqual(['s1']);
        expect(rankEntries(input, { tags: ['scenery'] }).map((entry) => entry.id)).toEqual(['s1']);
        expect(rankEntries(input, { kind: 'lora' })).toEqual([]);
        expect(JSON.stringify(input)).toBe(snapshot);
        expect(portrait.score).toBeUndefined();
    });

    test('the real registry ranks deterministically for a portrait request', () => {
        const first = rankEntries(DEFAULT_IMAGE_REGISTRY, { category: 'portrait' });
        const second = rankEntries(DEFAULT_IMAGE_REGISTRY, { category: 'portrait' });
        expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
        expect(first[0].id).toBe('bundled-default-txt2img');
    });
});

describe('manual override readiness (RFST-015 seam)', () => {
    test('automatic selection returns the top-ranked candidate', () => {
        const result = resolveSelection(DEFAULT_IMAGE_REGISTRY, { category: 'portrait', kind: 'workflow' });
        expect(result.ok).toBe(true);
        expect(result.via).toBe('automatic');
        expect(result.entry.id).toBe('bundled-default-txt2img');
    });

    test('a manual override wins over the automatic ranking', () => {
        const result = resolveSelection(DEFAULT_IMAGE_REGISTRY, { category: 'portrait', overrideId: 'realvisxl-v50-fp16' });
        expect(result.ok).toBe(true);
        expect(result.via).toBe('manual-override');
        expect(result.entry.id).toBe('realvisxl-v50-fp16');
        expect(result.fallback.id).not.toBe('realvisxl-v50-fp16');
    });

    test('an unknown override fails honestly with the fallback attached', () => {
        const result = resolveSelection(DEFAULT_IMAGE_REGISTRY, { category: 'portrait', overrideId: 'no-such-entry' });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('override_not_found');
        expect(result.entry).toBeNull();
        expect(result.fallback).not.toBeNull();
    });

    test('a missing override target is unavailable, never selected', () => {
        const gone = fakeEntry({ id: 'gone', availability: 'missing' });
        const result = resolveSelection([gone, fakeEntry({ id: 'here' })], { overrideId: 'gone' });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('override_unavailable');
        expect(result.fallback.id).toBe('here');
    });

    test('no candidates is a clean failure, not a throw', () => {
        const result = resolveSelection([], { category: 'portrait' });
        expect(result).toEqual({ ok: false, via: 'automatic', entry: null, reason: 'no_candidates', fallback: null });
        expect(resolveSelection(null).ok).toBe(false);
    });
});
