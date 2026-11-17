/**
 * RFST-018 - Global integration status/settings panel.
 *
 * Roadmap evidence required (section 14): "All service endpoints
 * and states usable centrally." Section 13 (Phase 8) defines the
 * single global settings panel: connection status for Gufo /
 * AllTalk / STT / ComfyUI / Second Brain, one machine-wide
 * endpoint URL per service, conversation modes, audio defaults,
 * image settings (auto model selection, manual override, idle
 * unload), knowledge as ONE global toggle + relevance threshold
 * + token budget with NO per-character collection controls, and
 * a diagnostics section with last error, current state, and a
 * copyable local debug report with secrets stripped.
 *
 * The core (src/settings/integration-panel-core.js) is imported
 * and exercised for real with an injected fake clock; no live
 * service is contacted. Endpoints in tests are loopback URLs
 * with clearly fake ports, per prior suites' convention.
 *
 * Live evidence status: the live Windows UI panel is GATED on
 * the F15 UI host (campaign/PROGRESS.md), exactly as
 * RFST-013..017 gated their live legs.
 */
import { describe, test, expect } from '@jest/globals';

import {
    CONNECTION_STATES,
    CONVERSATION_MODES,
    DEFAULT_SETTINGS,
    SERVICES,
    SERVICE_IDS,
    aggregateStatus,
    createDefaultSettings,
    createIntegrationPanel,
    hasPerCharacterKeys,
    migrateSettings,
    normalizeEndpoint,
    redactSecrets,
    stripUrlSecrets,
    validateEndpoint,
} from '../src/settings/integration-panel-core.js';

function makeClock(start = 1_700_000_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
}

const FAKE_ENDPOINTS = {
    gufo: 'http://127.0.0.1:9101',
    alltalk: 'http://127.0.0.1:9102',
    stt: 'http://127.0.0.1:9103',
    comfyui: 'http://127.0.0.1:9104',
    'second-brain': 'http://127.0.0.1:9105',
};

function configuredPanel(clock = makeClock()) {
    return createIntegrationPanel({ settings: { endpoints: { ...FAKE_ENDPOINTS } }, now: clock.now });
}

describe('service registry (section 13)', () => {
    test('exactly the five roadmap services, in panel order', () => {
        expect(SERVICE_IDS).toEqual(['gufo', 'alltalk', 'stt', 'comfyui', 'second-brain']);
        expect(SERVICES.map((s) => s.label)).toEqual(['Gufo', 'AllTalk', 'STT', 'ComfyUI', 'Second Brain']);
        expect(CONNECTION_STATES).toEqual(['unknown', 'checking', 'ok', 'degraded', 'down', 'unconfigured']);
        expect(CONVERSATION_MODES).toEqual(['text-only', 'text+voice', 'push-to-talk', 'hands-free']);
    });

    test('each service has a single machine-wide endpoint setting', () => {
        const settings = createDefaultSettings();
        expect(Object.keys(settings.endpoints).sort()).toEqual([...SERVICE_IDS].sort());
        for (const id of SERVICE_IDS) {
            expect(settings.endpoints[id]).toBe('');
        }
    });
});

describe('endpoint validation and normalization', () => {
    test('accepts http/https and normalizes trailing slashes', () => {
        expect(validateEndpoint('http://127.0.0.1:9101/')).toEqual({ ok: true, url: 'http://127.0.0.1:9101', error: null });
        expect(normalizeEndpoint('https://example.invalid/api///')).toBe('https://example.invalid/api');
        expect(normalizeEndpoint('  http://127.0.0.1:9104  ')).toBe('http://127.0.0.1:9104');
    });

    test('empty endpoint is valid and means unconfigured', () => {
        expect(validateEndpoint('')).toEqual({ ok: true, url: '', error: null });
        expect(validateEndpoint('   ')).toEqual({ ok: true, url: '', error: null });
        expect(validateEndpoint(undefined)).toEqual({ ok: true, url: '', error: null });
    });

    test('rejects invalid URLs and non-http(s) schemes', () => {
        expect(validateEndpoint('not a url').ok).toBe(false);
        expect(validateEndpoint('not a url').error).toBe('invalid_url');
        expect(validateEndpoint('ftp://127.0.0.1:9101').error).toBe('unsupported_protocol');
        expect(validateEndpoint('file:///etc/passwd').error).toBe('unsupported_protocol');
        expect(normalizeEndpoint('::nonsense::')).toBe('');
    });

    test('rejects URLs with embedded credentials', () => {
        const result = validateEndpoint('http://user:pass@127.0.0.1:9101');
        expect(result.ok).toBe(false);
        expect(result.error).toBe('embedded_credentials');
        expect(validateEndpoint('https://tokenonly@127.0.0.1:9101').error).toBe('embedded_credentials');
    });

    test('setEndpoint stores normalized URL; invalid input keeps the old one', () => {
        const panel = createIntegrationPanel({ now: makeClock().now });
        expect(panel.setEndpoint('gufo', 'http://127.0.0.1:9101/')).toEqual({ ok: true, error: null, url: 'http://127.0.0.1:9101' });
        expect(panel.getSettings().endpoints.gufo).toBe('http://127.0.0.1:9101');
        const rejected = panel.setEndpoint('gufo', 'http://user:pass@127.0.0.1:9101');
        expect(rejected.ok).toBe(false);
        expect(panel.getSettings().endpoints.gufo).toBe('http://127.0.0.1:9101');
        expect(() => panel.setEndpoint('nope', 'http://127.0.0.1:1')).toThrow('unknown_service:nope');
    });
});

describe('connection-status model', () => {
    test('unconfigured services start unconfigured; configured start unknown', () => {
        const empty = createIntegrationPanel({ now: makeClock().now });
        expect(empty.getServiceStatus('gufo').state).toBe('unconfigured');
        expect(empty.overallStatus()).toBe('unconfigured');
        const panel = configuredPanel();
        expect(panel.getServiceStatus('gufo').state).toBe('unknown');
        expect(panel.overallStatus()).toBe('unknown');
    });

    test('check lifecycle: checking -> ok records timestamps', () => {
        const clock = makeClock();
        const panel = configuredPanel(clock);
        expect(panel.beginCheck('gufo').state).toBe('checking');
        expect(panel.overallStatus()).toBe('checking');
        const done = panel.recordCheckResult('gufo', { ok: true });
        expect(done.state).toBe('ok');
        expect(done.lastCheckedAt).toBe(1_700_000_000_000);
        expect(done.lastOkAt).toBe(1_700_000_000_000);
        expect(done.lastError).toBeNull();
    });

    test('degraded result is recorded as degraded', () => {
        const panel = configuredPanel();
        expect(panel.recordCheckResult('comfyui', { ok: true, degraded: true, detail: 'slow' }).state).toBe('degraded');
        expect(panel.overallStatus()).toBe('degraded');
    });

    test('failure keeps last error and last ok time (stale/error retention)', () => {
        const clock = makeClock();
        const panel = configuredPanel(clock);
        panel.recordCheckResult('alltalk', { ok: true });
        clock.advance(60_000);
        const failed = panel.recordCheckResult('alltalk', { ok: false, error: new Error('connect ECONNREFUSED') });
        expect(failed.state).toBe('down');
        expect(failed.lastError).toBe('connect ECONNREFUSED');
        expect(failed.lastOkAt).toBe(1_700_000_000_000);
        expect(failed.lastCheckedAt).toBe(1_700_000_060_000);
        clock.advance(60_000);
        const recovered = panel.recordCheckResult('alltalk', { ok: true });
        expect(recovered.state).toBe('ok');
        expect(recovered.lastError).toBeNull();
    });

    test('checks on an unconfigured service stay unconfigured', () => {
        const panel = createIntegrationPanel({ now: makeClock().now });
        expect(panel.beginCheck('stt').state).toBe('unconfigured');
        expect(panel.recordCheckResult('stt', { ok: true }).state).toBe('unconfigured');
    });

    test('changing an endpoint resets that service status', () => {
        const panel = configuredPanel();
        panel.recordCheckResult('gufo', { ok: false, error: 'boom' });
        panel.setEndpoint('gufo', 'http://127.0.0.1:9201');
        const status = panel.getServiceStatus('gufo');
        expect(status.state).toBe('unknown');
        expect(status.lastError).toBeNull();
        panel.setEndpoint('gufo', '');
        expect(panel.getServiceStatus('gufo').state).toBe('unconfigured');
    });

    test('aggregation precedence across mixed states', () => {
        const base = Object.fromEntries(SERVICE_IDS.map((id) => [id, { state: 'ok' }]));
        expect(aggregateStatus(base)).toBe('ok');
        expect(aggregateStatus({ ...base, stt: { state: 'degraded' } })).toBe('degraded');
        expect(aggregateStatus({ ...base, stt: { state: 'degraded' }, comfyui: { state: 'down' } })).toBe('down');
        expect(aggregateStatus({ ...base, stt: { state: 'checking' } })).toBe('checking');
        const none = Object.fromEntries(SERVICE_IDS.map((id) => [id, { state: 'unconfigured' }]));
        expect(aggregateStatus(none)).toBe('unconfigured');
    });
});

describe('global settings, defaults and migration', () => {
    test('defaults match the section 13 panel shape', () => {
        const settings = createDefaultSettings();
        expect(settings.conversation.mode).toBe('text+voice');
        expect(settings.audio).toEqual(DEFAULT_SETTINGS.audio);
        expect(settings.images.autoModelSelection).toBe(true);
        expect(settings.images.idleUnloadEnabled).toBe(true);
        expect(settings.knowledge).toEqual({ enabled: true, relevanceThreshold: 0.35, tokenBudget: 1500 });
        expect(CONVERSATION_MODES).toContain(settings.conversation.mode);
    });

    test('migration fills defaults for missing sections', () => {
        const migrated = migrateSettings({ conversation: { mode: 'push-to-talk' } });
        expect(migrated.conversation.mode).toBe('push-to-talk');
        expect(migrated.audio).toEqual(createDefaultSettings().audio);
        expect(migrated.knowledge.tokenBudget).toBe(1500);
        expect(migrateSettings(null)).toEqual(createDefaultSettings());
        expect(migrateSettings('junk')).toEqual(createDefaultSettings());
    });

    test('migration drops unknown keys and invalid values, clamps numbers', () => {
        const migrated = migrateSettings({
            bogusSection: { x: 1 },
            conversation: { mode: 'loud-mode', extra: true },
            audio: { volume: 7, autoplay: 'yes' },
            images: { generationTrigger: 'sometimes', idleUnloadMinutes: -5 },
            knowledge: { relevanceThreshold: 4, tokenBudget: 1234.9 },
            endpoints: { gufo: 'http://127.0.0.1:9101/', unknownSvc: 'http://127.0.0.1:1', stt: 'ftp://x' },
        });
        expect(migrated.bogusSection).toBeUndefined();
        expect(migrated.conversation).toEqual({ mode: 'text+voice' });
        expect(migrated.audio.volume).toBe(1);
        expect(migrated.audio.autoplay).toBe(true);
        expect(migrated.images.generationTrigger).toBe('manual');
        expect(migrated.images.idleUnloadMinutes).toBe(0);
        expect(migrated.knowledge.relevanceThreshold).toBe(1);
        expect(migrated.knowledge.tokenBudget).toBe(1234);
        expect(migrated.endpoints.gufo).toBe('http://127.0.0.1:9101');
        expect(migrated.endpoints.unknownSvc).toBeUndefined();
        expect(migrated.endpoints.stt).toBe('');
    });

    test('updateSettings merges a patch through migration', () => {
        const panel = configuredPanel();
        const updated = panel.updateSettings({ knowledge: { enabled: false, relevanceThreshold: 0.5, tokenBudget: 800 } });
        expect(updated.knowledge).toEqual({ enabled: false, relevanceThreshold: 0.5, tokenBudget: 800 });
        expect(updated.endpoints).toEqual(FAKE_ENDPOINTS);
        expect(panel.getSettings().knowledge.enabled).toBe(false);
    });

    test('returned settings are copies, not live references', () => {
        const panel = configuredPanel();
        const copy = panel.getSettings();
        copy.knowledge.enabled = false;
        copy.endpoints.gufo = 'http://127.0.0.1:1';
        expect(panel.getSettings().knowledge.enabled).toBe(true);
        expect(panel.getSettings().endpoints.gufo).toBe(FAKE_ENDPOINTS.gufo);
    });
});

describe('invariants: global only, chat never disabled', () => {
    test('knowledge has exactly one global toggle, threshold and budget - no per-character controls', () => {
        const settings = createDefaultSettings();
        expect(Object.keys(settings.knowledge).sort()).toEqual(['enabled', 'relevanceThreshold', 'tokenBudget']);
        expect(hasPerCharacterKeys(settings)).toBe(false);
        expect(hasPerCharacterKeys(migrateSettings({ characters: { a: {} }, knowledge: { enabled: true } }))).toBe(false);
        expect(hasPerCharacterKeys({ perCharacter: {} })).toBe(true);
    });

    test('migration never carries per-character keys through', () => {
        const migrated = migrateSettings({
            characterSettings: { someChar: { knowledge: { enabled: false } } },
            characters: [{ name: 'x' }],
        });
        expect(JSON.stringify(migrated)).not.toContain('characterSettings');
        expect(migrated.knowledge.enabled).toBe(true);
    });

    test('a down or unconfigured service never disables chat', () => {
        const panel = configuredPanel();
        for (const id of SERVICE_IDS) {
            panel.recordCheckResult(id, { ok: false, error: 'down' });
        }
        expect(panel.overallStatus()).toBe('down');
        expect(panel.isChatAvailable()).toBe(true);
        const empty = createIntegrationPanel({ now: makeClock().now });
        expect(empty.isChatAvailable()).toBe(true);
        expect(empty.featureAvailability().chat).toBe(true);
    });

    test('feature availability follows service states and the knowledge toggle', () => {
        const panel = configuredPanel();
        expect(panel.featureAvailability()).toEqual({ chat: true, voicePlayback: false, speechInput: false, images: false, knowledge: false });
        panel.recordCheckResult('alltalk', { ok: true });
        panel.recordCheckResult('second-brain', { ok: true, degraded: true });
        const features = panel.featureAvailability();
        expect(features.voicePlayback).toBe(true);
        expect(features.knowledge).toBe(true);
        panel.updateSettings({ knowledge: { enabled: false, relevanceThreshold: 0.35, tokenBudget: 1500 } });
        expect(panel.featureAvailability().knowledge).toBe(false);
    });
});

describe('diagnostics report (secrets stripped)', () => {
    test('report lists every service state and the overall status', () => {
        const panel = configuredPanel();
        panel.recordCheckResult('gufo', { ok: true });
        panel.recordCheckResult('stt', { ok: false, error: 'timeout' });
        const report = panel.buildDiagnosticsReport();
        expect(report).toContain('Overall status: down');
        expect(report).toContain('Gufo [gufo]: ok');
        expect(report).toContain('STT [stt]: down');
        expect(report).toContain('lastError: timeout');
        expect(report).toContain('Second Brain [second-brain]: unknown');
    });

    test('report strips credentials, tokens and secret query params', () => {
        const panel = configuredPanel();
        panel.recordCheckResult('gufo', { ok: false, error: 'auth failed for Bearer abcDEF123456 token=hunter2 password: s3cret' });
        const report = panel.buildDiagnosticsReport();
        expect(report).not.toContain('abcDEF123456');
        expect(report).not.toContain('hunter2');
        expect(report).not.toContain('s3cret');
        expect(report).toContain('[redacted]');
        expect(stripUrlSecrets('http://user:pass@127.0.0.1:9101/x?api_key=zzz&mode=fast')).toBe('http://127.0.0.1:9101/x?api_key=%5Bredacted%5D&mode=fast');
        expect(redactSecrets('Authorization: Bearer qqq111')).not.toContain('qqq111');
    });

    test('report shows unconfigured services without inventing endpoints', () => {
        const panel = createIntegrationPanel({ now: makeClock().now });
        const report = panel.buildDiagnosticsReport();
        expect(report).toContain('Overall status: unconfigured');
        expect(report).toContain('(not configured)');
    });
});
