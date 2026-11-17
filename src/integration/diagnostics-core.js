/**
 * Packaging and one-click local diagnostics (RFST-025).
 *
 * Roadmap evidence required (section 14): "Reproducible
 * deployment instructions." The deployment instructions live
 * in DEPLOYMENT_RuneForgeAI.md at the repo root; this core is
 * the one-click local diagnostics half of the package: the
 * single action a user runs after following those instructions
 * to prove the local deployment is healthy.
 *
 * This dependency-free core provides:
 *   - A named set of local checks: runtime (Node.js version),
 *     required configuration presence, free disk space, and
 *     one reachability check per configured service endpoint.
 *     Hosts are named by ROLE only (ui-host / inference-host /
 *     services-host) - never by real hostname or network
 *     address.
 *   - Injected collaborators only: a probe (endpoint
 *     reachability), a system-info provider (runtime + disk),
 *     a config provider, and a clock. The core performs no
 *     real I/O, contacts no live service, and reads no real
 *     filesystem.
 *   - Honesty, never faking: a check that cannot pass is
 *     recorded as warn or fail WITH its reason. An
 *     unreachable OPTIONAL service is reported as a warning,
 *     never hidden and never counted as a pass; an
 *     unreachable REQUIRED service is a failure. A missing
 *     required config key is a failure. Collaborator
 *     exceptions are recorded as failed/warned checks - the
 *     runner NEVER throws.
 *   - A single copyable plain-text diagnostic report with
 *     secrets redacted (the RFST-018 redaction spirit: URL
 *     userinfo stripped, secret-looking query parameters and
 *     key=value / Bearer secrets replaced), and an honest
 *     pass/warn/fail summary.
 *
 * The live leg - running the one-click diagnostics for real
 * on the Windows UI host - is GATED on the F15 UI host (see
 * campaign/PROGRESS.md); the mock suite is the banked
 * evidence for this package.
 */

export const CHECK_STATUSES = Object.freeze(['pass', 'warn', 'fail']);

export const SERVICE_STATES = Object.freeze(['reachable', 'unreachable', 'unconfigured']);

export const HOST_ROLES = Object.freeze(['ui-host', 'inference-host', 'services-host']);

export const MIN_NODE_MAJOR = 18;
export const DISK_FAIL_BYTES = 512 * 1024 * 1024;
export const DISK_WARN_BYTES = 5 * 1024 * 1024 * 1024;

const SECRET_KEY_PATTERN = /(api[-_]?key|access[-_]?token|auth|password|passwd|secret|token|key)/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE_SECRET_PATTERN = /((?:api[-_]?key|access[-_]?token|password|passwd|secret|token)\s*[:=]\s*)[^\s&,;]+/gi;

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Redact secrets from free text (the RFST-018 spirit):
 * Bearer tokens and secret-looking key=value pairs.
 * @param {*} text Input text
 * @returns {string} Redacted text ('' for non-strings)
 */
export function redactDiagnosticText(text) {
    if (typeof text !== 'string') {
        return '';
    }
    return text
        .replace(BEARER_PATTERN, 'Bearer [redacted]')
        .replace(KEY_VALUE_SECRET_PATTERN, '$1[redacted]');
}

/**
 * Strip secrets from a URL for reporting: userinfo is removed
 * and secret-looking query parameters are redacted. An
 * unparseable value falls back to free-text redaction.
 * @param {*} value URL string
 * @returns {string} Safe URL (or '' when empty)
 */
export function stripUrlSecrets(value) {
    const raw = cleanString(value);
    if (!raw) {
        return '';
    }
    try {
        const parsed = new URL(raw);
        parsed.username = '';
        parsed.password = '';
        for (const key of [...parsed.searchParams.keys()]) {
            if (SECRET_KEY_PATTERN.test(key)) {
                parsed.searchParams.set(key, '[redacted]');
            }
        }
        return parsed.toString();
    } catch {
        return redactDiagnosticText(raw);
    }
}

function errorMessage(err) {
    return redactDiagnosticText(err instanceof Error ? err.message : String(err ?? 'unknown error'));
}

function check(id, label, status, detail) {
    return Object.freeze({ id, label, status, detail: redactDiagnosticText(cleanString(detail)) });
}

/**
 * The default service set, by role, mirroring the roadmap
 * section 17 startup order. Endpoints are empty (unconfigured)
 * until the caller supplies the configured endpoints.
 */
export function defaultServiceChecks() {
    return [
        { id: 'second-brain', label: 'Second Brain gateway', hostRole: 'services-host', required: false, endpoint: '' },
        { id: 'alltalk', label: 'AllTalk speech', hostRole: 'services-host', required: false, endpoint: '' },
        { id: 'gufo', label: 'Gufo text inference', hostRole: 'inference-host', required: false, endpoint: '' },
        { id: 'stt', label: 'STT transcription', hostRole: 'inference-host', required: false, endpoint: '' },
        { id: 'comfyui', label: 'ComfyUI media', hostRole: 'inference-host', required: false, endpoint: '' },
    ];
}

/**
 * A mock probe for tests and dry runs. By default every
 * endpoint is reachable; list endpoint substrings in
 * `unreachable` to make those probes fail. Records calls.
 */
export function createMockProbe(options = {}) {
    const unreachable = options.unreachable ?? [];
    const calls = [];
    const probe = async (endpoint) => {
        calls.push(endpoint);
        if (unreachable.some((fragment) => String(endpoint).includes(fragment))) {
            throw new Error(`mock unreachable: ${endpoint}`);
        }
        return { ok: true, latencyMs: 1 };
    };
    probe.calls = calls;
    return probe;
}

/**
 * Run the one-click local diagnostics.
 *
 * Options (all collaborators injected; every one optional -
 * a missing collaborator degrades its checks to warn/fail
 * records, never to a throw):
 *   services: [{ id, label, hostRole, required, endpoint }]
 *   requiredConfig: array of config key names that must be
 *     present and non-empty in the config provider's object
 *   probe: async (endpoint) => { ok, latencyMs?, detail? }
 *   systemInfo: () => { nodeVersion, platform, freeDiskBytes,
 *     totalDiskBytes } (or a plain object of that shape)
 *   getConfig: () => object (or a plain config object passed
 *     as `config`)
 *   config: plain config object (alternative to getConfig)
 *   now: () => ms epoch (defaults to Date.now)
 *
 * Returns { checks, summary, overall, generatedAt } where
 * summary is { total, pass, warn, fail } and overall is
 * 'fail' when any check failed, else 'warn' when any check
 * warned, else 'pass'. This function never throws.
 */
export async function runDiagnostics(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    let generatedAt = null;
    try {
        generatedAt = new Date(now()).toISOString();
    } catch {
        generatedAt = null;
    }
    const checks = [];

    // 1. Runtime check.
    let info = null;
    let infoError = null;
    try {
        info = typeof options.systemInfo === 'function' ? await options.systemInfo() : (options.systemInfo ?? null);
    } catch (err) {
        infoError = err;
    }
    if (infoError) {
        checks.push(check('runtime-node', 'Runtime (Node.js)', 'fail', `system info unavailable: ${errorMessage(infoError)}`));
    } else if (!info || !cleanString(info.nodeVersion)) {
        checks.push(check('runtime-node', 'Runtime (Node.js)', 'warn', 'node version not reported by system info provider'));
    } else {
        const version = cleanString(info.nodeVersion);
        const major = Number.parseInt(version.replace(/^v/i, ''), 10);
        if (Number.isNaN(major)) {
            checks.push(check('runtime-node', 'Runtime (Node.js)', 'warn', `node version unparseable: ${version}`));
        } else if (major < MIN_NODE_MAJOR) {
            checks.push(check('runtime-node', 'Runtime (Node.js)', 'fail', `node ${version} is below the required major ${MIN_NODE_MAJOR}`));
        } else {
            const platform = cleanString(info.platform);
            checks.push(check('runtime-node', 'Runtime (Node.js)', 'pass', `node ${version}${platform ? ` on ${platform}` : ''}`));
        }
    }

    // 2. Required configuration presence.
    let config = null;
    let configError = null;
    try {
        if (typeof options.getConfig === 'function') {
            config = await options.getConfig();
        } else if (options.config && typeof options.config === 'object') {
            config = options.config;
        }
    } catch (err) {
        configError = err;
    }
    const requiredConfig = Array.isArray(options.requiredConfig) ? options.requiredConfig : [];
    for (const key of requiredConfig) {
        const name = cleanString(key);
        if (!name) {
            continue;
        }
        if (configError) {
            checks.push(check(`config-${name}`, `Config: ${name}`, 'fail', `config provider failed: ${errorMessage(configError)}`));
        } else if (!config || config[name] === undefined || config[name] === null || cleanString(String(config[name])) === '') {
            checks.push(check(`config-${name}`, `Config: ${name}`, 'fail', 'required config value is missing or empty'));
        } else {
            checks.push(check(`config-${name}`, `Config: ${name}`, 'pass', 'present'));
        }
    }

    // 3. Disk space.
    if (infoError) {
        checks.push(check('disk-space', 'Disk space', 'warn', `disk info unavailable: ${errorMessage(infoError)}`));
    } else if (!info || typeof info.freeDiskBytes !== 'number' || Number.isNaN(info.freeDiskBytes)) {
        checks.push(check('disk-space', 'Disk space', 'warn', 'free disk space not reported by system info provider'));
    } else if (info.freeDiskBytes < DISK_FAIL_BYTES) {
        checks.push(check('disk-space', 'Disk space', 'fail', `only ${info.freeDiskBytes} bytes free (below ${DISK_FAIL_BYTES})`));
    } else if (info.freeDiskBytes < DISK_WARN_BYTES) {
        checks.push(check('disk-space', 'Disk space', 'warn', `${info.freeDiskBytes} bytes free (below the ${DISK_WARN_BYTES} comfort level)`));
    } else {
        checks.push(check('disk-space', 'Disk space', 'pass', `${info.freeDiskBytes} bytes free`));
    }

    // 4. One reachability check per configured service.
    const services = Array.isArray(options.services) ? options.services : defaultServiceChecks();
    for (const service of services) {
        const id = cleanString(service?.id) || 'service';
        const label = cleanString(service?.label) || id;
        const endpoint = cleanString(service?.endpoint);
        const required = service?.required === true;
        const checkId = `service-${id}`;
        if (!endpoint) {
            checks.push(check(checkId, `Service: ${label}`, required ? 'fail' : 'warn',
                `${required ? 'required' : 'optional'} service is unconfigured (no endpoint set)`));
            continue;
        }
        const safeEndpoint = stripUrlSecrets(endpoint);
        if (typeof options.probe !== 'function') {
            checks.push(check(checkId, `Service: ${label}`, 'warn', `no probe injected; reachability of ${safeEndpoint} not verified`));
            continue;
        }
        try {
            const result = await options.probe(endpoint);
            if (result && result.ok === true) {
                const latency = typeof result.latencyMs === 'number' ? ` in ${result.latencyMs} ms` : '';
                checks.push(check(checkId, `Service: ${label}`, 'pass', `reachable at ${safeEndpoint}${latency}`));
            } else {
                const detail = cleanString(result?.detail) || 'probe reported not reachable';
                checks.push(check(checkId, `Service: ${label}`, required ? 'fail' : 'warn',
                    `unreachable at ${safeEndpoint}: ${detail}`));
            }
        } catch (err) {
            checks.push(check(checkId, `Service: ${label}`, required ? 'fail' : 'warn',
                `unreachable at ${safeEndpoint}: ${errorMessage(err)}`));
        }
    }

    const summary = { total: checks.length, pass: 0, warn: 0, fail: 0 };
    for (const entry of checks) {
        summary[entry.status] += 1;
    }
    const overall = summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'pass';
    return { checks, summary, overall, generatedAt };
}

/**
 * Build the single copyable plain-text diagnostic report
 * from a runDiagnostics result. Deterministic for a given
 * result: one line per check plus header and summary lines.
 * All details were redacted when the checks were recorded,
 * and the assembled report is redacted once more as a
 * belt-and-braces pass.
 */
export function buildDiagnosticReport(run) {
    const lines = [];
    lines.push('RuneForgeAI local diagnostics report');
    lines.push(`Generated: ${run?.generatedAt ?? 'unknown'}`);
    lines.push(`Overall: ${String(run?.overall ?? 'unknown').toUpperCase()}`);
    lines.push('---');
    for (const entry of run?.checks ?? []) {
        lines.push(`${entry.status.toUpperCase().padEnd(4)} ${entry.id} - ${entry.detail}`);
    }
    const summary = run?.summary ?? { total: 0, pass: 0, warn: 0, fail: 0 };
    lines.push('---');
    lines.push(`Summary: ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed, ${summary.total} total.`);
    return redactDiagnosticText(lines.join('\n'));
}
