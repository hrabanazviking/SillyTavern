/**
 * TTS text segmentation helpers (RFST-007).
 *
 * Pure, dependency-free functions extracted verbatim from the TTS
 * extension entry point (index.js) so the real segmentation logic can
 * be unit-tested headlessly. index.js imports both functions from
 * here; behaviour is unchanged by the extraction.
 *
 * Segmentation contract: the original chat message is never mutated
 * (processTtsQueue works on a copy and keeps the original in the
 * queued segment jobs); these helpers only derive an independently
 * prepared spoken representation - action (*...*), dialogue
 * (quoted) and other (narration) segments, in original order, with
 * the markup delimiters stripped from the spoken text. Segments are
 * trimmed copies; the production code provides no character offsets.
 */

export function parseMessageSegments(text, { multiVoiceEnabled = false } = {}) {
    if (!multiVoiceEnabled) {
        return [{ type: 'other', text: text }];
    }

    const segments = [];
    const segmentRegex = /(\*[^*]*?\*)|(".*?")|(\u201C.*?\u201D)|(\u00AB.*?\u00BB)|(\u300C.*?\u300D)|(\u300E.*?\u300F)|(\uFF02.*?\uFF02)/gim;
    let lastIndex = 0;
    let match;

    segmentRegex.lastIndex = 0;

    while ((match = segmentRegex.exec(text)) !== null) {
        // Add other text before this match
        if (match.index > lastIndex) {
            const otherText = text.substring(lastIndex, match.index).trim();
            if (otherText && otherText.length > 0) {
                segments.push({ type: 'other', text: otherText });
            }
        }

        const matchedText = match[0];
        let segmentType = 'other';
        let content = '';

        if (match[1]) {
            // Asterisk content (*action*)
            segmentType = 'action';
            content = matchedText.slice(1, -1);
        } else if (match[2] || match[3] || match[4] || match[5] || match[6] || match[7]) {
            // Various quote types ("dialogue")
            segmentType = 'dialogue';
            content = matchedText.slice(1, -1);
        }

        // Trim and check for actual content
        content = content.trim();
        if (content.length > 0) {
            segments.push({
                type: segmentType,
                text: content,
            });
        }

        lastIndex = match.index + matchedText.length;
    }

    // Add remaining other text after last match
    if (lastIndex < text.length) {
        const otherText = text.substring(lastIndex).trim();
        if (otherText.length > 0) {
            segments.push({ type: 'other', text: otherText });
        }
    }

    // If no segments found and not empty, treat whole text as other text
    if (segments.length === 0 && text.trim().length > 0) {
        segments.push({ type: 'other', text: text.trim() });
    }

    return segments;
}

/**
 * Extract and join quoted blocks with proper matching pairs and nesting.
 * - Captures outermost quotes and everything inside (including different inner quote styles).
 * - Requires matching opener/closer style (e.g., “ ... ”, 「 ... 」, « ... », etc.).
 * - Ignores incomplete/unclosed quotes (doesn't include them in the result).
 * - Symmetric quotes like "..." and ＂...＂ are supported (not nesting the same symmetric style).
 *
 * @param {string} text - The text to process
 * @param {object} [opts={}] - Optional options object
 * @param {string} [opts.separator=' ... '] - String to join multiple quoted blocks
 * @param {boolean} [opts.includeQuotes=true] - Keep the quote chars around the captured text
 * @param {boolean} [opts.returnEmptyOnNoQuotes=false] - Return an empty string if no quotes are found
 * @param {Array<[string,string]>} [opts.pairs] - Custom quote pairs; defaults cover EN/DE/FR/JP
 * @returns {string} The joined quoted blocks, or the original text if no quotes found
 */
export function joinQuotedBlocks(text, opts = {}) {
    const {
        separator = ' ... ',
        includeQuotes = true,
        returnEmptyOnNoQuotes = false,
        pairs = [
            // typographic doubles
            ['„', '“'],          // DE low-high
            ['“', '”'],          // EN
            ['«', '»'],          // FR open « close »
            ['»', '«'],          // Some locales open »
            // typographic singles
            ['‘', '’'],
            ['‚', '‘'],
            // Japanese corner quotes
            ['「', '」'],
            ['『', '』'],
            // symmetric doubles
            ['"', '"'],
            ['＂', '＂'],
        ],
    } = opts;

    if (!text || typeof text !== 'string') return text;

    const openToClose = Object.fromEntries(pairs);

    const segments = [];
    const stack = []; // [{ opener, expectedClose, start }]
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const top = stack[stack.length - 1];

        // Prefer closing the current open pair if the char matches its expected closer
        if (top && ch === top.expectedClose) {
            const finished = stack.pop();
            if (stack.length === 0) {
                // Only collect outermost quotes (contains all nested content)
                segments.push(text.slice(finished.start, i + 1));
            }
            continue;
        }

        // Otherwise, see if this is a new opener
        if (openToClose[ch]) {
            stack.push({ opener: ch, expectedClose: openToClose[ch], start: i });
            continue;
        }

        // If it's a stray closer that doesn't match current top, ignore
    }

    if (!segments.length) return returnEmptyOnNoQuotes ? '' : text;

    const cleaned = includeQuotes
        ? segments
        : segments.map(s => s.slice(1, -1)); // all defined pairs are single-char quotes

    return cleaned.join(separator);
}
