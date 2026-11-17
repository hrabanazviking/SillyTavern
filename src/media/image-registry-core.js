/**
 * Image model/workflow registry with scoring (RFST-014).
 *
 * Roadmap evidence required (section 14): "Reviewed local registry
 * with scoring." Section 10 asks for: an inventory of actual
 * checkpoints, LoRAs, VAEs, CLIP encoders and custom nodes in the
 * owner's model vault (without committing models to Git), private
 * benchmark scoring on anatomy, identity continuity, prompt
 * fidelity, runtime, memory use and artifact rate, and a
 * manifest/registry for installed workflow+model combinations
 * that RFST-015's router can select from (with manual override).
 *
 * This dependency-free core is that registry. It was REVIEWED
 * against a read-only inventory taken 2026-11-17 (see
 * campaign/PROGRESS.md): the two ComfyUI workflows bundled with
 * SillyTavern, plus the model files present in the ComfyUI vault
 * on the Z13 (the install's own models/ tree holds only
 * placeholders; the real files live in the vault referenced by
 * its extra_model_paths config). Entries carry names, sizes and
 * metadata ONLY - never model assets, never file contents.
 *
 * Honesty rules, enforced by the shape of the data:
 *  - Every benchmark dimension starts null (unknown). No score
 *    in this module ever invents a benchmark number: unknown
 *    dimensions contribute nothing and are reported by name.
 *  - Model family labels are a name-and-size heuristic, marked
 *    as such on every entry (familyBasis), not a file probe.
 *  - Live benchmarking needs a running ComfyUI; it was NOT
 *    running at inventory time and was not started, so the
 *    benchmark leg is GATED (campaign/PROGRESS.md), exactly as
 *    RFST-013 gated its live leg.
 *
 * Scoring is a pure deterministic function of the entry: the
 * same entry always scores the same, and ranking ties break on
 * priority then id, so RFST-015 routing is reproducible.
 */

export const IMAGE_CATEGORIES = Object.freeze([
    'portrait',
    'full-body',
    'environment',
    'illustration',
    'scene-continuation',
    'image-editing',
]);

export const MODEL_KINDS = Object.freeze([
    'checkpoint',
    'diffusion-model',
    'lora',
    'vae',
    'text-encoder',
    'clip-vision',
    'controlnet',
    'upscale-model',
    'embedding',
]);

export const ENTRY_KINDS = Object.freeze(['workflow', ...MODEL_KINDS]);

export const AVAILABILITY = Object.freeze(['bundled', 'installed', 'missing', 'unknown']);

export const BENCHMARK_DIMENSIONS = Object.freeze([
    'anatomy',
    'identityContinuity',
    'promptFidelity',
    'runtimeMs',
    'memoryMb',
    'artifactRate',
]);

const QUALITY_DIMENSIONS = Object.freeze(['anatomy', 'identityContinuity', 'promptFidelity']);
const KNOWN_EXTERNAL_NODES = Object.freeze(['ETN_LoadImageBase64']);

/**
 * Returns an all-unknown benchmark record.
 * @returns {object} Benchmark dimensions, every value null
 */
export function emptyBenchmarks() {
    return {
        anatomy: null,
        identityContinuity: null,
        promptFidelity: null,
        runtimeMs: null,
        memoryMb: null,
        artifactRate: null,
    };
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates one registry entry.
 * @param {object} entry Registry entry
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
export function validateEntry(entry) {
    const errors = [];
    if (!isPlainObject(entry)) {
        return { valid: false, errors: ['entry is not an object'] };
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
        errors.push('id must be a non-empty string');
    }
    if (!ENTRY_KINDS.includes(entry.kind)) {
        errors.push('kind must be one of: ' + ENTRY_KINDS.join(', '));
    }
    if (!AVAILABILITY.includes(entry.availability)) {
        errors.push('availability must be one of: ' + AVAILABILITY.join(', '));
    }
    if (!Array.isArray(entry.categories) || entry.categories.length === 0) {
        errors.push('categories must be a non-empty array');
    } else {
        for (const category of entry.categories) {
            if (!IMAGE_CATEGORIES.includes(category)) {
                errors.push('unknown category: ' + String(category));
            }
        }
    }
    if (entry.priority !== undefined && (!Number.isFinite(entry.priority) || entry.priority < 0 || entry.priority > 100)) {
        errors.push('priority must be a number in 0..100');
    }
    if (entry.sizeBytes !== undefined && entry.sizeBytes !== null && (!Number.isFinite(entry.sizeBytes) || entry.sizeBytes < 0)) {
        errors.push('sizeBytes must be null or a non-negative number');
    }
    if (entry.benchmarks !== undefined) {
        if (!isPlainObject(entry.benchmarks)) {
            errors.push('benchmarks must be an object');
        } else {
            for (const dimension of BENCHMARK_DIMENSIONS) {
                const value = entry.benchmarks[dimension];
                if (value === undefined || value === null) {
                    continue;
                }
                if (!Number.isFinite(value) || value < 0) {
                    errors.push('benchmark ' + dimension + ' must be null or a non-negative number');
                } else if (dimension !== 'runtimeMs' && dimension !== 'memoryMb' && value > 1) {
                    errors.push('benchmark ' + dimension + ' must be in 0..1');
                }
            }
        }
    }
    return { valid: errors.length === 0, errors };
}

/**
 * Validates a whole registry: every entry valid, ids unique.
 * @param {object[]} entries Registry entries
 * @returns {{ valid: boolean, errors: string[] }} Validation result
 */
export function validateRegistry(entries) {
    const errors = [];
    if (!Array.isArray(entries)) {
        return { valid: false, errors: ['registry is not an array'] };
    }
    const seen = new Set();
    entries.forEach((entry, index) => {
        const result = validateEntry(entry);
        for (const error of result.errors) {
            errors.push('entry[' + index + ']: ' + error);
        }
        if (entry && typeof entry.id === 'string') {
            if (seen.has(entry.id)) {
                errors.push('duplicate id: ' + entry.id);
            }
            seen.add(entry.id);
        }
    });
    return { valid: errors.length === 0, errors };
}

/**
 * Analyses a ComfyUI workflow JSON value structurally: API format
 * detection, node inventory, placeholder list, external-node needs.
 * Pure inspection - the workflow is never executed.
 * @param {*} workflow Parsed workflow JSON
 * @returns {object} Structural analysis
 */
export function analyzeWorkflow(workflow) {
    const analysis = {
        apiFormat: false,
        nodeCount: 0,
        classTypes: [],
        placeholders: [],
        externalNodes: [],
        hasKSampler: false,
        hasSaveImage: false,
        hasCheckpointLoader: false,
    };
    if (!isPlainObject(workflow)) {
        return analysis;
    }
    const classTypes = new Set();
    const placeholders = new Set();
    const collectStrings = (value) => {
        if (typeof value === 'string') {
            const matches = value.match(/%[a-z_]+%/gi);
            if (matches) {
                matches.forEach((match) => placeholders.add(match));
            }
        } else if (Array.isArray(value)) {
            value.forEach(collectStrings);
        } else if (isPlainObject(value)) {
            Object.values(value).forEach(collectStrings);
        }
    };
    let apiNodes = 0;
    for (const node of Object.values(workflow)) {
        if (isPlainObject(node) && typeof node.class_type === 'string') {
            apiNodes++;
            classTypes.add(node.class_type);
            collectStrings(node.inputs || {});
        }
    }
    analysis.apiFormat = apiNodes > 0;
    analysis.nodeCount = apiNodes;
    analysis.classTypes = [...classTypes].sort();
    analysis.placeholders = [...placeholders].sort();
    analysis.externalNodes = analysis.classTypes.filter((type) => KNOWN_EXTERNAL_NODES.includes(type));
    analysis.hasKSampler = classTypes.has('KSampler');
    analysis.hasSaveImage = classTypes.has('SaveImage');
    analysis.hasCheckpointLoader = classTypes.has('CheckpointLoaderSimple');
    return analysis;
}

/**
 * Builds a model registry entry from one discovered inventory row
 * (name/metadata only - the model file itself is never read).
 * @param {object} row Inventory row { id, fileName, kind, family, sizeBytes, tags }
 * @returns {object} Registry entry with all-unknown benchmarks
 */
export function buildModelEntry(row) {
    const categories = row.kind === 'lora' || row.kind === 'vae' || row.kind === 'text-encoder'
        ? ['portrait', 'full-body', 'scene-continuation']
        : ['portrait', 'full-body', 'environment', 'illustration', 'scene-continuation'];
    return {
        id: row.id,
        kind: row.kind,
        label: row.fileName,
        source: 'comfyui-vault',
        availability: 'installed',
        categories,
        tags: [...(row.tags || [])],
        priority: 50,
        modelId: row.fileName,
        workflowFile: null,
        family: row.family || 'unknown',
        familyBasis: 'name-and-size-heuristic',
        sizeBytes: Number.isFinite(row.sizeBytes) ? row.sizeBytes : null,
        license: 'unknown',
        benchmarks: emptyBenchmarks(),
    };
}

// Reviewed inventory, read-only probe 2026-11-17 (names + sizes
// only): [id, fileName, kind, family, sizeBytes, tags].
const INVENTORIED_MODELS = [
    ['babes-by-stable-yogi-pony-v65', 'Babes By Stable Yogi Pony V6.5 CIV FP16.safetensors', 'checkpoint', 'pony-sdxl', 6938040992, ['photoreal', 'pony']],
    ['babes-illustrious-by-v55', 'babesIllustriousBy_v55FP16.safetensors', 'checkpoint', 'illustrious-sdxl', 6938041712, ['photoreal', 'illustrious']],
    ['cyberrealistic-final-fp16', 'CyberRealistic_FINAL_FP16.safetensors', 'checkpoint', 'sd15', 2132651162, ['photoreal', 'sd15']],
    ['epicrealism-naturalsin', 'epiCRealism-naturalSin.safetensors', 'checkpoint', 'sd15', 2132625644, ['photoreal', 'sd15']],
    ['juggernautxl-ragnarok', 'juggernautXL_ragnarok.safetensors', 'checkpoint', 'sdxl', 7105350162, ['photoreal', 'sdxl', 'baked-vae']],
    ['lustify-v9-final-sdxl', 'lustify_v9_finalsdxl_.safetensors', 'checkpoint', 'sdxl', 6938143490, ['photoreal', 'sdxl']],
    ['ponyrealism-v22-mainvae', 'ponyRealism_v22MainVAE.safetensors', 'checkpoint', 'pony-sdxl', 7105348856, ['photoreal', 'pony', 'baked-vae']],
    ['realism-by-stable-yogi-illustrious-v55', 'Realism By Stable Yogi Illustrious V5.5 CIV FP16.safetensors', 'checkpoint', 'illustrious-sdxl', 6938040960, ['photoreal', 'illustrious']],
    ['realism-by-stable-yogi-pony-v65', 'Realism By Stable Yogi Pony V6.5 CIV FP16.safetensors', 'checkpoint', 'pony-sdxl', 6938040992, ['photoreal', 'pony']],
    ['realistic-vision-v60-nv-b1-fp16', 'Realistic_Vision_V6.0_NV_B1_fp16.safetensors', 'checkpoint', 'sd15', 2132625894, ['photoreal', 'sd15']],
    ['realistic-vision-v60-nv-b1', 'Realistic_Vision_V6.0_NV_B1.safetensors', 'checkpoint', 'sd15', 4265146304, ['photoreal', 'sd15']],
    ['realvisxl-v50-fp16', 'RealVisXL_V5.0_fp16.safetensors', 'checkpoint', 'sdxl', 6938065488, ['photoreal', 'sdxl']],
    ['ultra-realistic-by-stable-yogi-illus-v25', 'Ultra Realistic By Stable Yogi ILLUS V2.5 CIV FP16.safetensors', 'checkpoint', 'illustrious-sdxl', 6938040682, ['photoreal', 'illustrious']],
    ['ultra-realistic-by-stable-yogi-pony-v25', 'Ultra Realistic By Stable Yogi PONY V2.5 CIV FP16 C77.safetensors', 'checkpoint', 'pony-sdxl', 6938040682, ['photoreal', 'pony']],
    ['v15-pruned-emaonly', 'v1-5-pruned-emaonly.safetensors', 'checkpoint', 'sd15', 4265146304, ['base', 'sd15']],
    ['chroma1-base', 'Chroma1-Base.safetensors', 'diffusion-model', 'chroma-flux', 17800038288, ['flux-family']],
    ['chroma1-hd-flash', 'Chroma1-HD-Flash.safetensors', 'diffusion-model', 'chroma-flux', 17800038288, ['flux-family']],
    ['chroma1-hd', 'Chroma1-HD.safetensors', 'diffusion-model', 'chroma-flux', 17800038288, ['flux-family']],
    ['flux1-dev', 'flux1-dev.safetensors', 'diffusion-model', 'flux', 23802932552, ['flux-family']],
    ['z-image-turbo-ultimate-unlock-v20', 'z_image_turbo_ultimate_unlock_v2.0_bf16.safetensors', 'diffusion-model', 'z-image', 12309876360, ['turbo']],
    ['chrxma-v2-lora', 'chrxma-v2.safetensors', 'lora', 'chroma-flux', 1862670376, ['lora']],
    ['flux-lustly-ai-v1-lora', 'flux_lustly-ai_v1.safetensors', 'lora', 'flux', 343805152, ['lora']],
    ['clip-l', 'clip_l.safetensors', 'text-encoder', 'clip', 246144152, ['clip']],
    ['qwen-3-4b', 'qwen_3_4b.safetensors', 'text-encoder', 'qwen', 8044982048, ['qwen']],
    ['t5xxl-fp16', 't5xxl_fp16.safetensors', 'text-encoder', 't5', 9787841024, ['t5']],
    ['ae-vae', 'ae.safetensors', 'vae', 'flux', 335304388, ['vae', 'flux-family']],
];

const BUNDLED_WORKFLOWS = [
    {
        id: 'bundled-default-txt2img',
        kind: 'workflow',
        label: 'Default_Comfy_Workflow.json',
        source: 'sillytavern-bundled',
        availability: 'bundled',
        categories: ['portrait', 'full-body', 'environment', 'illustration', 'scene-continuation'],
        tags: ['txt2img', 'general'],
        priority: 80,
        modelId: null,
        workflowFile: 'Default_Comfy_Workflow.json',
        family: 'checkpoint-placeholder',
        familyBasis: 'workflow-structure',
        sizeBytes: null,
        license: 'unknown',
        benchmarks: emptyBenchmarks(),
        structure: { nodeCount: 7, externalNodes: [] },
    },
    {
        id: 'bundled-char-avatar-img2img',
        kind: 'workflow',
        label: 'Char_Avatar_Comfy_Workflow.json',
        source: 'sillytavern-bundled',
        availability: 'bundled',
        categories: ['portrait', 'image-editing'],
        tags: ['img2img', 'avatar'],
        priority: 70,
        modelId: null,
        workflowFile: 'Char_Avatar_Comfy_Workflow.json',
        family: 'checkpoint-placeholder',
        familyBasis: 'workflow-structure',
        sizeBytes: null,
        license: 'unknown',
        benchmarks: emptyBenchmarks(),
        structure: { nodeCount: 9, externalNodes: ['ETN_LoadImageBase64'] },
        compatibilityNote: 'Requires the comfyui-tooling-nodes ETN_LoadImageBase64 node, which was NOT present in the installed custom_nodes at inventory time.',
    },
];

/**
 * The reviewed local registry: bundled workflows plus every model
 * found in the ComfyUI vault at inventory time. Frozen; callers
 * clone before adapting. Benchmarks are all unknown by design.
 */
export const DEFAULT_IMAGE_REGISTRY = Object.freeze([
    ...BUNDLED_WORKFLOWS.map((entry) => Object.freeze(entry)),
    ...INVENTORIED_MODELS.map(([id, fileName, kind, family, sizeBytes, tags]) => Object.freeze(buildModelEntry({ id, fileName, kind, family, sizeBytes, tags }))),
]);

/**
 * Scores one entry deterministically from KNOWN signals only:
 * availability (30), curated priority (20), benchmark coverage
 * (20) and measured benchmark quality (30, quality dimensions
 * plus 1 - artifactRate). Unknown dimensions score nothing and
 * are reported in unknownDimensions - never estimated.
 * @param {object} entry Registry entry
 * @returns {{ total: number, breakdown: object, scoredDimensions: string[], unknownDimensions: string[] }} Score
 */
export function scoreEntry(entry) {
    const benchmarks = isPlainObject(entry && entry.benchmarks) ? entry.benchmarks : {};
    const known = BENCHMARK_DIMENSIONS.filter((dimension) => Number.isFinite(benchmarks[dimension]));
    const unknownDimensions = BENCHMARK_DIMENSIONS.filter((dimension) => !known.includes(dimension));
    const availabilityPoints = entry.availability === 'installed' || entry.availability === 'bundled'
        ? 30
        : entry.availability === 'unknown' ? 10 : 0;
    const priority = Number.isFinite(entry.priority) ? entry.priority : 50;
    const priorityPoints = (priority / 100) * 20;
    const coveragePoints = (known.length / BENCHMARK_DIMENSIONS.length) * 20;
    const qualityValues = [];
    for (const dimension of QUALITY_DIMENSIONS) {
        if (Number.isFinite(benchmarks[dimension])) {
            qualityValues.push(benchmarks[dimension]);
        }
    }
    if (Number.isFinite(benchmarks.artifactRate)) {
        qualityValues.push(1 - benchmarks.artifactRate);
    }
    const qualityPoints = qualityValues.length > 0
        ? (qualityValues.reduce((sum, value) => sum + value, 0) / qualityValues.length) * 30
        : 0;
    const total = Math.round((availabilityPoints + priorityPoints + coveragePoints + qualityPoints) * 1000) / 1000;
    return {
        total,
        breakdown: { availability: availabilityPoints, priority: priorityPoints, coverage: coveragePoints, quality: qualityPoints },
        scoredDimensions: known,
        unknownDimensions,
    };
}

/**
 * Ranks entries for a request: filters by category/kind/tags,
 * scores each, sorts score desc, priority desc, id asc. Pure:
 * inputs are never mutated and repeated calls agree exactly.
 * @param {object[]} entries Registry entries
 * @param {object} [request] { category, kind, tags }
 * @returns {object[]} Ranked copies carrying a score field
 */
export function rankEntries(entries, request = {}) {
    const wantedTags = Array.isArray(request.tags) ? request.tags : [];
    return (Array.isArray(entries) ? entries : [])
        .filter((entry) => entry && (!request.category || (Array.isArray(entry.categories) && entry.categories.includes(request.category))))
        .filter((entry) => entry && (!request.kind || entry.kind === request.kind))
        .filter((entry) => entry && wantedTags.every((tag) => Array.isArray(entry.tags) && entry.tags.includes(tag)))
        .map((entry) => ({ ...entry, score: scoreEntry(entry) }))
        .sort((a, b) => (b.score.total - a.score.total)
            || ((b.priority || 0) - (a.priority || 0))
            || String(a.id).localeCompare(String(b.id)));
}

/**
 * Resolves a selection for RFST-015: a manual override wins when
 * it names a real, non-missing entry; otherwise the top automatic
 * ranking is the fallback and the reason says why. Never throws.
 * @param {object[]} entries Registry entries
 * @param {object} [request] { category, kind, tags, overrideId }
 * @returns {object} { ok, via, entry, reason, fallback }
 */
export function resolveSelection(entries, request = {}) {
    const ranked = rankEntries(entries, request);
    const fallback = ranked.length > 0 ? ranked[0] : null;
    if (request.overrideId) {
        const override = (Array.isArray(entries) ? entries : []).find((entry) => entry && entry.id === request.overrideId);
        if (!override) {
            return { ok: false, via: 'manual-override', entry: null, reason: 'override_not_found', fallback };
        }
        if (override.availability === 'missing') {
            return { ok: false, via: 'manual-override', entry: null, reason: 'override_unavailable', fallback };
        }
        return { ok: true, via: 'manual-override', entry: { ...override, score: scoreEntry(override) }, reason: 'override_applied', fallback };
    }
    if (!fallback) {
        return { ok: false, via: 'automatic', entry: null, reason: 'no_candidates', fallback: null };
    }
    return { ok: true, via: 'automatic', entry: fallback, reason: 'top_ranked', fallback };
}

/**
 * Summarises a registry: counts by kind, category and
 * availability, plus honest benchmark coverage.
 * @param {object[]} entries Registry entries
 * @returns {object} Summary counts
 */
export function registrySummary(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const byKind = {};
    const byAvailability = {};
    const byCategory = {};
    let benchmarkedEntries = 0;
    for (const entry of list) {
        byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
        byAvailability[entry.availability] = (byAvailability[entry.availability] || 0) + 1;
        for (const category of entry.categories || []) {
            byCategory[category] = (byCategory[category] || 0) + 1;
        }
        if (scoreEntry(entry).scoredDimensions.length > 0) {
            benchmarkedEntries++;
        }
    }
    return { total: list.length, byKind, byAvailability, byCategory, benchmarkedEntries, unbenchmarkedEntries: list.length - benchmarkedEntries };
}
