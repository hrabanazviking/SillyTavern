/**
 * Global integration status/settings panel core (RFST-018).
 *
 * Roadmap evidence required (section 14): "All service endpoints
 * and states usable centrally." Section 13 (Phase 8) defines a
 * single global settings panel with these sections:
 *   - Connection status: Gufo / AllTalk / STT / ComfyUI /
 *     Second Brain.
 *   - Service endpoints: one machine-wide URL per service, test
 *     connection, save.
 *   - Conversation: text-only, text+voice, push-to-talk,
 *     hands-free (optional).
 *   - Audio: default voice, narrator behavior, interruption,
 *     playback.
 *   - Images: auto model selection, manual workflow override,
 *     generation trigger, idle unload.
 *   - Knowledge: ONE global enabled toggle, retrieval relevance
 *     and token budget. No per-character collection controls.
 *   - Diagnostics: last error, current state, simple copyable
 *     local debug report with secrets stripped.
 *
 * UX invariants (section 13):
 *   - Newly imported characters work immediately with the global
 *     configuration (settings are global only; there are no
 *     per-character keys anywhere in this core).
 *   - Service failures never hide chat messages or disable the
 *     typing interface (panel state is advisory only).
 *
 * This dependency-free core provides: the five-service registry,
 * endpoint validation/normalization, the connection-status model
 * with aggregation and stale/error retention, global settings
 * with defaults and migration from partial/older objects, and
 * the secrets-stripped diagnostics report builder. No live
 * service is contacted by this core; connection checks are
 * injected by the caller (a real probe in production, a mock in
 * tests), exactly as RFST-013..017 injected their clients.
 *
 * The live Windows UI panel is GATED on the F15 UI host (see
 * campaign/PROGRESS.md); this core is the panel's logic.
 */

export const SERVICES = Object.freeze([
    Object.freeze({ id: 'gufo', label: 'Gufo', description: 'Primary text inference service.' }),
    Object.freeze({ id: 'alltalk', label: 'AllTalk', description: 'Text-to-speech service.' }),
    Object.freeze({ id: 'stt', label: 'STT', description: 'Speech-to-text service.' }),
    Object.freeze({ id: 'comfyui', label: 'ComfyUI', description: 'Image generation service.' }),
    Object.freeze({ id: 'second-brain', label: 'Second Brain', description: 'Read-only knowledge retrieval gateway.' }),
]);

export const SERVICE_IDS = Object.freeze(SERVICES.map((service) => service.id));

export const CONNECTION_STATES = Object.freeze([
    'unknown',
    'checking',
    'ok',
    'degraded',
    'down',
    'unconfigured',
]);

export const CONVERSATION_MODES = Object.freeze([
    'text-only',
    'text+voice',
    'push-to-talk',
    'hands-free',
]);

export const IMAGE_TRIGGERS = Object.freeze(['manual', 'auto', 'suggest']);

export const DEFAULT_SETTINGS = Object.freeze({
    endpoints: Object.freeze({
        gufo: '',
        alltalk: '',
        stt: '',
        comfyui: '',
        'second-brain': '',
    }),
    conversation: Object.freeze({
        mode: 'text+voice',
    }),
    audio: Object.freeze({
        defaultVoice: '',
        narratorEnabled: true,
        allowInterruption: true,
        autoplay: true,
        volume: 1,
    }),
    images: Object.freeze({
        autoModelSelection: true,
        manualWorkflowOverride: '',
        generationTrigger: 'manual',
        idleUnloadEnabled: true,
        idleUnloadMinutes: 10,
    }),
    knowledge: Object.freeze({
        enabled: true,
        relevanceThreshold: 0.35,
        tokenBudget: 1500,
    }),
});

const SECRET_KEY_PATTERN = /token|secret|password|passwd|api[-_]?key|authorization|credential/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE_SECRET_PATTERN = /\b(token|secret|password|passwd|api[-_]?key|authorization)\s*[:=]\s*\S+/gi;

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function clampNumber(value, min, max, fallback) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function pickBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function pickString(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}

/**
 * Validates and normalizes one service endpoint URL.
 * Rules: empty means unconfigured (valid, normalized to '');
 * otherwise the value must be an absolute http(s) URL with no
 * embedded credentials. Normalization trims whitespace and
 * strips trailing slashes from the path.
 * @param {*} value Candidate endpoint
 * @returns {{ok: boolean, url: string, error: string|null}}
 */
export function validateEndpoint(value) {
    const raw = cleanString(value);
    if (!raw) {
        return { ok: true, url: '', error: null };
    }
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        return { ok: false, url: '', error: 'invalid_url' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, url: '', error: 'unsupported_protocol' };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, url: '', error: 'embedded_credentials' };
    }
    if (!parsed.hostname) {
        return { ok: false, url: '', error: 'missing_host' };
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.hash = '';
    return { ok: true, url: parsed.toString().replace(/\/$/, parsed.pathname ? '' : ''), error: null };
}

/**
 * Normalizes an endpoint or returns '' when invalid.
 * @param {*} value Candidate endpoint
 * @returns {string} Normalized URL or ''
 */
export function normalizeEndpoint(value) {
    const result = validateEndpoint(value);
    return result.ok ? result.url : '';
}

function normalizeEndpoints(input) {
    const endpoints = {};
    const source = isPlainObject(input) ? input : {};
    for (const id of SERVICE_IDS) {
        endpoints[id] = normalizeEndpoint(source[id]);
    }
    return endpoints;
}

/**
 * Builds a complete settings object from defaults.
 * @returns {object} Deep copy of DEFAULT_SETTINGS
 */
export function createDefaultSettings() {
    return {
        endpoints: { ...DEFAULT_SETTINGS.endpoints },
        conversation: { ...DEFAULT_SETTINGS.conversation },
        audio: { ...DEFAULT_SETTINGS.audio },
        images: { ...DEFAULT_SETTINGS.images },
        knowledge: { ...DEFAULT_SETTINGS.knowledge },
    };
}

/**
 * Migrates a partial or older settings object into the current
 * shape: known sections are filled from defaults, values are
 * type-checked and clamped, unknown keys are dropped, and
 * endpoints are validated/normalized (invalid ones become '').
 * Settings are global only: any per-character-shaped input is
 * ignored, never carried through.
 * @param {*} input Partial/older settings (or anything)
 * @returns {object} Complete, valid settings object
 */
export function migrateSettings(input) {
    const source = isPlainObject(input) ? input : {};
    const settings = createDefaultSettings();
    settings.endpoints = normalizeEndpoints(source.endpoints);

    const conversation = isPlainObject(source.conversation) ? source.conversation : {};
    if (CONVERSATION_MODES.includes(conversation.mode)) {
        settings.conversation.mode = conversation.mode;
    }

    const audio = isPlainObject(source.audio) ? source.audio : {};
    settings.audio.defaultVoice = pickString(audio.defaultVoice, settings.audio.defaultVoice);
    settings.audio.narratorEnabled = pickBoolean(audio.narratorEnabled, settings.audio.narratorEnabled);
    settings.audio.allowInterruption = pickBoolean(audio.allowInterruption, settings.audio.allowInterruption);
    settings.audio.autoplay = pickBoolean(audio.autoplay, settings.audio.autoplay);
    settings.audio.volume = clampNumber(audio.volume, 0, 1, settings.audio.volume);

    const images = isPlainObject(source.images) ? source.images : {};
    settings.images.autoModelSelection = pickBoolean(images.autoModelSelection, settings.images.autoModelSelection);
    settings.images.manualWorkflowOverride = pickString(images.manualWorkflowOverride, settings.images.manualWorkflowOverride);
    if (IMAGE_TRIGGERS.includes(images.generationTrigger)) {
        settings.images.generationTrigger = images.generationTrigger;
    }
    settings.images.idleUnloadEnabled = pickBoolean(images.idleUnloadEnabled, settings.images.idleUnloadEnabled);
    settings.images.idleUnloadMinutes = clampNumber(images.idleUnloadMinutes, 0, 240, settings.images.idleUnloadMinutes);

    const knowledge = isPlainObject(source.knowledge) ? source.knowledge : {};
    settings.knowledge.enabled = pickBoolean(knowledge.enabled, settings.knowledge.enabled);
    settings.knowledge.relevanceThreshold = clampNumber(knowledge.relevanceThreshold, 0, 1, settings.knowledge.relevanceThreshold);
    settings.knowledge.tokenBudget = Math.floor(clampNumber(knowledge.tokenBudget, 0, 100000, settings.knowledge.tokenBudget));

    return settings;
}

/** Alias matching the naming used by earlier cores. */
export const normalizeSettings = migrateSettings;

/**
 * True when an object carries any per-character-shaped key.
 * The panel's settings are global only (section 13 invariant),
 * so callers can assert imported data stays global.
 * @param {*} value Object to inspect
 * @returns {boolean}
 */
export function hasPerCharacterKeys(value) {
    if (!isPlainObject(value)) {
        return false;
    }
    return Object.keys(value).some((key) => /character|persona|per[-_]?char/i.test(key));
}

/**
 * Removes secrets from free text: credential-bearing values
 * after known secret keys, and Bearer tokens.
 * @param {*} text Text to redact
 * @returns {string} Redacted text
 */
export function redactSecrets(text) {
    if (typeof text !== 'string') {
        return '';
    }
    return text
        .replace(BEARER_PATTERN, 'Bearer [redacted]')
        .replace(KEY_VALUE_SECRET_PATTERN, '$1=[redacted]');
}

/**
 * Strips secrets from a URL for display/reporting: userinfo is
 * removed and secret-looking query parameters are redacted.
 * @param {*} value URL string
 * @returns {string} Safe URL (or '' when unparseable/empty)
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
        return redactSecrets(raw);
    }
}

function freshServiceStatus(endpoint) {
    return {
        state: endpoint ? 'unknown' : 'unconfigured',
        endpoint,
        lastError: null,
        lastCheckedAt: null,
        lastOkAt: null,
        detail: '',
    };
}

/**
 * Aggregates per-service states into one overall status.
 * Precedence: any down -> 'down'; any degraded -> 'degraded';
 * any checking -> 'checking'; all ok -> 'ok'; all unconfigured
 * -> 'unconfigured'; otherwise 'unknown' (a mix of ok and
 * unconfigured/unknown services is usable but not fully known).
 * @param {object} statuses Map of service id -> status record
 * @returns {string} One of CONNECTION_STATES
 */
export function aggregateStatus(statuses) {
    const states = SERVICE_IDS.map((id) => (statuses && statuses[id] ? statuses[id].state : 'unconfigured'));
    if (states.every((state) => state === 'unconfigured')) {
        return 'unconfigured';
    }
    if (states.some((state) => state === 'down')) {
        return 'down';
    }
    if (states.some((state) => state === 'degraded')) {
        return 'degraded';
    }
    if (states.some((state) => state === 'checking')) {
        return 'checking';
    }
    if (states.every((state) => state === 'ok' || state === 'unconfigured')) {
        return states.some((state) => state === 'ok') ? 'ok' : 'unknown';
    }
    return 'unknown';
}

/**
 * Creates the integration panel model: settings plus the
 * connection-status model for the five services.
 * @param {object} [options] { settings, now } - now is an
 * injected clock (defaults to Date.now) for deterministic tests.
 * @returns {object} Panel API
 */
export function createIntegrationPanel(options = {}) {
    const now = isPlainObject(options) && typeof options.now === 'function' ? options.now : () => Date.now();
    let settings = migrateSettings(isPlainObject(options) ? options.settings : undefined);
    const statuses = {};
    for (const id of SERVICE_IDS) {
        statuses[id] = freshServiceStatus(settings.endpoints[id]);
    }

    function requireService(serviceId) {
        if (!SERVICE_IDS.includes(serviceId)) {
            throw new Error(`unknown_service:${serviceId}`);
        }
    }

    function getSettings() {
        return structuredClone(settings);
    }

    function updateSettings(patch) {
        const merged = isPlainObject(patch) ? { ...settings, ...patch } : settings;
        settings = migrateSettings(merged);
        for (const id of SERVICE_IDS) {
            const endpoint = settings.endpoints[id];
            if (endpoint !== statuses[id].endpoint) {
                statuses[id] = freshServiceStatus(endpoint);
            }
        }
        return getSettings();
    }

    function setEndpoint(serviceId, value) {
        requireService(serviceId);
        const result = validateEndpoint(value);
        if (!result.ok) {
            return { ok: false, error: result.error, url: statuses[serviceId].endpoint };
        }
        settings = migrateSettings({ ...settings, endpoints: { ...settings.endpoints, [serviceId]: result.url } });
        statuses[serviceId] = freshServiceStatus(result.url);
        return { ok: true, error: null, url: result.url };
    }

    function getServiceStatus(serviceId) {
        requireService(serviceId);
        return { ...statuses[serviceId] };
    }

    function getAllStatuses() {
        const snapshot = {};
        for (const id of SERVICE_IDS) {
            snapshot[id] = { ...statuses[id] };
        }
        return snapshot;
    }

    function beginCheck(serviceId) {
        requireService(serviceId);
        if (!statuses[serviceId].endpoint) {
            statuses[serviceId].state = 'unconfigured';
            return getServiceStatus(serviceId);
        }
        statuses[serviceId].state = 'checking';
        return getServiceStatus(serviceId);
    }

    /**
     * Records the outcome of a connection check. A failure keeps
     * the previous lastOkAt and stores the (redacted) error, so
     * the panel shows stale state plus the last error instead of
     * forgetting either (section 13 diagnostics).
     */
    function recordCheckResult(serviceId, result = {}) {
        requireService(serviceId);
        const status = statuses[serviceId];
        if (!status.endpoint) {
            status.state = 'unconfigured';
            return getServiceStatus(serviceId);
        }
        const checkedAt = now();
        status.lastCheckedAt = checkedAt;
        if (result && result.ok) {
            status.state = result.degraded ? 'degraded' : 'ok';
            status.lastOkAt = checkedAt;
            status.lastError = null;
            status.detail = cleanString(result.detail);
        } else {
            status.state = 'down';
            const message = result && result.error instanceof Error
                ? result.error.message
                : cleanString(result && result.error) || 'check_failed';
            status.lastError = redactSecrets(message);
            status.detail = cleanString(result && result.detail);
        }
        return getServiceStatus(serviceId);
    }

    function overallStatus() {
        return aggregateStatus(statuses);
    }

    /**
     * Section 13 invariant: panel state is advisory. Chat is
     * available no matter which services are down or
     * unconfigured; only the features of a failed service are
     * affected, never the typing interface.
     */
    function isChatAvailable() {
        return true;
    }

    function featureAvailability() {
        return {
            chat: true,
            voicePlayback: statuses.alltalk.state === 'ok' || statuses.alltalk.state === 'degraded',
            speechInput: statuses.stt.state === 'ok' || statuses.stt.state === 'degraded',
            images: statuses.comfyui.state === 'ok' || statuses.comfyui.state === 'degraded',
            knowledge: settings.knowledge.enabled
                && (statuses['second-brain'].state === 'ok' || statuses['second-brain'].state === 'degraded'),
        };
    }

    /**
     * Builds the copyable local debug report (section 13):
     * service states, endpoints with secrets stripped, last
     * errors (redacted), and the non-secret global settings.
     * No token, password, or credential-bearing URL can appear.
     */
    function buildDiagnosticsReport() {
        const lines = [];
        lines.push('RuneForgeAI integration diagnostics');
        lines.push(`Overall status: ${overallStatus()}`);
        lines.push(`Conversation mode: ${settings.conversation.mode}`);
        lines.push(`Knowledge enabled: ${settings.knowledge.enabled} (relevance ${settings.knowledge.relevanceThreshold}, token budget ${settings.knowledge.tokenBudget})`);
        lines.push('Services:');
        for (const service of SERVICES) {
            const status = statuses[service.id];
            const endpoint = status.endpoint ? stripUrlSecrets(status.endpoint) : '(not configured)';
            lines.push(`- ${service.label} [${service.id}]: ${status.state} endpoint=${endpoint}`);
            if (status.lastCheckedAt !== null) {
                lines.push(`  lastCheckedAt: ${new Date(status.lastCheckedAt).toISOString()}`);
            }
            if (status.lastOkAt !== null) {
                lines.push(`  lastOkAt: ${new Date(status.lastOkAt).toISOString()}`);
            }
            if (status.lastError) {
                lines.push(`  lastError: ${redactSecrets(status.lastError)}`);
            }
            if (status.detail) {
                lines.push(`  detail: ${redactSecrets(status.detail)}`);
            }
        }
        return lines.join('\n');
    }

    return {
        getSettings,
        updateSettings,
        setEndpoint,
        getServiceStatus,
        getAllStatuses,
        beginCheck,
        recordCheckResult,
        overallStatus,
        isChatAvailable,
        featureAvailability,
        buildDiagnosticsReport,
    };
}
