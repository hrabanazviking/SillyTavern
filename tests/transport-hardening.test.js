/**
 * RFST-019 - Network and transport hardening.
 *
 * Roadmap evidence required (section 14): "Tailnet-only/no
 * accidental public endpoints."
 *
 * The core (src/settings/transport-hardening-core.js) is imported
 * and exercised for real against mock service configs for the
 * five RFST-018 services; no live service is contacted and no
 * socket is opened. Addresses in tests are documentation/example
 * values only: loopback, the generic tailnet CGNAT range
 * (100.64.0.0/10), RFC1918 ranges, and the RFC 5737 documentation
 * range 203.0.113.0/24 standing in for public addresses.
 *
 * Live evidence status: a live audit of the actually running
 * services across all machines is GATED where a machine is
 * asleep or unavailable (campaign/PROGRESS.md), exactly as
 * RFST-013..018 gated their live legs. This core never
 * reconfigures a running service.
 */
import { describe, test, expect } from '@jest/globals';

import {
    ADDRESS_CLASSES,
    AUDIT_VERDICTS,
    SERVICE_IDS,
    auditEndpoint,
    auditEndpoints,
    buildHardeningReport,
    classifyBindAddress,
    classifyHost,
    isPrivateClass,
    normalizeEndpointUrl,
    parseIpv4,
    redactSecrets,
    stripUrlSecrets,
    validateEndpointUrl,
} from '../src/settings/transport-hardening-core.js';

const TAILNET_ENDPOINTS = {
    gufo: { url: 'http://100.64.0.11:9101' },
    alltalk: { url: 'http://100.64.0.12:9102' },
    stt: { url: 'http://127.0.0.1:9103' },
    comfyui: { url: 'https://example-machine.tailnet-name.ts.net:9104' },
    'second-brain': { url: 'http://100.64.0.15:9105' },
};

describe('address classification', () => {
    test('registry constants cover the five services and all classes', () => {
        expect(SERVICE_IDS).toEqual(['gufo', 'alltalk', 'stt', 'comfyui', 'second-brain']);
        expect(ADDRESS_CLASSES).toEqual(['loopback', 'tailnet', 'lan-private', 'link-local', 'wildcard', 'public', 'invalid']);
        expect(AUDIT_VERDICTS).toEqual(['ok', 'warning', 'violation', 'unconfigured']);
    });

    test('loopback: 127.0.0.0/8, localhost, ::1', () => {
        expect(classifyHost('127.0.0.1')).toBe('loopback');
        expect(classifyHost('127.10.20.30')).toBe('loopback');
        expect(classifyHost('localhost')).toBe('loopback');
        expect(classifyHost('::1')).toBe('loopback');
    });

    test('tailnet: the whole 100.64.0.0/10 CGNAT range and *.ts.net names', () => {
        expect(classifyHost('100.64.0.1')).toBe('tailnet');
        expect(classifyHost('100.100.100.100')).toBe('tailnet');
        expect(classifyHost('100.127.255.254')).toBe('tailnet');
        expect(classifyHost('some-host.tailnet-name.ts.net')).toBe('tailnet');
    });

    test('addresses just outside 100.64.0.0/10 are not tailnet', () => {
        expect(classifyHost('100.63.255.255')).toBe('public');
        expect(classifyHost('100.128.0.1')).toBe('public');
    });

    test('LAN-private: RFC1918 ranges only', () => {
        expect(classifyHost('10.0.0.5')).toBe('lan-private');
        expect(classifyHost('172.16.0.5')).toBe('lan-private');
        expect(classifyHost('172.31.255.255')).toBe('lan-private');
        expect(classifyHost('192.168.1.20')).toBe('lan-private');
        expect(classifyHost('172.32.0.1')).toBe('public');
    });

    test('wildcard, link-local, public, and invalid hosts', () => {
        expect(classifyHost('0.0.0.0')).toBe('wildcard');
        expect(classifyHost('::')).toBe('wildcard');
        expect(classifyHost('169.254.1.1')).toBe('link-local');
        expect(classifyHost('203.0.113.10')).toBe('public');
        expect(classifyHost('example.com')).toBe('public');
        expect(classifyHost('')).toBe('invalid');
        expect(classifyHost('   ')).toBe('invalid');
    });

    test('parseIpv4 rejects malformed quads', () => {
        expect(parseIpv4('100.64.0.1')).toEqual([100, 64, 0, 1]);
        expect(parseIpv4('999.1.1.1')).toBeNull();
        expect(parseIpv4('1.2.3')).toBeNull();
        expect(parseIpv4('a.b.c.d')).toBeNull();
    });

    test('bind addresses ignore an optional port and handle brackets', () => {
        expect(classifyBindAddress('0.0.0.0:8001')).toBe('wildcard');
        expect(classifyBindAddress('127.0.0.1:8001')).toBe('loopback');
        expect(classifyBindAddress('100.64.0.1:8001')).toBe('tailnet');
        expect(classifyBindAddress('[::1]:8001')).toBe('loopback');
        expect(classifyBindAddress('')).toBe('invalid');
    });

    test('isPrivateClass covers loopback/tailnet/LAN/link-local only', () => {
        for (const cls of ['loopback', 'tailnet', 'lan-private', 'link-local']) {
            expect(isPrivateClass(cls)).toBe(true);
        }
        for (const cls of ['wildcard', 'public', 'invalid']) {
            expect(isPrivateClass(cls)).toBe(false);
        }
    });
});

describe('endpoint URL validation', () => {
    test('accepts tailnet and loopback http/https endpoints and normalizes', () => {
        expect(validateEndpointUrl('http://100.64.0.1:8001/')).toEqual({
            ok: true, url: 'http://100.64.0.1:8001', error: null, hostClass: 'tailnet',
        });
        expect(normalizeEndpointUrl('https://host.example.ts.net/api///')).toBe('https://host.example.ts.net/api');
        expect(validateEndpointUrl('http://127.0.0.1:9101').hostClass).toBe('loopback');
    });

    test('rejects public endpoints unless explicitly allowed', () => {
        const rejected = validateEndpointUrl('https://203.0.113.10:8001');
        expect(rejected.ok).toBe(false);
        expect(rejected.hostClass).toBe('public');
        expect(validateEndpointUrl('https://203.0.113.10:8001', { allowPublic: true }).ok).toBe(true);
        expect(validateEndpointUrl('http://example.com:8001').ok).toBe(false);
    });

    test('rejects wildcard endpoint hosts', () => {
        expect(validateEndpointUrl('http://0.0.0.0:8001').ok).toBe(false);
    });

    test('rejects credentials embedded in URLs, even with allowPublic', () => {
        expect(validateEndpointUrl('http://user:pass@100.64.0.1:8001').ok).toBe(false);
        expect(validateEndpointUrl('http://user:pass@100.64.0.1:8001').error).toMatch(/credentials/);
        expect(validateEndpointUrl('https://user@127.0.0.1:8001', { allowPublic: true }).ok).toBe(false);
    });

    test('rejects non-http(s) schemes and garbage', () => {
        expect(validateEndpointUrl('ftp://100.64.0.1/files').ok).toBe(false);
        expect(validateEndpointUrl('file:///etc/passwd').ok).toBe(false);
        expect(validateEndpointUrl('not a url').ok).toBe(false);
        expect(validateEndpointUrl('').ok).toBe(false);
        expect(normalizeEndpointUrl('ftp://100.64.0.1')).toBe('');
    });
});

describe('service endpoint audit', () => {
    test('a fully tailnet/loopback five-service set is compliant and all ok', () => {
        const audit = auditEndpoints(TAILNET_ENDPOINTS);
        expect(audit.compliant).toBe(true);
        expect(audit.summary).toEqual({ ok: 5, warning: 0, violation: 0, unconfigured: 0, total: 5 });
    });

    test('a public endpoint is a violation without opt-in', () => {
        const result = auditEndpoint('gufo', { url: 'https://203.0.113.10:8001' });
        expect(result.verdict).toBe('violation');
        expect(result.hostClass).toBe('public');
        expect(result.reasons.join(' ')).toMatch(/explicit opt-in/);
    });

    test('a public endpoint with explicit opt-in is a warning, never silent ok', () => {
        const result = auditEndpoint('gufo', { url: 'https://203.0.113.10:8001', allowPublic: true });
        expect(result.verdict).toBe('warning');
    });

    test('a wildcard bind is a violation without opt-in, a warning with it', () => {
        expect(auditEndpoint('alltalk', { bindAddress: '0.0.0.0' }).verdict).toBe('violation');
        expect(auditEndpoint('alltalk', { bindAddress: '0.0.0.0:7851' }).verdict).toBe('violation');
        expect(auditEndpoint('alltalk', { bindAddress: '0.0.0.0', allowWildcardBind: true }).verdict).toBe('warning');
    });

    test('a tailnet or loopback bind is ok; a public bind is a violation', () => {
        expect(auditEndpoint('stt', { bindAddress: '100.64.0.20' }).verdict).toBe('ok');
        expect(auditEndpoint('stt', { bindAddress: '127.0.0.1' }).verdict).toBe('ok');
        expect(auditEndpoint('stt', { bindAddress: '203.0.113.10' }).verdict).toBe('violation');
    });

    test('credentialed URLs are violations even on tailnet hosts', () => {
        const result = auditEndpoint('comfyui', { url: 'http://user:pass@100.64.0.1:8188' });
        expect(result.verdict).toBe('violation');
        expect(result.reasons.join(' ')).toMatch(/credentials/);
    });

    test('non-http(s) endpoint URLs are violations', () => {
        expect(auditEndpoint('gufo', { url: 'ftp://100.64.0.1:21' }).verdict).toBe('violation');
    });

    test('LAN-private endpoints warn: reachable on the LAN, not tailnet-only', () => {
        const result = auditEndpoint('second-brain', { url: 'http://192.168.1.20:9000' });
        expect(result.verdict).toBe('warning');
        expect(result.hostClass).toBe('lan-private');
    });

    test('missing configs are unconfigured, not violations', () => {
        const audit = auditEndpoints({});
        expect(audit.summary.unconfigured).toBe(5);
        expect(audit.compliant).toBe(true);
        expect(auditEndpoint('gufo', {}).verdict).toBe('unconfigured');
        expect(auditEndpoint('gufo').verdict).toBe('unconfigured');
    });

    test('aggregation counts a mixed set correctly and flags non-compliance', () => {
        const audit = auditEndpoints({
            gufo: { url: 'http://100.64.0.11:9101' },
            alltalk: { bindAddress: '0.0.0.0' },
            stt: { url: 'http://192.168.1.20:9103' },
            comfyui: { url: 'https://203.0.113.10:9104', allowPublic: true },
            // second-brain unconfigured
        });
        expect(audit.summary).toEqual({ ok: 1, warning: 2, violation: 1, unconfigured: 1, total: 5 });
        expect(audit.compliant).toBe(false);
        expect(audit.results.map((r) => r.serviceId)).toEqual([...SERVICE_IDS]);
    });

    test('a violation anywhere dominates warnings for that service', () => {
        const result = auditEndpoint('gufo', {
            url: 'http://192.168.1.20:9101',
            bindAddress: '0.0.0.0',
        });
        expect(result.verdict).toBe('violation');
    });
});

describe('diagnostics report', () => {
    test('report mirrors the audit summary and per-service verdicts', () => {
        const report = buildHardeningReport(TAILNET_ENDPOINTS);
        expect(report.compliant).toBe(true);
        expect(report.summary).toEqual({ ok: 5, warning: 0, violation: 0, unconfigured: 0, total: 5 });
        expect(report.services.map((s) => s.serviceId)).toEqual([...SERVICE_IDS]);
        expect(report.services.every((s) => s.verdict === 'ok')).toBe(true);
    });

    test('report strips credentials and secret query values from endpoints', () => {
        const report = buildHardeningReport({
            gufo: { url: 'http://user:pass@100.64.0.1:8001/?api_key=supersecretvalue&mode=fast' },
        });
        const gufo = report.services.find((s) => s.serviceId === 'gufo');
        expect(gufo.endpoint).not.toContain('pass');
        expect(gufo.endpoint).not.toContain('supersecretvalue');
        expect(gufo.endpoint).toContain('REDACTED');
        expect(JSON.stringify(report)).not.toContain('supersecretvalue');
    });

    test('stripUrlSecrets and redactSecrets remove secret material', () => {
        expect(stripUrlSecrets('http://user:pass@127.0.0.1:9000/?token=abc123')).not.toContain('abc123');
        expect(redactSecrets('Authorization: Bearer abc.def-123')).not.toContain('abc.def-123');
        expect(redactSecrets('password=hunter2')).not.toContain('hunter2');
        expect(stripUrlSecrets('')).toBe('');
    });
});
