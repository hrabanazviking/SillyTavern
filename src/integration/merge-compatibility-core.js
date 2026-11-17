/**
 * Update/merge compatibility harness (RFST-021).
 *
 * Roadmap evidence required (section 14): "Upstream merges
 * do not silently break adapters."
 *
 * This fork carries a set of RuneForgeAI adapter/core
 * modules (second brain, voice, media, settings, scheduling,
 * integration) that were added on top of upstream
 * SillyTavern. An upstream merge can damage any of them
 * without touching this repo's own tests' attention: a file
 * can vanish, an export can be renamed or dropped, a
 * function's signature can change, or a function's behavior
 * can silently drift. Any of those would otherwise surface
 * only later, as a broken feature in the running app.
 *
 * This dependency-free core is the harness that makes such
 * breakage LOUD at merge time instead:
 *   - An inventory of the fork's adapter modules, grounded
 *     in the files that actually exist under src/: each
 *     entry names the module path, the work package that
 *     banked it, and the exports (name, kind, and - where
 *     the signature is part of the contract - arity) that
 *     the rest of the fork relies on.
 *   - A checker that loads each module through an injected
 *     loader and verifies every expected export: presence,
 *     kind, and arity. A module that fails to load is a
 *     failure, never a skip.
 *   - Contract probes: small behavioral checks per adapter
 *     (injected by the caller, exercised for real in the
 *     test suite against the real modules) that catch
 *     behavior drift an export list alone cannot - e.g. a
 *     classifier that still exists but now answers wrong.
 *   - A report that fails loudly: the overall result is
 *     ok only when every adapter passes; every failure is
 *     named with its type and detail, and assertCompatible
 *     throws an error listing all of them. Nothing is
 *     reported as a warning or silently skipped.
 *   - A mock loader with simulated merge damage (dropped
 *     module, dropped export, renamed export, replaced
 *     export) so the test suite can prove the harness
 *     catches each breakage class without performing a
 *     real upstream merge.
 *
 * The core is pure and injected: it performs no file or
 * network access itself; the caller supplies the loader
 * (dynamic import in production, a module map in tests).
 *
 * The live leg - running the harness as part of an actual
 * upstream merge - is GATED on a merge actually being
 * performed (see campaign/PROGRESS.md); the mock-damage
 * suite is the banked evidence for this package.
 */

function exp(name, kind, arity) {
    const entry = { name, kind };
    if (arity !== undefined) {
        entry.arity = arity;
    }
    return Object.freeze(entry);
}

function adapter(id, pkg, path, expectedExports) {
    return Object.freeze({
        id,
        package: pkg,
        path,
        expectedExports: Object.freeze(expectedExports),
    });
}

export const ADAPTER_INVENTORY = Object.freeze([
    adapter('second-brain-gateway', 'RFST-011', 'src/second-brain/gateway-core.js', [
        exp('GATEWAY_DEFAULTS', 'object'),
        exp('GatewayError', 'function'),
        exp('resolveGatewayRoute', 'function', 2),
        exp('createSecondBrainGateway', 'function'),
        exp('gatewayFromEnv', 'function'),
    ]),
    adapter('second-brain-rag', 'RFST-012', 'src/second-brain/rag-injection-core.js', [
        exp('RAG_DEFAULTS', 'object'),
        exp('INJECTION_MARKER', 'string'),
        exp('estimateTokens', 'function', 1),
        exp('buildRetrievalQuery', 'function'),
        exp('planInjection', 'function'),
        exp('formatInjectionBlock', 'function', 1),
        exp('ragConfigFromEnv', 'function'),
        exp('createRagInjector', 'function'),
        exp('createRagInjectorFromGateway', 'function'),
    ]),
    adapter('push-to-talk', 'RFST-009', 'src/voice/push-to-talk-core.js', [
        exp('SESSION_STATES', 'array'),
        exp('ALLOWED_AUDIO_FORMATS', 'array'),
        exp('AUDIO_MIME_TYPES', 'object'),
        exp('DEFAULT_MAX_UPLOAD_BYTES', 'number'),
        exp('normalizeAudioFormat', 'function', 1),
        exp('validateAudioUpload', 'function'),
        exp('validateSttEndpoint', 'function', 1),
        exp('extractTranscript', 'function', 1),
        exp('createPushToTalkSession', 'function'),
    ]),
    adapter('image-registry', 'RFST-014', 'src/media/image-registry-core.js', [
        exp('IMAGE_CATEGORIES', 'array'),
        exp('MODEL_KINDS', 'array'),
        exp('ENTRY_KINDS', 'array'),
        exp('AVAILABILITY', 'array'),
        exp('DEFAULT_IMAGE_REGISTRY', 'array'),
        exp('validateEntry', 'function', 1),
        exp('validateRegistry', 'function', 1),
        exp('analyzeWorkflow', 'function', 1),
        exp('buildModelEntry', 'function', 1),
        exp('scoreEntry', 'function', 1),
        exp('rankEntries', 'function'),
        exp('resolveSelection', 'function'),
        exp('registrySummary', 'function', 1),
    ]),
    adapter('image-workflow-router', 'RFST-015', 'src/media/image-workflow-router-core.js', [
        exp('FALLBACK_REASON_NO_SIGNAL', 'string'),
        exp('FALLBACK_REASON_AMBIGUOUS', 'string'),
        exp('classifyRequest', 'function'),
        exp('routeRequest', 'function'),
        exp('routeImageRequest', 'function'),
    ]),
    adapter('comfyui-idle-lifecycle', 'RFST-016', 'src/media/comfyui-idle-lifecycle-core.js', [
        exp('DEFAULT_IDLE_TIMEOUT_MS', 'number'),
        exp('LIFECYCLE_STATES', 'array'),
        exp('IDLE_STATE_DEFINITION', 'object'),
        exp('queueCounts', 'function', 1),
        exp('vramSummary', 'function', 1),
        exp('isAtIdleState', 'function'),
        exp('decideUnload', 'function'),
        exp('createIdleLifecycleManager', 'function'),
    ]),
    adapter('integration-panel', 'RFST-018', 'src/settings/integration-panel-core.js', [
        exp('SERVICES', 'array'),
        exp('SERVICE_IDS', 'array'),
        exp('DEFAULT_SETTINGS', 'object'),
        exp('validateEndpoint', 'function', 1),
        exp('normalizeEndpoint', 'function', 1),
        exp('createDefaultSettings', 'function', 0),
        exp('migrateSettings', 'function', 1),
        exp('aggregateStatus', 'function', 1),
        exp('redactSecrets', 'function', 1),
        exp('createIntegrationPanel', 'function'),
    ]),
    adapter('transport-hardening', 'RFST-019', 'src/settings/transport-hardening-core.js', [
        exp('SERVICE_IDS', 'array'),
        exp('ADDRESS_CLASSES', 'array'),
        exp('AUDIT_VERDICTS', 'array'),
        exp('parseIpv4', 'function', 1),
        exp('classifyHost', 'function', 1),
        exp('classifyBindAddress', 'function', 1),
        exp('isPrivateClass', 'function', 1),
        exp('validateEndpointUrl', 'function'),
        exp('auditEndpoint', 'function'),
        exp('auditEndpoints', 'function'),
        exp('buildHardeningReport', 'function'),
    ]),
    adapter('resource-queue', 'RFST-017', 'src/scheduling/resource-queue-core.js', [
        exp('SERVICE_PRIORITIES', 'object'),
        exp('SERVICE_STATES', 'array'),
        exp('JOB_STATES', 'array'),
        exp('DEFAULT_QUEUE_LIMITS', 'object'),
        exp('priorityForService', 'function', 1),
        exp('backoffDelayMs', 'function'),
        exp('createCancellationToken', 'function', 0),
        exp('degradedModeFor', 'function'),
        exp('createResourceQueue', 'function'),
    ]),
    adapter('scenario-matrix', 'RFST-020', 'src/integration/scenario-matrix-core.js', [
        exp('HOST_ROLES', 'array'),
        exp('INTEGRATION_IDS', 'array'),
        exp('SCENARIO_MATRIX', 'array'),
        exp('scenariosForIntegration', 'function', 1),
        exp('validateScenarioMatrix', 'function'),
        exp('createMockEnvironment', 'function'),
        exp('createLiveEnvironment', 'function'),
        exp('checkPreconditions', 'function'),
        exp('createMockExecutor', 'function'),
        exp('runScenarioMatrix', 'function'),
        exp('buildMatrixReport', 'function', 1),
    ]),
]);

export const ADAPTER_IDS = Object.freeze(ADAPTER_INVENTORY.map((entry) => entry.id));

export const CHECK_STATUSES = Object.freeze(['passed', 'failed']);

export const FAILURE_TYPES = Object.freeze([
    'missing-module',
    'missing-export',
    'wrong-kind',
    'wrong-arity',
    'probe-failed',
    'probe-error',
    'invalid-contract',
]);

const VALID_KINDS = Object.freeze(['function', 'array', 'object', 'string', 'number', 'boolean']);

function kindOf(value) {
    if (Array.isArray(value)) {
        return 'array';
    }
    return typeof value;
}

export function validateInventory(inventory = ADAPTER_INVENTORY) {
    const problems = [];
    if (!Array.isArray(inventory) || inventory.length === 0) {
        return { valid: false, problems: ['inventory must be a non-empty array'] };
    }
    const seenIds = new Set();
    const seenPaths = new Set();
    for (const entry of inventory) {
        if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) {
            problems.push('an adapter entry is missing its id');
            continue;
        }
        if (seenIds.has(entry.id)) {
            problems.push(`duplicate adapter id: ${entry.id}`);
        }
        seenIds.add(entry.id);
        if (typeof entry.path !== 'string' || !entry.path.endsWith('.js')) {
            problems.push(`adapter ${entry.id}: path must be a .js module path`);
        } else if (seenPaths.has(entry.path)) {
            problems.push(`duplicate adapter path: ${entry.path}`);
        }
        seenPaths.add(entry.path);
        if (!Array.isArray(entry.expectedExports) || entry.expectedExports.length === 0) {
            problems.push(`adapter ${entry.id}: expectedExports must be a non-empty array`);
            continue;
        }
        const seenExports = new Set();
        for (const expected of entry.expectedExports) {
            if (!expected || typeof expected.name !== 'string' || expected.name.length === 0) {
                problems.push(`adapter ${entry.id}: an expected export is missing its name`);
                continue;
            }
            if (seenExports.has(expected.name)) {
                problems.push(`adapter ${entry.id}: duplicate expected export ${expected.name}`);
            }
            seenExports.add(expected.name);
            if (!VALID_KINDS.includes(expected.kind)) {
                problems.push(`adapter ${entry.id}: export ${expected.name} has unknown kind ${String(expected.kind)}`);
            }
            if (expected.arity !== undefined && (!Number.isInteger(expected.arity) || expected.arity < 0)) {
                problems.push(`adapter ${entry.id}: export ${expected.name} has invalid arity`);
            }
        }
    }
    return { valid: problems.length === 0, problems };
}

export function checkAdapter(entry, mod, probes = []) {
    const failures = [];
    if (mod === null || mod === undefined || (typeof mod !== 'object' && typeof mod !== 'function')) {
        failures.push({
            type: 'missing-module',
            export: null,
            detail: `module ${entry.path} did not load`,
        });
        return { id: entry.id, path: entry.path, status: 'failed', failures };
    }
    for (const expected of entry.expectedExports) {
        const value = mod[expected.name];
        if (value === undefined) {
            failures.push({
                type: 'missing-export',
                export: expected.name,
                detail: `${entry.path} no longer exports ${expected.name}`,
            });
            continue;
        }
        const actualKind = kindOf(value);
        if (actualKind !== expected.kind) {
            failures.push({
                type: 'wrong-kind',
                export: expected.name,
                detail: `${expected.name} should be ${expected.kind} but is ${actualKind}`,
            });
            continue;
        }
        if (expected.arity !== undefined && typeof value === 'function' && value.length !== expected.arity) {
            failures.push({
                type: 'wrong-arity',
                export: expected.name,
                detail: `${expected.name} should take ${expected.arity} argument(s) but takes ${value.length}`,
            });
        }
    }
    for (const probe of probes) {
        let outcome;
        try {
            outcome = probe.run(mod);
        } catch (error) {
            failures.push({
                type: 'probe-error',
                export: probe.export ?? null,
                detail: `probe ${probe.name} threw: ${error?.message ?? String(error)}`,
            });
            continue;
        }
        if (outcome !== true) {
            failures.push({
                type: 'probe-failed',
                export: probe.export ?? null,
                detail: `probe ${probe.name} did not hold`,
            });
        }
    }
    return {
        id: entry.id,
        path: entry.path,
        status: failures.length === 0 ? 'passed' : 'failed',
        failures,
    };
}

export async function runCompatibilityCheck(options = {}) {
    const inventory = options.inventory ?? ADAPTER_INVENTORY;
    const loadModule = options.loadModule;
    const probesById = options.probesById ?? {};
    if (typeof loadModule !== 'function') {
        throw new TypeError('runCompatibilityCheck requires a loadModule function');
    }
    const validity = validateInventory(inventory);
    if (!validity.valid) {
        return {
            ok: false,
            inventoryProblems: validity.problems,
            results: [],
            passed: 0,
            failed: 0,
            total: 0,
            failures: validity.problems.map((detail) => ({ adapter: null, type: 'invalid-contract', export: null, detail })),
        };
    }
    const results = [];
    for (const entry of inventory) {
        let mod = null;
        let loadFailure = null;
        try {
            mod = await loadModule(entry.path, entry);
        } catch (error) {
            loadFailure = error;
        }
        if (loadFailure !== null) {
            results.push({
                id: entry.id,
                path: entry.path,
                status: 'failed',
                failures: [{
                    type: 'missing-module',
                    export: null,
                    detail: `module ${entry.path} failed to load: ${loadFailure?.message ?? String(loadFailure)}`,
                }],
            });
            continue;
        }
        results.push(checkAdapter(entry, mod, probesById[entry.id] ?? []));
    }
    const passed = results.filter((result) => result.status === 'passed').length;
    const failures = [];
    for (const result of results) {
        for (const failure of result.failures) {
            failures.push({ adapter: result.id, ...failure });
        }
    }
    return {
        ok: passed === results.length,
        inventoryProblems: [],
        results,
        passed,
        failed: results.length - passed,
        total: results.length,
        failures,
    };
}

export function buildCompatibilityReport(check) {
    const lines = [];
    lines.push(`merge compatibility: ${check.passed}/${check.total} adapters passed, ${check.failed} failed`);
    for (const result of check.results ?? []) {
        lines.push(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.id} (${result.path})`);
        for (const failure of result.failures ?? []) {
            lines.push(`  - ${failure.type}: ${failure.detail}`);
        }
    }
    return {
        ok: check.ok === true,
        passed: check.passed,
        failed: check.failed,
        total: check.total,
        failures: check.failures ?? [],
        text: lines.join('\n'),
    };
}

export function assertCompatible(check) {
    if (check && check.ok === true) {
        return check;
    }
    const report = buildCompatibilityReport(check ?? { passed: 0, failed: 0, total: 0, results: [], failures: [] });
    throw new Error(`Upstream merge compatibility check FAILED - adapters broke:\n${report.text}`);
}

export function createMapLoader(modulesByPath = {}, damage = {}) {
    const dropModules = new Set(damage.dropModules ?? []);
    const dropExports = damage.dropExports ?? {};
    const renameExports = damage.renameExports ?? {};
    const replaceExports = damage.replaceExports ?? {};
    return function loadModule(path) {
        if (dropModules.has(path)) {
            throw new Error(`Cannot find module '${path}' (simulated merge damage)`);
        }
        const original = modulesByPath[path];
        if (original === undefined) {
            throw new Error(`Cannot find module '${path}'`);
        }
        const mod = { ...original };
        for (const name of dropExports[path] ?? []) {
            delete mod[name];
        }
        for (const [oldName, newName] of Object.entries(renameExports[path] ?? {})) {
            if (oldName in mod) {
                mod[newName] = mod[oldName];
                delete mod[oldName];
            }
        }
        for (const [name, value] of Object.entries(replaceExports[path] ?? {})) {
            mod[name] = value;
        }
        return mod;
    };
}
