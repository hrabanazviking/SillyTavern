/**
 * RFST-021 - Update/merge compatibility harness.
 *
 * Roadmap evidence required (section 14): "Upstream merges
 * do not silently break adapters."
 *
 * The harness core (src/integration/merge-compatibility-core.js)
 * is exercised for real: its inventory is checked against
 * the adapter modules that actually exist on disk (imported
 * here directly), and simulated upstream-merge damage
 * (dropped module, dropped export, renamed export, changed
 * kind, changed arity, behavior drift caught by contract
 * probes) is proven to fail LOUDLY - a failed overall
 * result, named failures, and an assertCompatible throw -
 * never a silent pass. No live upstream merge is performed
 * and no live service is contacted.
 *
 * Live evidence status: running the harness as part of an
 * actual upstream merge is GATED on a merge actually being
 * performed (campaign/PROGRESS.md); the mock-damage suite
 * is the banked evidence for this package.
 */
import { describe, test, expect } from '@jest/globals';

import {
    ADAPTER_IDS,
    ADAPTER_INVENTORY,
    CHECK_STATUSES,
    FAILURE_TYPES,
    assertCompatible,
    buildCompatibilityReport,
    checkAdapter,
    createMapLoader,
    runCompatibilityCheck,
    validateInventory,
} from '../src/integration/merge-compatibility-core.js';

import * as gatewayCore from '../src/second-brain/gateway-core.js';
import * as ragCore from '../src/second-brain/rag-injection-core.js';
import * as pushToTalkCore from '../src/voice/push-to-talk-core.js';
import * as imageRegistryCore from '../src/media/image-registry-core.js';
import * as imageRouterCore from '../src/media/image-workflow-router-core.js';
import * as idleLifecycleCore from '../src/media/comfyui-idle-lifecycle-core.js';
import * as panelCore from '../src/settings/integration-panel-core.js';
import * as hardeningCore from '../src/settings/transport-hardening-core.js';
import * as resourceQueueCore from '../src/scheduling/resource-queue-core.js';
import * as scenarioMatrixCore from '../src/integration/scenario-matrix-core.js';

const REAL_MODULES = {
    'src/second-brain/gateway-core.js': gatewayCore,
    'src/second-brain/rag-injection-core.js': ragCore,
    'src/voice/push-to-talk-core.js': pushToTalkCore,
    'src/media/image-registry-core.js': imageRegistryCore,
    'src/media/image-workflow-router-core.js': imageRouterCore,
    'src/media/comfyui-idle-lifecycle-core.js': idleLifecycleCore,
    'src/settings/integration-panel-core.js': panelCore,
    'src/settings/transport-hardening-core.js': hardeningCore,
    'src/scheduling/resource-queue-core.js': resourceQueueCore,
    'src/integration/scenario-matrix-core.js': scenarioMatrixCore,
};

const REAL_PROBES = {
    'second-brain-gateway': [
        { name: 'search route still resolves', export: 'resolveGatewayRoute', run: (m) => m.resolveGatewayRoute('GET', '/search')?.action === 'search' },
    ],
    'second-brain-rag': [
        { name: 'token estimate still positive for text', export: 'estimateTokens', run: (m) => m.estimateTokens('hello') > 0 },
    ],
    'push-to-talk': [
        { name: 'mpeg still normalizes to mp3', export: 'normalizeAudioFormat', run: (m) => m.normalizeAudioFormat('audio/mpeg') === 'mp3' },
    ],
    'image-registry': [
        { name: 'default registry still summarizes non-empty', export: 'registrySummary', run: (m) => m.registrySummary(m.DEFAULT_IMAGE_REGISTRY).total === m.DEFAULT_IMAGE_REGISTRY.length && m.DEFAULT_IMAGE_REGISTRY.length > 0 },
    ],
    'image-workflow-router': [
        { name: 'empty request still yields no category', export: 'classifyRequest', run: (m) => m.classifyRequest(null).category === null },
    ],
    'comfyui-idle-lifecycle': [
        { name: 'queue counts still total running plus pending', export: 'queueCounts', run: (m) => m.queueCounts({ queue_running: [1, 2], queue_pending: [3] }).total === 3 },
    ],
    'integration-panel': [
        { name: 'default settings still carry the knowledge toggle', export: 'createDefaultSettings', run: (m) => typeof m.createDefaultSettings().knowledge === 'object' },
    ],
    'transport-hardening': [
        { name: 'loopback still classifies as loopback', export: 'classifyHost', run: (m) => m.classifyHost('127.0.0.1') === 'loopback' },
    ],
    'resource-queue': [
        { name: 'interactive text still outranks media', export: 'priorityForService', run: (m) => m.priorityForService('gufo-chat') < m.priorityForService('comfyui') },
        { name: 'first backoff still equals the base delay', export: 'backoffDelayMs', run: (m) => m.backoffDelayMs(1) === m.DEFAULT_BASE_BACKOFF_MS },
    ],
    'scenario-matrix': [
        { name: 'banked scenario matrix still validates complete', export: 'validateScenarioMatrix', run: (m) => m.validateScenarioMatrix().complete === true },
    ],
};

describe('adapter inventory', () => {
    test('inventory covers exactly the adapter modules that exist on disk', () => {
        expect(ADAPTER_INVENTORY.map((entry) => entry.path).sort())
            .toEqual(Object.keys(REAL_MODULES).sort());
        expect(ADAPTER_IDS).toEqual(ADAPTER_INVENTORY.map((entry) => entry.id));
        expect(new Set(ADAPTER_IDS).size).toBe(ADAPTER_IDS.length);
    });

    test('inventory itself is a valid contract', () => {
        const validity = validateInventory();
        expect(validity.valid).toBe(true);
        expect(validity.problems).toEqual([]);
    });

    test('statuses and failure types are the loud, closed sets', () => {
        expect(CHECK_STATUSES).toEqual(['passed', 'failed']);
        expect(FAILURE_TYPES).toContain('missing-module');
        expect(FAILURE_TYPES).toContain('missing-export');
        expect(FAILURE_TYPES).toContain('probe-failed');
    });

    test('validateInventory rejects duplicate ids and unknown kinds', () => {
        const broken = [
            { id: 'x', package: 'RFST-000', path: 'src/x.js', expectedExports: [{ name: 'a', kind: 'function' }] },
            { id: 'x', package: 'RFST-000', path: 'src/y.js', expectedExports: [{ name: 'b', kind: 'mystery' }] },
        ];
        const validity = validateInventory(broken);
        expect(validity.valid).toBe(false);
        expect(validity.problems.join(' ')).toMatch(/duplicate adapter id/);
        expect(validity.problems.join(' ')).toMatch(/unknown kind/);
    });
});

describe('real adapters pass the harness', () => {
    test('full check against the real modules passes with no failures', async () => {
        const check = await runCompatibilityCheck({
            loadModule: createMapLoader(REAL_MODULES),
            probesById: REAL_PROBES,
        });
        expect(check.ok).toBe(true);
        expect(check.total).toBe(ADAPTER_INVENTORY.length);
        expect(check.passed).toBe(check.total);
        expect(check.failed).toBe(0);
        expect(check.failures).toEqual([]);
        expect(() => assertCompatible(check)).not.toThrow();
    });

    test('every real adapter individually passes its contract and probes', () => {
        for (const entry of ADAPTER_INVENTORY) {
            const result = checkAdapter(entry, REAL_MODULES[entry.path], REAL_PROBES[entry.id] ?? []);
            expect(result.status).toBe('passed');
            expect(result.failures).toEqual([]);
        }
    });

    test('report for a clean tree says every adapter passed', async () => {
        const check = await runCompatibilityCheck({ loadModule: createMapLoader(REAL_MODULES) });
        const report = buildCompatibilityReport(check);
        expect(report.ok).toBe(true);
        expect(report.text).toMatch(/10\/10 adapters passed, 0 failed/);
    });
});

describe('simulated upstream merge damage fails loudly', () => {
    test('a dropped module is a missing-module failure, never a skip', async () => {
        const check = await runCompatibilityCheck({
            loadModule: createMapLoader(REAL_MODULES, { dropModules: ['src/voice/push-to-talk-core.js'] }),
        });
        expect(check.ok).toBe(false);
        expect(check.failed).toBe(1);
        expect(check.failures).toHaveLength(1);
        expect(check.failures[0]).toMatchObject({ adapter: 'push-to-talk', type: 'missing-module' });
        expect(() => assertCompatible(check)).toThrow(/push-to-talk/);
    });

    test('a dropped export is named as a missing-export failure', async () => {
        const check = await runCompatibilityCheck({
            loadModule: createMapLoader(REAL_MODULES, {
                dropExports: { 'src/settings/transport-hardening-core.js': ['classifyHost'] },
            }),
        });
        expect(check.ok).toBe(false);
        expect(check.failures).toContainEqual(expect.objectContaining({
            adapter: 'transport-hardening', type: 'missing-export', export: 'classifyHost',
        }));
    });

    test('a renamed export fails on the old name the fork relies on', async () => {
        const check = await runCompatibilityCheck({
            loadModule: createMapLoader(REAL_MODULES, {
                renameExports: { 'src/second-brain/rag-injection-core.js': { estimateTokens: 'countTokens' } },
            }),
        });
        expect(check.ok).toBe(false);
        expect(check.failures).toContainEqual(expect.objectContaining({
            adapter: 'second-brain-rag', type: 'missing-export', export: 'estimateTokens',
        }));
    });

    test('an export replaced with the wrong kind is a wrong-kind failure', async () => {
        const check = await runCompatibilityCheck({
            loadModule: createMapLoader(REAL_MODULES, {
                replaceExports: { 'src/scheduling/resource-queue-core.js': { createResourceQueue: { not: 'a function' } } },
            }),
        });
        expect(check.ok).toBe(false);
        expect(check.failures).toContainEqual(expect.objectContaining({
            adapter: 'resource-queue', type: 'wrong-kind', export: 'createResourceQueue',
        }));
    });

    test('a changed function signature is a wrong-arity failure', async () => {
        const check = await runCompatibilityCheck({
            loadModule: createMapLoader(REAL_MODULES, {
                replaceExports: { 'src/second-brain/gateway-core.js': { resolveGatewayRoute: (only) => ({ action: only }) } },
            }),
        });
        expect(check.ok).toBe(false);
        expect(check.failures).toContainEqual(expect.objectContaining({
            adapter: 'second-brain-gateway', type: 'wrong-arity', export: 'resolveGatewayRoute',
        }));
    });

    test('behavior drift with intact exports is caught by contract probes', async () => {
        const drifted = { ...hardeningCore, classifyHost: () => 'public' };
        const check = await runCompatibilityCheck({
            loadModule: createMapLoader({ ...REAL_MODULES, 'src/settings/transport-hardening-core.js': drifted }),
            probesById: REAL_PROBES,
        });
        expect(check.ok).toBe(false);
        expect(check.failures).toContainEqual(expect.objectContaining({
            adapter: 'transport-hardening', type: 'probe-failed', export: 'classifyHost',
        }));
    });

    test('a throwing probe is a probe-error failure, not a crash of the harness', () => {
        const entry = ADAPTER_INVENTORY.find((item) => item.id === 'transport-hardening');
        const result = checkAdapter(entry, hardeningCore, [
            { name: 'exploding probe', export: 'classifyHost', run: () => { throw new Error('boom'); } },
        ]);
        expect(result.status).toBe('failed');
        expect(result.failures).toContainEqual(expect.objectContaining({ type: 'probe-error' }));
    });

    test('multiple damaged adapters are all reported in one run', async () => {
        const check = await runCompatibilityCheck({
            loadModule: createMapLoader(REAL_MODULES, {
                dropModules: ['src/media/image-registry-core.js'],
                dropExports: { 'src/voice/push-to-talk-core.js': ['createPushToTalkSession'] },
            }),
        });
        expect(check.ok).toBe(false);
        expect(check.failed).toBe(2);
        const report = buildCompatibilityReport(check);
        expect(report.text).toMatch(/FAIL image-registry/);
        expect(report.text).toMatch(/FAIL push-to-talk/);
        expect(report.text).toMatch(/missing-module/);
        expect(report.text).toMatch(/missing-export/);
    });

    test('a loader that cannot find an unlisted module throws', () => {
        const loader = createMapLoader(REAL_MODULES);
        expect(() => loader('src/no-such-module.js')).toThrow(/Cannot find module/);
    });

    test('runCompatibilityCheck requires a loader', async () => {
        await expect(runCompatibilityCheck({})).rejects.toThrow(/loadModule/);
    });
});
