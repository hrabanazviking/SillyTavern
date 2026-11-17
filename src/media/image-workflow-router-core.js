/**
 * Automatic image workflow router (RFST-015).
 *
 * Roadmap evidence required (section 14): "Correct category
 * selection plus manual override." Section 10 asks for request
 * categorization and automatic workflow selection over the
 * RFST-014 registry, with a manual workflow override from one
 * global control, and visibility of the selected workflow/model.
 *
 * This dependency-free core builds ONLY on the RFST-014 registry
 * contracts (src/media/image-registry-core.js): its categories,
 * its scoring/ranking, and its resolveSelection seam. It does not
 * duplicate registry data or scoring. It classifies a free-form
 * image request into one registry category, selects the
 * best-scoring workflow (and best-scoring model) for that
 * category, and lets an explicit manual override - a named
 * entry, workflow, model, or category - always win over the
 * automatic choice when it names a real, available entry.
 *
 * Honesty / safety rules:
 *  - Unknown or ambiguous requests never throw and never invent
 *    a confident category: they fall back deterministically
 *    (top-ranked entry overall, via the registry ranking) and
 *    the result reports the fallback reason by name.
 *  - An override that names nothing real, or a missing entry,
 *    likewise falls back deterministically and reports why; a
 *    valid override always wins, even on a category mismatch
 *    (the mismatch is reported, not silently corrected).
 *  - Classification is a pure keyword/signal function of the
 *    request text and explicit fields: the same request always
 *    classifies and routes the same way.
 *
 * Live routing against a real ComfyUI is GATED: ComfyUI was not
 * started for this package (see campaign/PROGRESS.md), exactly
 * as RFST-013/014 gated their live legs. This core only selects;
 * it never dispatches a job.
 */

import {
    IMAGE_CATEGORIES,
    DEFAULT_IMAGE_REGISTRY,
    rankEntries,
    scoreEntry,
} from './image-registry-core.js';

export const FALLBACK_REASON_NO_SIGNAL = 'no_category_signals';
export const FALLBACK_REASON_AMBIGUOUS = 'ambiguous_category_signals';
export const FALLBACK_REASON_OVERRIDE_NOT_FOUND = 'override_not_found';
export const FALLBACK_REASON_OVERRIDE_UNAVAILABLE = 'override_unavailable';

const CATEGORY_SIGNALS = Object.freeze({
    'portrait': ['portrait', 'headshot', 'close-up', 'closeup', 'face', 'avatar', 'bust portrait', 'facial'],
    'full-body': ['full-body', 'full body', 'full length', 'whole body', 'standing pose', 'outfit', 'head to toe'],
    'environment': ['landscape', 'environment', 'scenery', 'background scene', 'cityscape', 'forest', 'mountains', 'interior scene', 'seascape'],
    'illustration': ['illustration', 'drawing', 'painting', 'anime', 'cartoon', 'sketch', 'comic', 'watercolor'],
    'scene-continuation': ['scene-continuation', 'continue the scene', 'continuation', 'next scene', 'extend the scene', 'following scene', 'sequel scene'],
    'image-editing': ['image-editing', 'img2img', 'inpaint', 'edit the image', 'edit this image', 'modify the image', 'retouch', 'transform the image', 'repaint'],
});

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requestText(request) {
    const parts = [];
    for (const field of ['prompt', 'text', 'description', 'subject']) {
        if (typeof request[field] === 'string') {
            parts.push(request[field]);
        }
    }
    if (Array.isArray(request.tags)) {
        parts.push(request.tags.filter((tag) => typeof tag === 'string').join(' '));
    }
    return parts.join(' ').toLowerCase();
}
/**
 * Classifies an image request into one registry category.
 * Explicit fields win: a valid request.category, then an
 * edit-with-source-image shape, then keyword scoring over the
 * request text, then aspect/orientation hints. No signal (or a
 * tie for first place) yields category null with a named reason
 * so the caller falls back deterministically.
 * @param {object} [request] Image request fields
 * @returns {object} { category, via, confidence, scores, signals, ambiguous, reason }
 */
export function classifyRequest(request = {}) {
    const safe = isPlainObject(request) ? request : {};
    if (typeof safe.category === 'string' && IMAGE_CATEGORIES.includes(safe.category)) {
        return { category: safe.category, via: 'explicit-category', confidence: 1, scores: {}, signals: ['explicit:' + safe.category], ambiguous: false, reason: 'explicit_category' };
    }
    const hasSource = safe.hasSourceImage === true || typeof safe.sourceImage === 'string';
    const text = requestText(safe);
    const scores = {};
    const signals = [];
    for (const [category, keywords] of Object.entries(CATEGORY_SIGNALS)) {
        let hits = 0;
        for (const keyword of keywords) {
            if (text.includes(keyword)) {
                hits++;
                signals.push(category + ':' + keyword);
            }
        }
        if (hits > 0) {
            scores[category] = hits;
        }
    }
    if (hasSource && (scores['image-editing'] || /\bedit|change|modify|retouch|transform\b/.test(text))) {
        return { category: 'image-editing', via: 'source-image-edit', confidence: 1, scores, signals: [...signals, 'structure:has-source-image'], ambiguous: false, reason: 'source_image_edit_intent' };
    }
    if (Object.keys(scores).length === 0) {
        if (safe.orientation === 'portrait' || safe.aspect === 'portrait') {
            return { category: 'portrait', via: 'orientation-hint', confidence: 0.5, scores, signals: ['orientation:portrait'], ambiguous: false, reason: 'orientation_hint' };
        }
        if (safe.orientation === 'landscape' || safe.aspect === 'landscape') {
            return { category: 'environment', via: 'orientation-hint', confidence: 0.5, scores, signals: ['orientation:landscape'], ambiguous: false, reason: 'orientation_hint' };
        }
        return { category: null, via: 'fallback', confidence: 0, scores, signals, ambiguous: false, reason: FALLBACK_REASON_NO_SIGNAL };
    }
    const ranked = Object.entries(scores).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
        return { category: null, via: 'fallback', confidence: 0, scores, signals, ambiguous: true, reason: FALLBACK_REASON_AMBIGUOUS };
    }
    return { category: ranked[0][0], via: 'keywords', confidence: Math.min(1, 0.5 + 0.25 * ranked[0][1]), scores, signals, ambiguous: false, reason: 'keyword_match' };
}

function overrideIdOf(request) {
    if (!isPlainObject(request)) {
        return null;
    }
    if (isPlainObject(request.override)) {
        return request.override.entryId || request.override.workflowId || request.override.modelId || request.override.id || null;
    }
    return request.overrideId || request.overrideEntryId || request.overrideWorkflowId || request.overrideModelId || null;
}

function overrideCategoryOf(request) {
    if (!isPlainObject(request)) {
        return null;
    }
    const value = isPlainObject(request.override) ? request.override.category : request.overrideCategory;
    return typeof value === 'string' && IMAGE_CATEGORIES.includes(value) ? value : null;
}

function findOverrideEntry(entries, overrideId) {
    return entries.find((entry) => entry && (entry.id === overrideId || entry.modelId === overrideId || entry.workflowFile === overrideId || entry.label === overrideId)) || null;
}

function topOfKind(entries, category, kind) {
    const ranked = rankEntries(entries, category ? { category, kind } : { kind });
    return ranked.length > 0 ? ranked[0] : null;
}
/**
 * Routes one image request: classify, then select the
 * best-scoring workflow and model for the category from the
 * registry. A manual override always wins when it names a
 * real, non-missing entry. Unknown/ambiguous requests fall
 * back to the top-ranked entry overall and say why. Never throws.
 * @param {object[]} [entries] Registry entries
 * @param {object} [request] Image request plus optional override fields
 * @returns {object} Route result
 */
export function routeRequest(entries = DEFAULT_IMAGE_REGISTRY, request = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const safe = isPlainObject(request) ? request : {};
    try {
        const classification = classifyRequest(safe);
        const overrideCategory = overrideCategoryOf(safe);
        const category = overrideCategory || classification.category;
        const effectiveClassification = overrideCategory ? { ...classification, category: overrideCategory, via: 'manual-override-category' } : classification;
        const automaticWorkflow = topOfKind(list, category, 'workflow');
        const isModelKind = (entry) => entry.kind === 'checkpoint' || entry.kind === 'diffusion-model';
        const automaticModel = category ? (rankEntries(list, { category }).find(isModelKind) || null) : (rankEntries(list, {}).find(isModelKind) || null);
        const automaticEntry = automaticWorkflow || automaticModel;
        const fallback = automaticEntry ? { entry: automaticEntry, workflow: automaticWorkflow, model: automaticModel, category } : null;
        const rankingFor = () => rankEntries(list, category ? { category } : {}).map((entry) => entry.id);
        const overrideId = overrideIdOf(safe);
        if (overrideId) {
            const override = findOverrideEntry(list, overrideId);
            if (!override) {
                return { ok: Boolean(automaticEntry), via: 'fallback', category, classification: effectiveClassification, entry: automaticEntry, workflow: automaticWorkflow, model: automaticModel, ranking: rankingFor(), reason: FALLBACK_REASON_OVERRIDE_NOT_FOUND, fallback };
            }
            if (override.availability === 'missing') {
                return { ok: Boolean(automaticEntry), via: 'fallback', category, classification: effectiveClassification, entry: automaticEntry, workflow: automaticWorkflow, model: automaticModel, ranking: rankingFor(), reason: FALLBACK_REASON_OVERRIDE_UNAVAILABLE, fallback };
            }
            const chosen = { ...override, score: scoreEntry(override) };
            const isWorkflow = override.kind === 'workflow';
            return { ok: true, via: 'manual-override', category, classification: effectiveClassification, entry: chosen, workflow: isWorkflow ? chosen : automaticWorkflow, model: isWorkflow ? automaticModel : chosen, ranking: rankingFor(), reason: 'override_applied', categoryMismatch: Boolean(category && Array.isArray(override.categories) && !override.categories.includes(category)), fallback };
        }
        if (overrideCategory) {
            return { ok: Boolean(automaticEntry), via: 'manual-override', category, classification: effectiveClassification, entry: automaticEntry, workflow: automaticWorkflow, model: automaticModel, ranking: rankingFor(), reason: 'override_category_applied', fallback };
        }
        if (!classification.category) {
            const overall = rankEntries(list, {});
            const entry = overall.length > 0 ? overall[0] : null;
            return { ok: Boolean(entry), via: 'fallback', category: null, classification, entry, workflow: topOfKind(list, null, 'workflow'), model: overall.find(isModelKind) || null, ranking: overall.map((candidate) => candidate.id), reason: classification.reason, fallback: entry ? { entry, category: null } : null };
        }
        return { ok: Boolean(automaticEntry), via: 'automatic', category, classification, entry: automaticEntry, workflow: automaticWorkflow, model: automaticModel, ranking: rankingFor(), reason: automaticEntry ? 'top_ranked_for_category' : 'no_candidates', fallback };
    } catch {
        return { ok: false, via: 'fallback', category: null, classification: null, entry: null, workflow: null, model: null, ranking: [], reason: 'router_error', fallback: null };
    }
}

/** Convenience wrapper routing against the reviewed registry. */
export function routeImageRequest(request = {}) {
    return routeRequest(DEFAULT_IMAGE_REGISTRY, request);
}
