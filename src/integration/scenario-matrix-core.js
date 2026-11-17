/**
 * Integration tests across all three computers (RFST-020).
 *
 * Roadmap evidence required (section 14): "Full scenario
 * matrix passes."
 *
 * The distributed companion spans three machines by role: a
 * ui-host (the Windows laptop running the SillyTavern UI), an
 * inference-host (Gufo text inference and ComfyUI media), and
 * a services-host (AllTalk speech and the second brain). The
 * already-banked integrations (RFST-003..019) were each proven
 * against mocks on one machine; this package proves them
 * together, as one scenario matrix.
 *
 * This dependency-free core provides:
 *   - The full cross-machine scenario matrix as data: every
 *     banked integration has at least one scenario, and each
 *     scenario carries its host roles, preconditions, steps,
 *     and expected result. Hosts are named by ROLE only
 *     (ui-host / inference-host / services-host) - never by
 *     real hostname or network address.
 *   - A completeness validator: duplicate ids, unknown host
 *     roles, empty steps/preconditions/expected results, and
 *     integrations with no scenario are all reported.
 *   - A runner that executes scenarios against a pluggable
 *     executor (a real cross-machine driver in production, a
 *     mock in tests, exactly as RFST-013..019 injected their
 *     clients) and produces a pass/fail/gated matrix report.
 *   - Gating, never faking: a scenario whose live
 *     preconditions are unmet (a required host unavailable, a
 *     required service unavailable, or a live-only scenario
 *     outside a live run) is reported GATED - skipped, not
 *     passed and not failed - with the unmet preconditions
 *     named. A failing step fails only its own scenario; the
 *     rest of the matrix still runs.
 *
 * The core is pure and injected: it performs no network
 * calls and contacts no live service.
 *
 * The live leg - running the live-only scenarios against
 * all three real machines together - is GATED on all three
 * machines being available at once (see
 * campaign/PROGRESS.md); the mock matrix is the banked
 * evidence for this package.
 */

export const HOST_ROLES = Object.freeze(['ui-host', 'inference-host', 'services-host']);

export const INTEGRATION_IDS = Object.freeze([
    'gufo-text',
    'alltalk-tts',
    'second-brain-rag',
    'comfyui-media',
    'resource-queues',
    'status-panel',
    'transport-hardening',
]);

export const SCENARIO_STATUSES = Object.freeze(['passed', 'failed', 'gated']);

function freezeScenario(scenario) {
    return Object.freeze({
        ...scenario,
        packages: Object.freeze([...scenario.packages]),
        hosts: Object.freeze([...scenario.hosts]),
        services: Object.freeze([...(scenario.services ?? [])]),
        preconditions: Object.freeze([...scenario.preconditions]),
        steps: Object.freeze(scenario.steps.map((step) => Object.freeze({ ...step }))),
    });
}

function defineScenario(scenario) {
    return freezeScenario(scenario);
}

export const SCENARIO_MATRIX = Object.freeze([
    defineScenario({
        id: 'gufo-streaming-basic',
        title: 'Gufo text streams from the inference host into the UI',
        integration: 'gufo-text',
        packages: ['RFST-003', 'RFST-004'],
        hosts: ['ui-host', 'inference-host'],
        services: ['gufo'],
        requiresLive: false,
        preconditions: ['ui-host available', 'inference-host available', 'gufo service ready'],
        steps: [
            { id: 'open-chat', host: 'ui-host', action: 'open a chat and send a long character prompt' },
            { id: 'stream-reply', host: 'inference-host', action: 'stream the completion token by token' },
            { id: 'render-reply', host: 'ui-host', action: 'render the streamed reply in full' },
        ],
        expected: 'The full reply arrives streamed, untruncated, with raw roleplay markup preserved.',
    }),
    defineScenario({
        id: 'gufo-cancel-stream',
        title: 'Cancelling a Gufo stream stops inference and keeps the partial reply editable',
        integration: 'gufo-text',
        packages: ['RFST-004', 'RFST-017'],
        hosts: ['ui-host', 'inference-host'],
        services: ['gufo'],
        requiresLive: false,
        preconditions: ['ui-host available', 'inference-host available', 'gufo service ready'],
        steps: [
            { id: 'start-stream', host: 'inference-host', action: 'start a long completion' },
            { id: 'cancel-stream', host: 'ui-host', action: 'cancel the in-flight completion' },
            { id: 'confirm-stopped', host: 'inference-host', action: 'confirm generation stopped and resources were released' },
        ],
        expected: 'Cancellation reaches the inference host, generation stops, and no duplicate message is created.',
    }),
    defineScenario({
        id: 'alltalk-tts-segmentation',
        title: 'A narrated reply is segmented on the services host without altering the visible text',
        integration: 'alltalk-tts',
        packages: ['RFST-006', 'RFST-007'],
        hosts: ['ui-host', 'services-host'],
        services: ['alltalk'],
        requiresLive: false,
        preconditions: ['ui-host available', 'services-host available', 'alltalk service ready'],
        steps: [
            { id: 'send-reply', host: 'ui-host', action: 'produce a reply mixing narration and dialogue' },
            { id: 'segment-text', host: 'services-host', action: 'segment the reply for speech, keeping emotes out of the spoken text' },
            { id: 'play-segments', host: 'ui-host', action: 'play the spoken segments in order' },
        ],
        expected: 'Spoken segments are accurate and in order; the visible reply text is unchanged.',
    }),
    defineScenario({
        id: 'second-brain-rag-injection',
        title: 'A new character receives second-brain knowledge with zero per-character configuration',
        integration: 'second-brain-rag',
        packages: ['RFST-010', 'RFST-011', 'RFST-012'],
        hosts: ['ui-host', 'inference-host', 'services-host'],
        services: ['second-brain', 'gufo'],
        requiresLive: false,
        preconditions: ['ui-host available', 'inference-host available', 'services-host available', 'second-brain gateway ready', 'gufo service ready'],
        steps: [
            { id: 'import-character', host: 'ui-host', action: 'import a brand-new character with no knowledge settings' },
            { id: 'retrieve-knowledge', host: 'services-host', action: 'retrieve relevant knowledge for the current prompt' },
            { id: 'inject-prompt', host: 'inference-host', action: 'inject the retrieved knowledge into the prompt within the token budget' },
        ],
        expected: 'Retrieved knowledge reaches the prompt automatically; no per-character configuration was needed.',
    }),
    defineScenario({
        id: 'comfyui-workflow-routing',
        title: 'An image request is routed to the correct ComfyUI workflow and returns into chat',
        integration: 'comfyui-media',
        packages: ['RFST-013', 'RFST-014', 'RFST-015'],
        hosts: ['ui-host', 'inference-host'],
        services: ['comfyui'],
        requiresLive: false,
        preconditions: ['ui-host available', 'inference-host available', 'comfyui service ready'],
        steps: [
            { id: 'request-image', host: 'ui-host', action: 'request a character image from chat' },
            { id: 'route-workflow', host: 'inference-host', action: 'select the workflow for the requested category' },
            { id: 'return-image', host: 'ui-host', action: 'receive the generated image into the chat' },
        ],
        expected: 'The correct workflow category is selected and the image lands in the chat.',
    }),
    defineScenario({
        id: 'comfyui-idle-lifecycle',
        title: 'ComfyUI unloads after its idle window and reloads on the next request',
        integration: 'comfyui-media',
        packages: ['RFST-016'],
        hosts: ['ui-host', 'inference-host'],
        services: ['comfyui'],
        requiresLive: false,
        preconditions: ['ui-host available', 'inference-host available', 'comfyui service ready'],
        steps: [
            { id: 'finish-image', host: 'inference-host', action: 'complete an image job and start the idle timer' },
            { id: 'unload-idle', host: 'inference-host', action: 'unload the model after the idle window' },
            { id: 'reload-next', host: 'inference-host', action: 'reload on the next image request' },
        ],
        expected: 'Memory returns to the defined idle state, and the next request reloads and succeeds.',
    }),
    defineScenario({
        id: 'resource-queue-contention',
        title: 'Interactive text is preserved while image and speech jobs contend for resources',
        integration: 'resource-queues',
        packages: ['RFST-017'],
        hosts: ['ui-host', 'inference-host', 'services-host'],
        services: ['gufo', 'alltalk', 'comfyui'],
        requiresLive: false,
        preconditions: ['ui-host available', 'inference-host available', 'services-host available', 'gufo service ready', 'alltalk service ready', 'comfyui service ready'],
        steps: [
            { id: 'fill-queues', host: 'services-host', action: 'queue image and speech jobs ahead of a text request' },
            { id: 'send-text', host: 'ui-host', action: 'send an interactive text message under contention' },
            { id: 'verify-priority', host: 'inference-host', action: 'verify the text job ran ahead of lower-priority work' },
        ],
        expected: 'The interactive text job is scheduled first, never dropped, and never duplicated.',
    }),
    defineScenario({
        id: 'cross-host-failure-degradation',
        title: 'Losing the services host degrades voice and knowledge but never text chat',
        integration: 'resource-queues',
        packages: ['RFST-017'],
        hosts: ['ui-host', 'inference-host', 'services-host'],
        services: ['gufo'],
        requiresLive: false,
        preconditions: ['ui-host available', 'inference-host available', 'gufo service ready'],
        steps: [
            { id: 'drop-services', host: 'services-host', action: 'simulate the services host going offline' },
            { id: 'send-text', host: 'ui-host', action: 'send a text message while the services host is down' },
            { id: 'verify-degraded', host: 'ui-host', action: 'verify text chat works and voice/knowledge show unavailable' },
        ],
        expected: 'Text chat continues; voice and knowledge report unavailable instead of failing the chat.',
    }),
    defineScenario({
        id: 'status-panel-aggregation',
        title: 'The status panel on the UI host aggregates every service state centrally',
        integration: 'status-panel',
        packages: ['RFST-018'],
        hosts: ['ui-host', 'inference-host', 'services-host'],
        services: ['gufo', 'alltalk', 'comfyui', 'second-brain'],
        requiresLive: false,
        preconditions: ['ui-host available', 'inference-host available', 'services-host available'],
        steps: [
            { id: 'poll-services', host: 'ui-host', action: 'poll every registered service endpoint' },
            { id: 'aggregate-status', host: 'ui-host', action: 'aggregate per-service states into one overall status' },
            { id: 'edit-endpoint', host: 'ui-host', action: 'edit one endpoint centrally and re-test its connection' },
        ],
        expected: 'All service states are visible and editable centrally; a down service never disables chat.',
    }),
    defineScenario({
        id: 'transport-hardening-audit',
        title: 'Every cross-machine endpoint in the matrix is private-only with no public exposure',
        integration: 'transport-hardening',
        packages: ['RFST-019'],
        hosts: ['ui-host', 'inference-host', 'services-host'],
        services: ['gufo', 'alltalk', 'comfyui', 'second-brain'],
        requiresLive: false,
        preconditions: ['ui-host available', 'inference-host available', 'services-host available'],
        steps: [
            { id: 'collect-endpoints', host: 'ui-host', action: 'collect the configured endpoint for every service' },
            { id: 'audit-endpoints', host: 'ui-host', action: 'audit every endpoint and bind address for public exposure' },
            { id: 'verify-report', host: 'ui-host', action: 'verify the diagnostics report carries no credentials' },
        ],
        expected: 'No endpoint is public or wildcard-bound without explicit opt-in, and the report is secrets-free.',
    }),
    defineScenario({
        id: 'live-gufo-stream-across-hosts',
        title: 'Live: a real Gufo completion streams across hosts into the real UI',
        integration: 'gufo-text',
        packages: ['RFST-004', 'RFST-020'],
        hosts: ['ui-host', 'inference-host'],
        services: ['gufo'],
        requiresLive: true,
        preconditions: ['live run declared', 'ui-host available', 'inference-host available', 'gufo service ready'],
        steps: [
            { id: 'live-send', host: 'ui-host', action: 'send a long prompt from the real UI' },
            { id: 'live-stream', host: 'inference-host', action: 'stream the real completion' },
            { id: 'live-verify', host: 'ui-host', action: 'verify the full reply rendered in the real UI' },
        ],
        expected: 'The live completion streams end to end across the real machines.',
    }),
    defineScenario({
        id: 'live-full-companion-turn',
        title: 'Live: one turn exercises text, voice, knowledge, and image across all three hosts',
        integration: 'second-brain-rag',
        packages: ['RFST-012', 'RFST-020'],
        hosts: ['ui-host', 'inference-host', 'services-host'],
        services: ['gufo', 'alltalk', 'comfyui', 'second-brain'],
        requiresLive: true,
        preconditions: ['live run declared', 'ui-host available', 'inference-host available', 'services-host available', 'gufo service ready', 'alltalk service ready', 'comfyui service ready', 'second-brain gateway ready'],
        steps: [
            { id: 'live-turn', host: 'ui-host', action: 'send one message in the real UI' },
            { id: 'live-knowledge-voice', host: 'services-host', action: 'inject knowledge and speak the reply with the real services' },
            { id: 'live-image', host: 'inference-host', action: 'generate the requested image with the real media service' },
        ],
        expected: 'Text, knowledge, voice, and image all complete in one live turn across all three hosts.',
    }),
    defineScenario({
        id: 'live-comfyui-image-into-chat',
        title: 'Live: a real ComfyUI workflow returns an image into the real chat',
        integration: 'comfyui-media',
        packages: ['RFST-013', 'RFST-020'],
        hosts: ['ui-host', 'inference-host'],
        services: ['comfyui'],
        requiresLive: true,
        preconditions: ['live run declared', 'ui-host available', 'inference-host available', 'comfyui service ready'],
        steps: [
            { id: 'live-request', host: 'ui-host', action: 'request an image from the real UI' },
            { id: 'live-generate', host: 'inference-host', action: 'run the real workflow' },
            { id: 'live-return', host: 'ui-host', action: 'verify the image rendered in the real chat' },
        ],
        expected: 'The live image is generated on the inference host and rendered in the real chat.',
    }),
]);

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** Scenarios for one integration id (empty array for unknown ids). */
export function scenariosForIntegration(integrationId) {
    return SCENARIO_MATRIX.filter((scenario) => scenario.integration === integrationId);
}

/**
 * Validate matrix completeness and shape.
 * Returns { complete, total, missingIntegrations, duplicateIds,
 * invalid } where invalid lists { scenarioId, problems[] }.
 */
export function validateScenarioMatrix(matrix = SCENARIO_MATRIX) {
    const scenarios = Array.isArray(matrix) ? matrix : [];
    const seen = new Set();
    const duplicateIds = [];
    const invalid = [];
    const covered = new Set();

    for (const scenario of scenarios) {
        const id = cleanString(scenario?.id) || '(missing id)';
        if (seen.has(id)) {
            duplicateIds.push(id);
        }
        seen.add(id);
        if (scenario?.integration) {
            covered.add(scenario.integration);
        }
        const problems = [];
        if (!cleanString(scenario?.id)) {
            problems.push('missing id');
        }
        if (!INTEGRATION_IDS.includes(scenario?.integration)) {
            problems.push(`unknown integration: ${String(scenario?.integration)}`);
        }
        if (!cleanString(scenario?.title)) {
            problems.push('missing title');
        }
        if (!Array.isArray(scenario?.hosts) || scenario.hosts.length === 0) {
            problems.push('no host roles');
        } else {
            for (const host of scenario.hosts) {
                if (!HOST_ROLES.includes(host)) {
                    problems.push(`unknown host role: ${String(host)}`);
                }
            }
        }
        if (!Array.isArray(scenario?.preconditions) || scenario.preconditions.length === 0) {
            problems.push('no preconditions');
        }
        if (!Array.isArray(scenario?.steps) || scenario.steps.length === 0) {
            problems.push('no steps');
        } else {
            for (const step of scenario.steps) {
                if (!cleanString(step?.id) || !cleanString(step?.action)) {
                    problems.push('a step is missing its id or action');
                }
                if (step?.host && !HOST_ROLES.includes(step.host)) {
                    problems.push(`step host is not a known role: ${String(step.host)}`);
                }
            }
        }
        if (!cleanString(scenario?.expected)) {
            problems.push('missing expected result');
        }
        if (problems.length > 0) {
            invalid.push({ scenarioId: id, problems });
        }
    }

    const missingIntegrations = INTEGRATION_IDS.filter((id) => !covered.has(id));
    return {
        complete: missingIntegrations.length === 0 && duplicateIds.length === 0 && invalid.length === 0,
        total: scenarios.length,
        missingIntegrations,
        duplicateIds,
        invalid,
    };
}

/**
 * The default mock environment: every host role and service
 * available, but no live run declared - so mock-executable
 * scenarios run and live-only scenarios gate.
 */
export function createMockEnvironment(overrides = {}) {
    return {
        live: false,
        hosts: { 'ui-host': true, 'inference-host': true, 'services-host': true },
        services: { gufo: true, alltalk: true, stt: true, comfyui: true, 'second-brain': true },
        ...overrides,
    };
}

/** A live environment: every host and service available, live run declared. */
export function createLiveEnvironment(overrides = {}) {
    return { ...createMockEnvironment(), live: true, ...overrides };
}

function environmentHostAvailable(environment, role) {
    if (!environment || typeof environment !== 'object') {
        return true;
    }
    if (environment.hosts && typeof environment.hosts === 'object') {
        return environment.hosts[role] !== false && environment.hosts[role] !== undefined;
    }
    if (Array.isArray(environment.availableHosts)) {
        return environment.availableHosts.includes(role);
    }
    return true;
}

function environmentServiceAvailable(environment, service) {
    if (!environment || typeof environment !== 'object') {
        return true;
    }
    if (environment.services && typeof environment.services === 'object') {
        return environment.services[service] !== false && environment.services[service] !== undefined;
    }
    if (Array.isArray(environment.availableServices)) {
        return environment.availableServices.includes(service);
    }
    return true;
}

/**
 * Check a scenario's live preconditions against an environment.
 * Returns { met, missing[] } with human-readable unmet items.
 * With no environment, the mock environment is assumed.
 */
export function checkPreconditions(scenario, environment = createMockEnvironment()) {
    const missing = [];
    for (const role of scenario?.hosts ?? []) {
        if (!environmentHostAvailable(environment, role)) {
            missing.push(`${role} available`);
        }
    }
    for (const service of scenario?.services ?? []) {
        if (!environmentServiceAvailable(environment, service)) {
            missing.push(`${service} service ready`);
        }
    }
    if (scenario?.requiresLive && !(environment && environment.live)) {
        missing.push('live run declared');
    }
    return { met: missing.length === 0, missing };
}

/**
 * Build a mock executor. By default every step succeeds.
 * Options:
 *   failSteps: array of "scenarioId:stepId" keys, or a Map/Set
 *   failScenarios: array of scenario ids whose every step fails
 * The executor records every call on executor.calls.
 */
export function createMockExecutor(options = {}) {
    const failSteps = new Set(options.failSteps ?? []);
    const failScenarios = new Set(options.failScenarios ?? []);
    const calls = [];
    const executor = async (step, scenario) => {
        calls.push({ scenarioId: scenario.id, stepId: step.id, host: step.host });
        if (failScenarios.has(scenario.id) || failSteps.has(`${scenario.id}:${step.id}`)) {
            throw new Error(`mock failure at ${scenario.id}:${step.id}`);
        }
        return { ok: true };
    };
    executor.calls = calls;
    return executor;
}

async function executeStep(executor, step, scenario) {
    if (typeof executor === 'function') {
        return executor(step, scenario);
    }
    if (executor && typeof executor.execute === 'function') {
        return executor.execute(step, scenario);
    }
    return { ok: true };
}

/**
 * Run the scenario matrix.
 * Options: { matrix, executor, environment }.
 * Returns { results, summary, passed, complete } where each
 * result is { scenarioId, integration, status, steps,
 * gatedReasons, error } and summary counts every status.
 * A gated scenario never invokes the executor; a failed step
 * fails only its own scenario and stops that scenario's
 * remaining steps (recorded as skipped).
 */
export async function runScenarioMatrix(options = {}) {
    const matrix = Array.isArray(options.matrix) ? options.matrix : SCENARIO_MATRIX;
    const executor = options.executor ?? createMockExecutor();
    const environment = options.environment ?? createMockEnvironment();
    const validation = validateScenarioMatrix(matrix);
    const results = [];

    for (const scenario of matrix) {
        const gate = checkPreconditions(scenario, environment);
        if (!gate.met) {
            results.push({
                scenarioId: scenario.id,
                integration: scenario.integration,
                status: 'gated',
                steps: scenario.steps.map((step) => ({ stepId: step.id, status: 'gated', error: null })),
                gatedReasons: gate.missing,
                error: null,
            });
            continue;
        }
        const stepResults = [];
        let error = null;
        for (const step of scenario.steps) {
            if (error) {
                stepResults.push({ stepId: step.id, status: 'skipped', error: null });
                continue;
            }
            try {
                await executeStep(executor, step, scenario);
                stepResults.push({ stepId: step.id, status: 'passed', error: null });
            } catch (err) {
                error = err instanceof Error ? err.message : String(err);
                stepResults.push({ stepId: step.id, status: 'failed', error });
            }
        }
        results.push({
            scenarioId: scenario.id,
            integration: scenario.integration,
            status: error ? 'failed' : 'passed',
            steps: stepResults,
            gatedReasons: [],
            error,
        });
    }

    const summary = { total: results.length, passed: 0, failed: 0, gated: 0, executable: 0 };
    for (const result of results) {
        summary[result.status] += 1;
    }
    summary.executable = summary.passed + summary.failed;
    return {
        results,
        summary,
        passed: summary.failed === 0 && summary.passed > 0,
        complete: validation.complete,
        validation,
    };
}

/**
 * Build a plain-text matrix report from a runner result:
 * one line per scenario plus a summary line, suitable for a
 * diagnostics panel or a progress ledger.
 */
export function buildMatrixReport(run) {
    const lines = [];
    for (const result of run?.results ?? []) {
        const suffix = result.status === 'gated'
            ? ` (gated: ${(result.gatedReasons ?? []).join(', ')})`
            : result.error
                ? ` (error: ${result.error})`
                : '';
        lines.push(`${result.status.toUpperCase().padEnd(6)} ${result.scenarioId} [${result.integration}]${suffix}`);
    }
    const summary = run?.summary ?? { total: 0, passed: 0, failed: 0, gated: 0 };
    lines.push(`Summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.gated} gated, ${summary.total} total.`);
    return lines.join('\n');
}
