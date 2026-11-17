/**
 * RFST-020 - Integration tests across all three computers.
 *
 * Roadmap evidence required (section 14): "Full scenario
 * matrix passes."
 *
 * The core (src/integration/scenario-matrix-core.js) is
 * imported and exercised for real against mock executors and
 * mock environments; no live service is contacted and no
 * machine is woken. Hosts appear by role only (ui-host,
 * inference-host, services-host) - no real hostnames or
 * network addresses appear in this suite.
 *
 * Live evidence status: the live-only scenarios in the
 * matrix are reported GATED in a mock run, exactly as
 * RFST-013..019 gated their live legs; running them for
 * real is GATED on all three machines being available
 * together (campaign/PROGRESS.md).
 */
import { describe, test, expect } from '@jest/globals';

import {
    HOST_ROLES,
    INTEGRATION_IDS,
    SCENARIO_MATRIX,
    SCENARIO_STATUSES,
    buildMatrixReport,
    checkPreconditions,
    createLiveEnvironment,
    createMockEnvironment,
    createMockExecutor,
    runScenarioMatrix,
    scenariosForIntegration,
    validateScenarioMatrix,
} from '../src/integration/scenario-matrix-core.js';

describe('scenario matrix completeness', () => {
    test('registry constants cover the three host roles, the banked integrations, and all statuses', () => {
        expect(HOST_ROLES).toEqual(['ui-host', 'inference-host', 'services-host']);
        expect(INTEGRATION_IDS).toEqual([
            'gufo-text',
            'alltalk-tts',
            'second-brain-rag',
            'comfyui-media',
            'resource-queues',
            'status-panel',
            'transport-hardening',
        ]);
        expect(SCENARIO_STATUSES).toEqual(['passed', 'failed', 'gated']);
    });

    test('the shipped matrix validates as complete', () => {
        const validation = validateScenarioMatrix();
        expect(validation.complete).toBe(true);
        expect(validation.missingIntegrations).toEqual([]);
        expect(validation.duplicateIds).toEqual([]);
        expect(validation.invalid).toEqual([]);
        expect(validation.total).toBe(SCENARIO_MATRIX.length);
    });

    test('every banked integration has at least one scenario', () => {
        for (const integration of INTEGRATION_IDS) {
            expect(scenariosForIntegration(integration).length).toBeGreaterThanOrEqual(1);
        }
        expect(scenariosForIntegration('no-such-integration')).toEqual([]);
    });

    test('every scenario carries hosts, preconditions, steps, and an expected result', () => {
        for (const scenario of SCENARIO_MATRIX) {
            expect(scenario.hosts.length).toBeGreaterThanOrEqual(1);
            expect(scenario.preconditions.length).toBeGreaterThanOrEqual(1);
            expect(scenario.steps.length).toBeGreaterThanOrEqual(1);
            expect(scenario.expected.length).toBeGreaterThan(0);
            for (const host of scenario.hosts) {
                expect(HOST_ROLES).toContain(host);
            }
            for (const step of scenario.steps) {
                expect(HOST_ROLES).toContain(step.host);
            }
        }
    });

    test('scenario ids are unique and every step id is unique within its scenario', () => {
        const ids = SCENARIO_MATRIX.map((scenario) => scenario.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const scenario of SCENARIO_MATRIX) {
            const stepIds = scenario.steps.map((step) => step.id);
            expect(new Set(stepIds).size).toBe(stepIds.length);
        }
    });

    test('the matrix spans all three host roles', () => {
        const used = new Set(SCENARIO_MATRIX.flatMap((scenario) => scenario.hosts));
        expect([...used].sort()).toEqual([...HOST_ROLES].sort());
    });

    test('validation flags a matrix missing an integration', () => {
        const partial = SCENARIO_MATRIX.filter((scenario) => scenario.integration !== 'status-panel');
        const validation = validateScenarioMatrix(partial);
        expect(validation.complete).toBe(false);
        expect(validation.missingIntegrations).toEqual(['status-panel']);
    });

    test('validation flags duplicate ids and malformed scenarios', () => {
        const broken = [
            ...SCENARIO_MATRIX,
            SCENARIO_MATRIX[0],
            { id: 'broken-one', integration: 'gufo-text', title: '', hosts: ['moon-host'], preconditions: [], steps: [], expected: '' },
        ];
        const validation = validateScenarioMatrix(broken);
        expect(validation.complete).toBe(false);
        expect(validation.duplicateIds).toContain(SCENARIO_MATRIX[0].id);
        const invalid = validation.invalid.find((entry) => entry.scenarioId === 'broken-one');
        expect(invalid).toBeDefined();
        expect(invalid.problems.length).toBeGreaterThanOrEqual(3);
    });
});

describe('precondition gating', () => {
    test('mock environment satisfies mock scenarios but gates live-only ones', () => {
        const env = createMockEnvironment();
        for (const scenario of SCENARIO_MATRIX) {
            const gate = checkPreconditions(scenario, env);
            expect(gate.met).toBe(!scenario.requiresLive);
            if (scenario.requiresLive) {
                expect(gate.missing).toContain('live run declared');
            }
        }
    });

    test('live environment satisfies every scenario', () => {
        const env = createLiveEnvironment();
        for (const scenario of SCENARIO_MATRIX) {
            expect(checkPreconditions(scenario, env).met).toBe(true);
        }
    });

    test('an unavailable host gates only the scenarios that need it', async () => {
        const env = createMockEnvironment({
            hosts: { 'ui-host': true, 'inference-host': true, 'services-host': false },
        });
        const run = await runScenarioMatrix({ environment: env });
        const uiOnly = run.results.find((result) => result.scenarioId === 'comfyui-workflow-routing');
        expect(uiOnly.status).toBe('passed');
        const needsServices = run.results.find((result) => result.scenarioId === 'alltalk-tts-segmentation');
        expect(needsServices.status).toBe('gated');
        expect(needsServices.gatedReasons).toContain('services-host available');
    });

    test('an unavailable service gates its scenarios with the service named', async () => {
        const env = createMockEnvironment({
            services: { gufo: true, alltalk: true, stt: true, comfyui: false, 'second-brain': true },
        });
        const run = await runScenarioMatrix({ environment: env });
        const comfy = run.results.filter((result) => result.integration === 'comfyui-media');
        expect(comfy.length).toBeGreaterThanOrEqual(1);
        expect(comfy.every((result) => result.status === 'gated')).toBe(true);
        expect(comfy[0].gatedReasons.join(' ')).toMatch(/comfyui/);
    });
});

describe('matrix runner against mock executors', () => {
    test('all mock-executable scenarios pass and live-only scenarios gate', async () => {
        const run = await runScenarioMatrix();
        const mockCount = SCENARIO_MATRIX.filter((scenario) => !scenario.requiresLive).length;
        const liveCount = SCENARIO_MATRIX.length - mockCount;
        expect(run.passed).toBe(true);
        expect(run.complete).toBe(true);
        expect(run.summary).toEqual({
            total: SCENARIO_MATRIX.length,
            passed: mockCount,
            failed: 0,
            gated: liveCount,
            executable: mockCount,
        });
        expect(liveCount).toBeGreaterThanOrEqual(1);
    });

    test('in a live environment every scenario runs and passes', async () => {
        const run = await runScenarioMatrix({ environment: createLiveEnvironment() });
        expect(run.summary.passed).toBe(SCENARIO_MATRIX.length);
        expect(run.summary.gated).toBe(0);
        expect(run.summary.failed).toBe(0);
        expect(run.passed).toBe(true);
    });

    test('a failing mock step fails only its own scenario', async () => {
        const executor = createMockExecutor({ failSteps: ['gufo-streaming-basic:stream-reply'] });
        const run = await runScenarioMatrix({ executor });
        const failed = run.results.filter((result) => result.status === 'failed');
        expect(failed.map((result) => result.scenarioId)).toEqual(['gufo-streaming-basic']);
        expect(run.passed).toBe(false);
        const target = failed[0];
        expect(target.error).toMatch(/mock failure/);
        expect(target.steps.map((step) => step.status)).toEqual(['passed', 'failed', 'skipped']);
        const others = run.results.filter((result) => result.scenarioId !== 'gufo-streaming-basic');
        expect(others.every((result) => result.status === 'passed' || result.status === 'gated')).toBe(true);
    });

    test('gated scenarios never invoke the executor', async () => {
        const executor = createMockExecutor();
        const run = await runScenarioMatrix({ executor });
        const gatedIds = new Set(run.results.filter((result) => result.status === 'gated').map((result) => result.scenarioId));
        expect(gatedIds.size).toBeGreaterThanOrEqual(1);
        expect(executor.calls.every((call) => !gatedIds.has(call.scenarioId))).toBe(true);
        const expectedCalls = SCENARIO_MATRIX
            .filter((scenario) => !scenario.requiresLive)
            .reduce((count, scenario) => count + scenario.steps.length, 0);
        expect(executor.calls.length).toBe(expectedCalls);
    });

    test('an object executor with an execute method is supported', async () => {
        const seen = [];
        const executor = {
            async execute(step, scenario) {
                seen.push(`${scenario.id}:${step.id}`);
                return { ok: true };
            },
        };
        const run = await runScenarioMatrix({ executor, environment: createLiveEnvironment() });
        expect(run.summary.failed).toBe(0);
        expect(seen.length).toBeGreaterThan(0);
    });

    test('report summary counts are accurate for a mixed run', async () => {
        const executor = createMockExecutor({ failScenarios: ['status-panel-aggregation'] });
        const run = await runScenarioMatrix({ executor });
        const recount = { passed: 0, failed: 0, gated: 0 };
        for (const result of run.results) {
            recount[result.status] += 1;
        }
        expect(run.summary.passed).toBe(recount.passed);
        expect(run.summary.failed).toBe(recount.failed);
        expect(run.summary.gated).toBe(recount.gated);
        expect(run.summary.total).toBe(run.results.length);
        expect(run.summary.executable).toBe(recount.passed + recount.failed);
        expect(run.summary.failed).toBe(1);
    });
});

describe('matrix report', () => {
    test('report lists every scenario with its status and a summary line', async () => {
        const run = await runScenarioMatrix();
        const report = buildMatrixReport(run);
        const lines = report.split('\n');
        expect(lines.length).toBe(SCENARIO_MATRIX.length + 1);
        for (const scenario of SCENARIO_MATRIX) {
            expect(report).toContain(scenario.id);
        }
        expect(lines[lines.length - 1]).toBe(
            `Summary: ${run.summary.passed} passed, ${run.summary.failed} failed, ${run.summary.gated} gated, ${run.summary.total} total.`,
        );
    });

    test('report names the gating reason for gated scenarios', async () => {
        const run = await runScenarioMatrix();
        const report = buildMatrixReport(run);
        expect(report).toMatch(/GATED.*live run declared/);
    });

    test('report shows the error for a failed scenario', async () => {
        const executor = createMockExecutor({ failSteps: ['comfyui-workflow-routing:route-workflow'] });
        const run = await runScenarioMatrix({ executor });
        const report = buildMatrixReport(run);
        expect(report).toMatch(/FAILED comfyui-workflow-routing/);
        expect(report).toMatch(/mock failure/);
    });
});
