/**
 * RFST-007 - TTS text segmentation with non-destructive narration.
 *
 * Roadmap evidence required: "Visible emotes unchanged; spoken
 * segments accurate."
 *
 * What is exercised for real:
 *  - The real `parseMessageSegments` and `joinQuotedBlocks` from
 *    `public/scripts/extensions/tts/segmentation.js`. These are the
 *    production functions the TTS extension entry point
 *    (tts/index.js) uses: processTtsQueue() segments every message
 *    with parseMessageSegments before queueing per-segment jobs,
 *    and joinQuotedBlocks implements narrate_quoted_only. For this
 *    package they were extracted verbatim from index.js into the
 *    dependency-free segmentation.js (index.js imports them back;
 *    the only change is that the multi_voice_enabled setting is
 *    passed in as an option instead of read from extension_settings)
 *    because index.js itself cannot be imported headlessly: it loads
 *    ~40 browser providers, constructs Audio/ModuleWorkerWrapper at
 *    module scope, and imports the full script.js graph.
 *  - Non-destructive contract: segmentation derives an independently
 *    prepared spoken representation from a copy of the message; the
 *    original string is never mutated, and for the core corpus the
 *    segments losslessly partition the message (re-wrapping each
 *    segment in its delimiters and joining with single spaces
 *    reproduces the original exactly).
 *
 * Honest scope limits (also recorded in campaign/PROGRESS.md):
 *  - Segments carry only { type, text } - trimmed copies in original
 *    order. The production code provides NO character offsets, so
 *    offset preservation (roadmap section 7) is not claimed here.
 *  - The browser-bound legs of processTtsQueue (settings-driven
 *    preprocessing, voice routing, provider processText) are not
 *    exercised headlessly.
 *  - Known segmenter limitations, asserted as word-survival only:
 *    a lone asterisk (e.g. math "3 * 5") can mispair with an emote
 *    opener when pass_asterisks and multi-voice are combined (the
 *    default pipeline strips asterisks before segmentation, so this
 *    cannot occur there); underscore emphasis is not recognised as
 *    an action and its markers stay in the narration segment.
 */
import { describe, test, expect } from '@jest/globals';
import { parseMessageSegments, joinQuotedBlocks } from '../public/scripts/extensions/tts/segmentation.js';

const MV = { multiVoiceEnabled: true };
const CANONICAL = '*She places the rune stone on the table and smiles.* "Come closer. I have something to show you."';

/** Re-wrap a segment in its original delimiters (straight quotes). */
function rewrap(segment) {
    if (segment.type === 'action') return '*' + segment.text + '*';
    if (segment.type === 'dialogue') return '"' + segment.text + '"';
    return segment.text;
}

describe('parseMessageSegments - canonical and core shapes', () => {
    test('canonical example: action then dialogue, markup stripped from spoken text', () => {
        expect(parseMessageSegments(CANONICAL, MV)).toEqual([
            { type: 'action', text: 'She places the rune stone on the table and smiles.' },
            { type: 'dialogue', text: 'Come closer. I have something to show you.' },
        ]);
    });

    test('emote-only message yields a single action segment', () => {
        expect(parseMessageSegments('*She places the rune stone on the table and smiles.*', MV)).toEqual([
            { type: 'action', text: 'She places the rune stone on the table and smiles.' },
        ]);
    });

    test('dialogue-only message yields a single dialogue segment', () => {
        expect(parseMessageSegments('"Come closer. I have something to show you."', MV)).toEqual([
            { type: 'dialogue', text: 'Come closer. I have something to show you.' },
        ]);
    });

    test('plain narration yields a single other segment', () => {
        expect(parseMessageSegments('The hall was quiet and the fire burned low.', MV)).toEqual([
            { type: 'other', text: 'The hall was quiet and the fire burned low.' },
        ]);
    });

    test('mixed narration, action and dialogue keep original order and types', () => {
        const text = 'The hall was quiet. *He sets down his cup.* "You came a long way." She nods. "Farther than you know."';
        expect(parseMessageSegments(text, MV)).toEqual([
            { type: 'other', text: 'The hall was quiet.' },
            { type: 'action', text: 'He sets down his cup.' },
            { type: 'dialogue', text: 'You came a long way.' },
            { type: 'other', text: 'She nods.' },
            { type: 'dialogue', text: 'Farther than you know.' },
        ]);
    });

    test('multiple sentences inside one quote stay one dialogue segment', () => {
        expect(parseMessageSegments('"First sentence here. Second sentence follows! Is that clear?"', MV)).toEqual([
            { type: 'dialogue', text: 'First sentence here. Second sentence follows! Is that clear?' },
        ]);
    });

    test('emote chain segments in order', () => {
        const text = '*She rises.* *She crosses the room.* *She kneels.* "There. Now we can begin."';
        expect(parseMessageSegments(text, MV)).toEqual([
            { type: 'action', text: 'She rises.' },
            { type: 'action', text: 'She crosses the room.' },
            { type: 'action', text: 'She kneels.' },
            { type: 'dialogue', text: 'There. Now we can begin.' },
        ]);
    });
});

describe('parseMessageSegments - quote styles and tricky content', () => {
    test('quotes inside an action stay inside the action segment', () => {
        const text = '*"Do not move," she hisses, blade drawn.* The room holds its breath.';
        expect(parseMessageSegments(text, MV)).toEqual([
            { type: 'action', text: '"Do not move," she hisses, blade drawn.' },
            { type: 'other', text: 'The room holds its breath.' },
        ]);
    });

    test('nested single quotes inside dialogue are preserved', () => {
        const text = '*She leans in and whispers,* "He told me, \'Do not open the gate,\' and then he was gone."';
        expect(parseMessageSegments(text, MV)).toEqual([
            { type: 'action', text: 'She leans in and whispers,' },
            { type: 'dialogue', text: 'He told me, \'Do not open the gate,\' and then he was gone.' },
        ]);
    });

    test('curly quotes are dialogue', () => {
        const text = '“Come closer,” *she says softly.* “I have something to show you.”';
        expect(parseMessageSegments(text, MV)).toEqual([
            { type: 'dialogue', text: 'Come closer,' },
            { type: 'action', text: 'she says softly.' },
            { type: 'dialogue', text: 'I have something to show you.' },
        ]);
    });

    test('guillemets are dialogue', () => {
        expect(parseMessageSegments('«Viens ici.» *Elle sourit.*', MV)).toEqual([
            { type: 'dialogue', text: 'Viens ici.' },
            { type: 'action', text: 'Elle sourit.' },
        ]);
    });

    test('Japanese corner quotes are dialogue', () => {
        expect(parseMessageSegments('「来なさい。」*彼女は微笑む。*', MV)).toEqual([
            { type: 'dialogue', text: '来なさい。' },
            { type: 'action', text: '彼女は微笑む。' },
        ]);
    });

    test('bold markdown action degrades to narration with no asterisks spoken', () => {
        const text = '**She slams the door.** Then she speaks. "That is final."';
        const segments = parseMessageSegments(text, MV);
        expect(segments).toEqual([
            { type: 'other', text: 'She slams the door.' },
            { type: 'other', text: 'Then she speaks.' },
            { type: 'dialogue', text: 'That is final.' },
        ]);
        for (const segment of segments) {
            expect(segment.text).not.toContain('*');
        }
    });

    test('no segment of the core corpus carries raw delimiters', () => {
        const corpus = [
            CANONICAL,
            'The hall was quiet. *He sets down his cup.* "You came a long way." She nods. "Farther than you know."',
            '*She rises.* *She crosses the room.* *She kneels.* "There. Now we can begin."',
        ];
        for (const text of corpus) {
            for (const segment of parseMessageSegments(text, MV)) {
                expect(segment.text).not.toContain('*');
                expect(segment.text.startsWith('"')).toBe(false);
                expect(segment.text.endsWith('"')).toBe(false);
            }
        }
    });
});

describe('parseMessageSegments - non-destructive contract', () => {
    test('the original message string is never mutated', () => {
        const original = String(CANONICAL);
        parseMessageSegments(CANONICAL, MV);
        parseMessageSegments(CANONICAL, { multiVoiceEnabled: false });
        joinQuotedBlocks(CANONICAL);
        expect(CANONICAL).toBe(original);
        expect(CANONICAL).toBe('*She places the rune stone on the table and smiles.* "Come closer. I have something to show you."');
    });

    test('segments losslessly partition the core corpus (order + content)', () => {
        const corpus = [
            CANONICAL,
            '*She places the rune stone on the table and smiles.*',
            '"Come closer. I have something to show you."',
            'The hall was quiet. *He sets down his cup.* "You came a long way." She nods. "Farther than you know."',
            '*She rises.* *She crosses the room.* *She kneels.* "There. Now we can begin."',
        ];
        for (const text of corpus) {
            const rebuilt = parseMessageSegments(text, MV).map(rewrap).join(' ');
            expect(rebuilt).toBe(text);
        }
    });

    test('each call returns fresh segment objects', () => {
        const first = parseMessageSegments(CANONICAL, MV);
        first[0].text = 'tampered';
        const second = parseMessageSegments(CANONICAL, MV);
        expect(second[0].text).toBe('She places the rune stone on the table and smiles.');
    });

    test('segments expose exactly type and text (no offsets are provided)', () => {
        for (const segment of parseMessageSegments(CANONICAL, MV)) {
            expect(Object.keys(segment).sort()).toEqual(['text', 'type']);
        }
    });
});

describe('parseMessageSegments - settings and edge cases', () => {
    test('multi-voice disabled returns the whole text as one other segment, markup intact', () => {
        expect(parseMessageSegments(CANONICAL, { multiVoiceEnabled: false })).toEqual([
            { type: 'other', text: CANONICAL },
        ]);
    });

    test('omitted options match the app default (multi_voice_enabled: false)', () => {
        expect(parseMessageSegments(CANONICAL)).toEqual([
            { type: 'other', text: CANONICAL },
        ]);
    });

    test('empty and whitespace-only text yield no segments', () => {
        expect(parseMessageSegments('', MV)).toEqual([]);
        expect(parseMessageSegments('   ', MV)).toEqual([]);
    });

    test('an empty action (**) is skipped, dialogue still found', () => {
        expect(parseMessageSegments('** "Hello there."', MV)).toEqual([
            { type: 'dialogue', text: 'Hello there.' },
        ]);
    });

    test('an unclosed quote degrades to narration with the text preserved', () => {
        expect(parseMessageSegments('She said "hello and never finished', MV)).toEqual([
            { type: 'other', text: 'She said "hello and never finished' },
        ]);
    });

    test('KNOWN LIMITATION: a lone math asterisk can mispair with an emote opener - no words are lost', () => {
        // With pass_asterisks + multi-voice combined, "3 * 5" mispairs:
        // the segmenter is asserted here only for word survival, not
        // for correct typing. The default pipeline strips asterisks
        // before segmentation, so this cannot occur there.
        const text = 'The price is 3 * 5 = 15 silver, *she notes, counting the coins.*';
        const joined = parseMessageSegments(text, MV).map(s => s.text).join(' ');
        expect(joined).toContain('The price is 3');
        expect(joined).toContain('5 = 15 silver,');
        expect(joined).toContain('she notes, counting the coins.');
    });

    test('KNOWN LIMITATION: underscore emphasis is not an action; its dialogue still segments', () => {
        const segments = parseMessageSegments('_She smiles faintly._ "Underscores carry tone too."', MV);
        expect(segments[segments.length - 1]).toEqual({ type: 'dialogue', text: 'Underscores carry tone too.' });
        expect(segments[0].type).toBe('other');
        expect(segments[0].text).toContain('She smiles faintly.');
    });
});

describe('joinQuotedBlocks - narrate_quoted_only extraction', () => {
    test('canonical: extracts the quoted block with quotes kept', () => {
        expect(joinQuotedBlocks(CANONICAL)).toBe('"Come closer. I have something to show you."');
    });

    test('multiple quoted blocks join with the default separator', () => {
        const text = 'The hall was quiet. *He sets down his cup.* "You came a long way." She nods. "Farther than you know."';
        expect(joinQuotedBlocks(text)).toBe('"You came a long way." ... "Farther than you know."');
    });

    test('includeQuotes: false strips the quote characters', () => {
        const text = '"You came a long way." She nods. "Farther than you know."';
        expect(joinQuotedBlocks(text, { includeQuotes: false })).toBe('You came a long way. ... Farther than you know.');
    });

    test('a custom separator is honoured', () => {
        expect(joinQuotedBlocks('"One." then "Two."', { separator: ' | ' })).toBe('"One." | "Two."');
    });

    test('nested quotes: only the outermost block is collected, inner quotes preserved', () => {
        expect(joinQuotedBlocks('"He said “inner words” loudly." and “second”')).toBe('"He said “inner words” loudly." ... “second”');
    });

    test('no quotes returns the original text by default', () => {
        expect(joinQuotedBlocks('No quotes here.')).toBe('No quotes here.');
    });

    test('no quotes with returnEmptyOnNoQuotes returns an empty string', () => {
        expect(joinQuotedBlocks('No quotes here.', { returnEmptyOnNoQuotes: true })).toBe('');
    });

    test('an unclosed quote is ignored and the original text returned', () => {
        expect(joinQuotedBlocks('She said "never closed')).toBe('She said "never closed');
    });

    test('empty input passes through unchanged', () => {
        expect(joinQuotedBlocks('')).toBe('');
    });
});
