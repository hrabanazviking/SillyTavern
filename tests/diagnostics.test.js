/**
 * RFST-025 - Packaging and one-click local diagnostics.
 *
 * Roadmap evidence required (section 14): "Reproducible
 * deployment instructions." The instructions live in
 * DEPLOYMENT_RuneForgeAI.md at the repo root; this suite
 * proves the one-click diagnostics core
 * (src/integration/diagnostics-core.js) that those
 * instructions tell the user to run last.
 *
 * The core is imported and exercised for real against mock
 * probes, a fake system-info provider, a fake config
 * provider, and a fake clock; no live service is contacted,
 * no real filesystem is read. Endpoints in tests are
 * loopback URLs with clearly fake ports, per prior suites'
 * convention. Hosts appear by role only (ui-host,
 * inference-host, services-host).
 *
 * Live evidence status: a live one-click run on the
 * Windows UI host is GATED on the F15 UI host
 * (campaign/PROGRESS.md), exactly as RFST-018..024 gated
 * their live legs.
 */
import { describe, test, expect } from '@jest/globals';

import {
    CHECK_STATUSES,
    DISK_FAIL_BYTES,
    DISK_WARN_BYTES,
    HOST_ROLES,
    MIN_NODE_MAJOR,
    SERVICE_STATES,
    buildDiagnosticReport,
    createMockProbe,
    defaultServiceChecks,
    redactDiagnosticText,
    runDiagnostics,
    stripUrlSecrets,
} from '../src/integration/diagnostics-core.js';

function makeClock(start = 1_700_000_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
}

const HEALTHY_INFO = {
    nodeVersion: 'v22.22.1',
    platform: 'linux',
    freeDiskBytes: 64 * 1024 * 1024 * 1024,
    totalDiskBytes: 128 * 1024 * 1024 * 1024,
};

const FAKE_SERVICES = [
    { id: 'gufo', label: 'Gufo text inference', hostRole: 'inference-host', required: true, endpoint: 'http://127.0.0.1:9201' },
    { id: 'alltalk', label: 'AllTalk speech', hostRole: 'services-host', required: false, endpoint: 'http://127.0.0.1:9202' },
];

function healthyOptions(clock = makeClock()) {
    return {
        now: clock.now,
        systemInfo: () => ({ ...HEALTHY_INFO }),
        config: { 'data-root': '/data', 'ui-port': '8000' },
        requiredConfig: ['data-root', 'ui-port'],
        services: FAKE_SERVICES.map((s) => ({ ...s })),
        probe: createMockProbe(),
    };
}

describe('diagnostics constants and defaults', () => {
    test('statuses, service states, and host roles are the named sets', () => {
        expect(CHECK_STATUSES).toEqual(['pass', 'warn', 'fail']);
        expect(SERVICE_STATES).toEqual(['reachable', 'unreachable', 'unconfigured']);
        expect(HOST_ROLES).toEqual(['ui-host', 'inference-host', 'services-host']);
        expect(MIN_NODE_MAJOR).toBe(18);
        expect(DISK_FAIL_BYTES).toBeLessThan(DISK_WARN_BYTES);
    });

    test('default services follow the roadmap startup order, unconfigured, by role only', () => {
        const services = defaultServiceChecks();
        expect(services.map((s) => s.id)).toEqual(['second-brain', 'alltalk', 'gufo', 'stt', 'comfyui']);
        for (const service of services) {
            expect(service.endpoint).toBe('');
            expect(HOST_ROLES).toContain(service.hostRole);
        }
    });
});

describe('all checks pass', () => {
    test('a healthy deployment passes every check with an all-pass summary', async () => {
        const run = await runDiagnostics(healthyOptions());
        expect(run.overall).toBe('pass');
        expect(run.summary).toEqual({ total: 6, pass: 6, warn: 0, fail: 0 });
        expect(run.checks.map((c) => c.id)).toEqual([
            'runtime-node', 'config-data-root', 'config-ui-port',
            'disk-space', 'service-gufo', 'service-alltalk',
        ]);
        expect(run.generatedAt).toBe(new Date(1_700_000_000_000).toISOString());
    });

    test('the probe receives the raw configured endpoints', async () => {
        const options = healthyOptions();
        await runDiagnostics(options);
        expect(options.probe.calls).toEqual(['http://127.0.0.1:9201', 'http://127.0.0.1:9202']);
    });
});

describe('service reachability honesty', () => {
    test('an unreachable optional service is a warning, reported not hidden', async () => {
        const options = healthyOptions();
        options.probe = createMockProbe({ unreachable: ['9202'] });
        const run = await runDiagnostics(options);
        const alltalk = run.checks.find((c) => c.id === 'service-alltalk');
        expect(alltalk.status).toBe('warn');
        expect(alltalk.detail).toContain('unreachable');
        expect(run.summary).toEqual({ total: 6, pass: 5, warn: 1, fail: 0 });
        expect(run.overall).toBe('warn');
    });

    test('an unreachable required service is a failure', async () => {
        const options = healthyOptions();
        options.probe = createMockProbe({ unreachable: ['9201'] });
        const run = await runDiagnostics(options);
        expect(run.checks.find((c) => c.id === 'service-gufo').status).toBe('fail');
        expect(run.overall).toBe('fail');
        expect(run.summary.fail).toBe(1);
    });

    test('a probe reporting ok:false is recorded with its detail', async () => {
        const options = healthyOptions();
        options.probe = async () => ({ ok: false, detail: 'connection refused' });
        const run = await runDiagnostics(options);
        expect(run.checks.find((c) => c.id === 'service-gufo').detail).toContain('connection refused');
        expect(run.checks.find((c) => c.id === 'service-alltalk').status).toBe('warn');
    });

    test('an unconfigured optional service warns; an unconfigured required service fails', async () => {
        const options = healthyOptions();
        options.services = [
            { id: 'gufo', label: 'Gufo', hostRole: 'inference-host', required: true, endpoint: '' },
            { id: 'alltalk', label: 'AllTalk', hostRole: 'services-host', required: false, endpoint: '' },
        ];
        const run = await runDiagnostics(options);
        expect(run.checks.find((c) => c.id === 'service-gufo').status).toBe('fail');
        expect(run.checks.find((c) => c.id === 'service-alltalk').status).toBe('warn');
        expect(options.probe.calls).toEqual([]);
    });

    test('with no probe injected, reachability is a warning, never a pass', async () => {
        const options = healthyOptions();
        delete options.probe;
        const run = await runDiagnostics(options);
        expect(run.checks.find((c) => c.id === 'service-gufo').status).toBe('warn');
        expect(run.overall).toBe('warn');
    });
});

describe('config and runtime checks', () => {
    test('a missing required config value is recorded as a failure', async () => {
        const options = healthyOptions();
        options.config = { 'data-root': '/data' };
        const run = await runDiagnostics(options);
        const missing = run.checks.find((c) => c.id === 'config-ui-port');
        expect(missing.status).toBe('fail');
        expect(missing.detail).toContain('missing');
        expect(run.overall).toBe('fail');
    });

    test('an empty-string required config value counts as missing', async () => {
        const options = healthyOptions();
        options.config = { 'data-root': '   ', 'ui-port': '8000' };
        const run = await runDiagnostics(options);
        expect(run.checks.find((c) => c.id === 'config-data-root').status).toBe('fail');
    });

    test('an old node version fails; an unreported one only warns', async () => {
        const old = healthyOptions();
        old.systemInfo = () => ({ ...HEALTHY_INFO, nodeVersion: 'v16.20.0' });
        expect((await runDiagnostics(old)).checks[0].status).toBe('fail');

        const silent = healthyOptions();
        silent.systemInfo = () => ({ ...HEALTHY_INFO, nodeVersion: '' });
        expect((await runDiagnostics(silent)).checks[0].status).toBe('warn');
    });

    test('low disk warns and critically low disk fails', async () => {
        const low = healthyOptions();
        low.systemInfo = () => ({ ...HEALTHY_INFO, freeDiskBytes: DISK_WARN_BYTES - 1 });
        expect((await runDiagnostics(low)).checks.find((c) => c.id === 'disk-space').status).toBe('warn');

        const critical = healthyOptions();
        critical.systemInfo = () => ({ ...HEALTHY_INFO, freeDiskBytes: DISK_FAIL_BYTES - 1 });
        expect((await runDiagnostics(critical)).checks.find((c) => c.id === 'disk-space').status).toBe('fail');
    });
});

describe('never throws', () => {
    test('a throwing probe is recorded, and the run still completes', async () => {
        const options = healthyOptions();
        options.probe = async () => { throw new Error('socket exploded'); };
        const run = await runDiagnostics(options);
        expect(run.checks.find((c) => c.id === 'service-gufo').detail).toContain('socket exploded');
        expect(run.summary.total).toBe(6);
    });

    test('a throwing system-info provider fails runtime and warns disk, never throws', async () => {
        const options = healthyOptions();
        options.systemInfo = () => { throw new Error('info boom'); };
        const run = await runDiagnostics(options);
        expect(run.checks.find((c) => c.id === 'runtime-node').status).toBe('fail');
        expect(run.checks.find((c) => c.id === 'disk-space').status).toBe('warn');
    });

    test('a throwing config provider fails every required config check', async () => {
        const options = healthyOptions();
        options.getConfig = () => { throw new Error('config boom'); };
        delete options.config;
        const run = await runDiagnostics(options);
        expect(run.checks.filter((c) => c.id.startsWith('config-')).every((c) => c.status === 'fail')).toBe(true);
    });

    test('no options at all still produces a complete, honest run', async () => {
        const run = await runDiagnostics();
        expect(run.summary.total).toBe(run.checks.length);
        expect(run.summary.total).toBeGreaterThan(0);
        expect(run.overall).not.toBe('pass');
    });

    test('a throwing clock does not break the run', async () => {
        const options = healthyOptions();
        options.now = () => { throw new Error('clock boom'); };
        const run = await runDiagnostics(options);
        expect(run.generatedAt).toBeNull();
        expect(run.summary.total).toBe(6);
    });
});

describe('secret redaction', () => {
    test('stripUrlSecrets removes userinfo and redacts secret query params', () => {
        expect(stripUrlSecrets('http://user:pass@127.0.0.1:9201/path?api_key=abc123&mode=fast'))
            .toBe('http://127.0.0.1:9201/path?api_key=%5Bredacted%5D&mode=fast');
        expect(stripUrlSecrets('http://127.0.0.1:9201')).toBe('http://127.0.0.1:9201/');
        expect(stripUrlSecrets('')).toBe('');
    });

    test('redactDiagnosticText strips Bearer tokens and key=value secrets', () => {
        expect(redactDiagnosticText('Authorization: Bearer abc.def-123 failed'))
            .toBe('Authorization: Bearer [redacted] failed');
        expect(redactDiagnosticText('token=supersecret was rejected'))
            .toBe('token=[redacted] was rejected');
        expect(redactDiagnosticText(42)).toBe('');
    });

    test('secrets in endpoints and probe errors never reach the report', async () => {
        const options = healthyOptions();
        options.services = [
            { id: 'gufo', label: 'Gufo', hostRole: 'inference-host', required: true, endpoint: 'http://user:pass@127.0.0.1:9201/?api_key=topsecret' },
        ];
        options.probe = async () => { throw new Error('auth failed for Bearer abc.def-123 with token=topsecret'); };
        const report = buildDiagnosticReport(await runDiagnostics(options));
        expect(report).not.toContain('topsecret');
        expect(report).not.toContain('abc.def-123');
        expect(report).not.toContain('user:pass');
        expect(report).toContain('[redacted]');
    });
});

describe('the copyable report', () => {
    test('the report is deterministic for the same run inputs and fake clock', async () => {
        const first = buildDiagnosticReport(await runDiagnostics(healthyOptions()));
        const second = buildDiagnosticReport(await runDiagnostics(healthyOptions()));
        expect(first).toBe(second);
    });

    test('the report carries header, one line per check, and the honest summary', async () => {
        const options = healthyOptions();
        options.probe = createMockProbe({ unreachable: ['9202'] });
        const report = buildDiagnosticReport(await runDiagnostics(options));
        expect(report).toContain('RuneForgeAI local diagnostics report');
        expect(report).toContain('Overall: WARN');
        expect(report).toContain('PASS service-gufo');
        expect(report).toContain('WARN service-alltalk');
        expect(report).toContain('Summary: 5 passed, 1 warnings, 0 failed, 6 total.');
    });

    test('the mock probe records calls and honors the unreachable list', async () => {
        const probe = createMockProbe({ unreachable: ['down'] });
        await expect(probe('http://127.0.0.1:9201/up')).resolves.toEqual({ ok: true, latencyMs: 1 });
        await expect(probe('http://127.0.0.1:9202/down')).rejects.toThrow('mock unreachable');
        expect(probe.calls).toHaveLength(2);
    });
});
