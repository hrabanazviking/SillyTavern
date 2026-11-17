/**
 * Network and transport hardening core (RFST-019).
 *
 * Roadmap evidence required (section 14): "Tailnet-only/no
 * accidental public endpoints."
 *
 * The distributed companion runs its services (Gufo, AllTalk,
 * STT, ComfyUI, Second Brain — the five-service registry from
 * RFST-018) across the user's own machines on a private tailnet.
 * Nothing in that topology needs a public endpoint, so a public
 * bind or a public endpoint URL is always either a mistake or a
 * deliberate, explicitly opted-in exception — never an accident
 * this core will wave through.
 *
 * This dependency-free core provides:
 *   - Classification of bind addresses and endpoint hostnames:
 *     loopback, tailnet (100.64.0.0/10 CGNAT range used by
 *     Tailscale, plus *.ts.net tailnet hostnames), LAN-private
 *     (RFC1918), link-local, wildcard, and public.
 *   - An audit over a set of service endpoint configs that
 *     reports each endpoint as ok / warning / violation:
 *     public endpoints and wildcard binds are violations unless
 *     the config carries an explicit opt-in flag; credentialed
 *     URLs and non-http(s) schemes are always violations.
 *   - URL normalization/validation rejecting credentials
 *     embedded in URLs and non-http(s) schemes.
 *   - A secrets-stripped summary suitable for the diagnostics
 *     panel (RFST-018).
 *
 * The core is pure and injected: it performs no network calls,
 * reads no sockets, and inspects only the configuration values
 * it is handed (a real settings object in production, mocks in
 * tests), exactly as RFST-013..018 injected their clients.
 *
 * The live leg — auditing the actually running services across
 * all machines — is GATED where a machine is asleep or
 * unavailable (see campaign/PROGRESS.md); this core is the
 * audit's logic and never reconfigures a running service.
 */

export const SERVICE_IDS = Object.freeze(['gufo', 'alltalk', 'stt', 'comfyui', 'second-brain']);

export const ADDRESS_CLASSES = Object.freeze([
    'loopback',
    'tailnet',
    'lan-private',
    'link-local',
    'wildcard',
    'public',
    'invalid',
]);

export const AUDIT_VERDICTS = Object.freeze(['ok', 'warning', 'violation', 'unconfigured']);

const SECRET_KEY_PATTERN = /token|secret|password|passwd|api[-_]?key|authorization|credential/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE_SECRET_PATTERN = /\b(token|secret|password|passwd|api[-_]?key|authorization)\s*[:=]\s*\S+/gi;

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** Parse a dotted-quad IPv4 string into [a,b,c,d] or null. */
export function parseIpv4(value) {
    const text = cleanString(value);
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
    if (!match) {
        return null;
    }
    const octets = match.slice(1).map((part) => Number(part));
    return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isLoopbackIpv4(octets) {
    return octets[0] === 127;
}

function isTailnetIpv4(octets) {
    // Tailscale assigns addresses from the CGNAT range 100.64.0.0/10.
    return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

function isLanPrivateIpv4(octets) {
    return octets[0] === 10
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168);
}

function isLinkLocalIpv4(octets) {
    return octets[0] === 169 && octets[1] === 254;
}

function isWildcardIpv4(octets) {
    return octets.every((octet) => octet === 0);
}

/**
 * Classify a bare host value: an IPv4 address, an IPv6 address,
 * or a hostname. Returns one of ADDRESS_CLASSES.
 */
export function classifyHost(host) {
    const text = cleanString(host).toLowerCase().replace(/^\[|\]$/g, '');
    if (!text) {
        return 'invalid';
    }
    if (text === 'localhost' || text.endsWith('.localhost')) {
        return 'loopback';
    }
    if (text === '::1') {
        return 'loopback';
    }
    if (text === '::' || text === '0.0.0.0') {
        return 'wildcard';
    }
    if (text.endsWith('.ts.net')) {
        return 'tailnet';
    }
    const octets = parseIpv4(text);
    if (octets) {
        if (isWildcardIpv4(octets)) {
            return 'wildcard';
        }
        if (isLoopbackIpv4(octets)) {
            return 'loopback';
        }
        if (isTailnetIpv4(octets)) {
            return 'tailnet';
        }
        if (isLanPrivateIpv4(octets)) {
            return 'lan-private';
        }
        if (isLinkLocalIpv4(octets)) {
            return 'link-local';
        }
        return 'public';
    }
    if (text.includes(':')) {
        // IPv6: only loopback / unspecified are non-public here;
        // anything else is treated as public unless it is a
        // unique-local address (fc00::/7).
        if (/^f[cd][0-9a-f]{2}:/.test(text)) {
            return 'lan-private';
        }
        return 'public';
    }
    // A bare hostname that is not a tailnet name and not localhost
    // resolves on the public DNS by default: treat as public.
    return 'public';
}

/**
 * Classify a bind address such as "0.0.0.0", "127.0.0.1", or
 * "100.64.0.1:8001" (an optional :port suffix is ignored).
 */
export function classifyBindAddress(bindAddress) {
    const text = cleanString(bindAddress);
    if (!text) {
        return 'invalid';
    }
    let host = text;
    if (text.startsWith('[')) {
        const close = text.indexOf(']');
        host = close >= 0 ? text.slice(0, close + 1) : text;
    } else if ((text.match(/:/g) || []).length === 1) {
        host = text.slice(0, text.indexOf(':'));
    }
    return classifyHost(host);
}

/** True when a host/address class is reachable only locally or over the tailnet/LAN. */
export function isPrivateClass(addressClass) {
    return addressClass === 'loopback'
        || addressClass === 'tailnet'
        || addressClass === 'lan-private'
        || addressClass === 'link-local';
}

/**
 * Validate and normalize one endpoint URL.
 * Returns { ok, url, error, hostClass } — url is null when not ok.
 * Rejects: empty/non-string, unparseable, non-http(s) schemes,
 * credentials embedded in the URL, and (unless allowPublic) any
 * endpoint whose host classifies as public or wildcard.
 */
export function validateEndpointUrl(rawUrl, options = {}) {
    const allowPublic = Boolean(options.allowPublic);
    const text = cleanString(rawUrl);
    if (!text) {
        return { ok: false, url: null, error: 'endpoint is empty', hostClass: 'invalid' };
    }
    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        return { ok: false, url: null, error: 'endpoint is not a valid URL', hostClass: 'invalid' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, url: null, error: `endpoint scheme must be http or https (got ${parsed.protocol})`, hostClass: 'invalid' };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, url: null, error: 'endpoint URL must not embed credentials', hostClass: classifyHost(parsed.hostname) };
    }
    const hostClass = classifyHost(parsed.hostname);
    if (hostClass === 'invalid') {
        return { ok: false, url: null, error: 'endpoint host is invalid', hostClass };
    }
    if (!allowPublic && (hostClass === 'public' || hostClass === 'wildcard')) {
        return { ok: false, url: null, error: `endpoint host is ${hostClass}; public endpoints require explicit opt-in`, hostClass };
    }
    parsed.hash = '';
    const normalized = parsed.toString().replace(/\/+$/, '');
    return { ok: true, url: normalized, error: null, hostClass };
}

/** Normalize an endpoint URL, or return '' when it does not validate. */
export function normalizeEndpointUrl(rawUrl, options = {}) {
    const result = validateEndpointUrl(rawUrl, options);
    return result.ok ? result.url : '';
}

/** Strip credentials and secret-looking query values from a URL string for display. */
export function stripUrlSecrets(rawUrl) {
    const text = cleanString(rawUrl);
    if (!text) {
        return '';
    }
    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        return redactSecrets(text);
    }
    parsed.username = '';
    parsed.password = '';
    for (const key of [...parsed.searchParams.keys()]) {
        if (SECRET_KEY_PATTERN.test(key)) {
            parsed.searchParams.set(key, 'REDACTED');
        }
    }
    return parsed.toString();
}

/** Redact secret-looking substrings from free text. */
export function redactSecrets(text) {
    if (typeof text !== 'string') {
        return '';
    }
    return text.replace(BEARER_PATTERN, 'Bearer REDACTED').replace(KEY_VALUE_SECRET_PATTERN, '$1=REDACTED');
}

/**
 * Audit one service endpoint config.
 * Config shape: { url } or { bindAddress } (either or both),
 * plus opt-in flags { allowPublic, allowWildcardBind }.
 * Returns { serviceId, verdict, hostClass, reasons[] }.
 */
export function auditEndpoint(serviceId, config = {}) {
    const reasons = [];
    const cfg = config && typeof config === 'object' ? config : {};
    const url = cleanString(cfg.url ?? cfg.endpoint);
    const bindAddress = cleanString(cfg.bindAddress ?? cfg.bind);
    if (!url && !bindAddress) {
        return { serviceId, verdict: 'unconfigured', hostClass: 'invalid', reasons: ['no endpoint configured'] };
    }

    let verdict = 'ok';
    let hostClass = 'invalid';
    const raise = (next) => {
        if (next === 'violation' || verdict !== 'violation') {
            verdict = next;
        }
    };

    if (url) {
        const checked = validateEndpointUrl(url, { allowPublic: true });
        hostClass = checked.hostClass;
        let parsed = null;
        try {
            parsed = new URL(url);
        } catch {
            parsed = null;
        }
        if (parsed && (parsed.username || parsed.password)) {
            reasons.push('endpoint URL embeds credentials');
            raise('violation');
        } else if (!checked.ok) {
            reasons.push(checked.error);
            raise('violation');
        } else if (checked.hostClass === 'public' || checked.hostClass === 'wildcard') {
            if (cfg.allowPublic) {
                reasons.push('public endpoint allowed by explicit opt-in');
                raise('warning');
            } else {
                reasons.push('public endpoint without explicit opt-in');
                raise('violation');
            }
        } else if (checked.hostClass === 'lan-private' || checked.hostClass === 'link-local') {
            reasons.push(`${checked.hostClass} endpoint: reachable on the local network, not tailnet-only`);
            raise('warning');
        }
    }

    if (bindAddress) {
        const bindClass = classifyBindAddress(bindAddress);
        if (hostClass === 'invalid') {
            hostClass = bindClass;
        }
        if (bindClass === 'invalid') {
            reasons.push('bind address is invalid');
            raise('violation');
        } else if (bindClass === 'wildcard') {
            if (cfg.allowWildcardBind) {
                reasons.push('wildcard bind allowed by explicit opt-in');
                raise('warning');
            } else {
                reasons.push('wildcard bind (0.0.0.0/::) without explicit opt-in');
                raise('violation');
            }
        } else if (bindClass === 'public') {
            if (cfg.allowPublic) {
                reasons.push('public bind allowed by explicit opt-in');
                raise('warning');
            } else {
                reasons.push('public bind without explicit opt-in');
                raise('violation');
            }
        } else if (bindClass === 'lan-private' || bindClass === 'link-local') {
            reasons.push(`${bindClass} bind: reachable on the local network, not tailnet-only`);
            if (verdict === 'ok') {
                raise('warning');
            }
        }
    }

    if (reasons.length === 0) {
        reasons.push(`${hostClass} endpoint: tailnet-only/loopback as required`);
    }
    return { serviceId, verdict, hostClass, reasons };
}

/**
 * Audit the full five-service endpoint set.
 * `configs` maps service id -> config (see auditEndpoint).
 * Returns { results, summary, compliant } where summary counts
 * each verdict and compliant is true only with zero violations.
 */
export function auditEndpoints(configs = {}) {
    const source = configs && typeof configs === 'object' ? configs : {};
    const results = SERVICE_IDS.map((id) => auditEndpoint(id, source[id] ?? {}));
    const summary = { ok: 0, warning: 0, violation: 0, unconfigured: 0, total: results.length };
    for (const result of results) {
        summary[result.verdict] += 1;
    }
    return { results, summary, compliant: summary.violation === 0 };
}

/**
 * Build a diagnostics-panel-safe report from an audit: service
 * ids, verdicts, host classes, and reasons, with any secret-
 * looking text redacted and endpoint URLs stripped of
 * credentials and secret query values.
 */
export function buildHardeningReport(configs = {}, audit = null) {
    const source = configs && typeof configs === 'object' ? configs : {};
    const effectiveAudit = audit ?? auditEndpoints(source);
    const services = effectiveAudit.results.map((result) => {
        const cfg = source[result.serviceId] ?? {};
        const rawUrl = cleanString(cfg.url ?? cfg.endpoint);
        return {
            serviceId: result.serviceId,
            verdict: result.verdict,
            hostClass: result.hostClass,
            endpoint: rawUrl ? stripUrlSecrets(rawUrl) : '',
            reasons: result.reasons.map((reason) => redactSecrets(reason)),
        };
    });
    return {
        compliant: effectiveAudit.compliant,
        summary: { ...effectiveAudit.summary },
        services,
    };
}
