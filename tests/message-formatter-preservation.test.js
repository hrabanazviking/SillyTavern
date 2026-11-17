/**
 * RFST-005 — Preserve raw roleplay/emotes end-to-end.
 *
 * Snapshot + preservation tests for the message-formatting pipeline.
 * Roadmap evidence required: "Automated snapshots pass."
 *
 * What is exercised for real:
 *  - The real `MessageFormatter` singleton from
 *    `public/scripts/message-formatter.js` (its `../script.js` import is
 *    mocked, following the pattern of prompt-converters.test.js, because
 *    script.js needs the full browser app graph). With no hooks
 *    registered, every pipeline stage (beforeRegex / afterRegex /
 *    afterMarkdown) must return raw roleplay text byte-for-byte.
 *  - The real Showdown converter, configured exactly as
 *    `reloadMarkdownProcessor()` in public/script.js configures it,
 *    rendering the same raw text to HTML. The visible text of the
 *    rendered HTML (tags stripped, entities decoded, <q> quote wrapping
 *    and <br> line breaks accounted for) must equal the raw text modulo
 *    the intended markdown rendering: emphasis asterisks become <em>
 *    and are not visible characters, everything else — dialogue,
 *    nested quotation, Unicode, runes, line breaks — must survive.
 *  - Jest snapshots of both the raw corpus and the rendered HTML, so
 *    any future change to rendering is a visible, reviewable diff.
 */
import { describe, test, expect, jest, beforeAll } from '@jest/globals';

jest.unstable_mockModule('../public/script.js', () => ({
    messageFormatting: jest.fn((mes) => mes),
}));

/** @type {import('../public/scripts/message-formatter.js')} */
let formatter;
/** @type {import('showdown').Converter} */
let converter;

const BASE_CTX = { characterName: 'Yrsa', isSystem: false, isUser: false, messageId: 1, isReasoning: false };

/**
 * The RFST-005 corpus. Every entry is a raw generated reply as it would
 * be persisted in the chat file; preservation is judged against it.
 */
const CORPUS = {
    canonical: '*She places the rune stone on the table and smiles.* "Come closer. I have something to show you."',
    nestedQuotation: '*She leans in and whispers,* "He told me, \'Do not open the gate,\' and then he was gone."',
    curlyQuotes: '“Come closer,” *she says softly.* “I have something to show you.”',
    mixedDialogueNarration: 'The hall was quiet. *He sets down his cup.* "You came a long way." She nods. "Farther than you know."',
    multiLine: '*She stands.*\n"First line of speech."\n*She sits again, slowly.*\n"Second line, after the pause."',
    blankLineBreaks: 'First paragraph of narration.\n\n*An action after the break.*\n\n"Speech in its own paragraph."',
    unicodeAndRunes: '*She carves ᚠ ᚢ ᚦ into the stone — þetta er seiðr.* "Þú ert velkominn, vinur." ✨',
    boldAndItalic: '**She slams the door.** Then, *quietly,* she adds, "That is final."',
    underscoreEmphasis: '_She smiles faintly._ "Underscores carry tone too."',
    unmatchedAsteriskMath: 'The price is 3 * 5 = 15 silver, *she notes, counting the coins.*',
    quotesInsideAction: '*"Do not move," she hisses, blade drawn.* The room holds its breath.',
    longEmoteChain: '*She rises.* *She crosses the room.* *She kneels.* "There. Now we can begin."',
};

/** Strip HTML tags and decode the entities Showdown emits, yielding visible text. */
function visibleText(html) {
    return html
        .replace(/<br\s*\/?>\n?/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Expected visible text per corpus entry, written out by hand: the raw
 * text with paired emphasis markers removed (that removal IS the
 * intended markdown rendering — the asterisks/underscores become
 * <em>/<strong>, they are not visible characters) and everything else
 * untouched. A lone, unpaired asterisk (unmatchedAsteriskMath) is not
 * markdown and must stay visible.
 */
const EXPECTED_VISIBLE = {
    canonical: 'She places the rune stone on the table and smiles. "Come closer. I have something to show you."',
    nestedQuotation: 'She leans in and whispers, "He told me, \'Do not open the gate,\' and then he was gone."',
    curlyQuotes: '“Come closer,” she says softly. “I have something to show you.”',
    mixedDialogueNarration: 'The hall was quiet. He sets down his cup. "You came a long way." She nods. "Farther than you know."',
    multiLine: 'She stands.\n"First line of speech."\nShe sits again, slowly.\n"Second line, after the pause."',
    blankLineBreaks: 'First paragraph of narration.\n\nAn action after the break.\n\n"Speech in its own paragraph."',
    unicodeAndRunes: 'She carves ᚠ ᚢ ᚦ into the stone — þetta er seiðr. "Þú ert velkominn, vinur." ✨',
    boldAndItalic: 'She slams the door. Then, quietly, she adds, "That is final."',
    underscoreEmphasis: 'She smiles faintly. "Underscores carry tone too."',
    unmatchedAsteriskMath: 'The price is 3 * 5 = 15 silver, she notes, counting the coins.',
    quotesInsideAction: '"Do not move," she hisses, blade drawn. The room holds its breath.',
    longEmoteChain: 'She rises. She crosses the room. She kneels. "There. Now we can begin."',
};

function expectedVisible(raw) {
    const entry = Object.entries(CORPUS).find(([, v]) => v === raw);
    if (!entry) throw new Error('No expected visible text recorded for corpus entry');
    return EXPECTED_VISIBLE[entry[0]];
}

beforeAll(async () => {
    formatter = await import('../public/scripts/message-formatter.js');
    const showdownModule = await import('showdown');
    const Showdown = showdownModule.default ?? showdownModule;
    const { markdownUnderscoreExt } = await import('../public/scripts/showdown-underscore.js');
    // Mirrors reloadMarkdownProcessor() in public/script.js exactly.
    // (markdownExclusionExt is omitted: with the default empty
    // markdown_escape_strings it returns [] in production too.)
    converter = new Showdown.Converter({
        emoji: true,
        literalMidWordUnderscores: true,
        parseImgDimensions: true,
        tables: true,
        underline: true,
        simpleLineBreaks: true,
        strikethrough: true,
        disableForced4SpacesIndentedSublists: true,
        extensions: [markdownUnderscoreExt()],
    });
});

describe('RFST-005 raw preservation through MessageFormatter stages', () => {
    // NOTE: this describe must run before any test registers a hook on
    // the singleton (hooks are additive and cannot be removed).
    for (const [name, raw] of Object.entries(CORPUS)) {
        test(`${name}: raw text passes every stage byte-for-byte`, () => {
            for (const stage of Object.values(formatter.formatting_stage)) {
                expect(formatter.MessageFormatter.runStage(stage, raw, BASE_CTX)).toBe(raw);
            }
        });
    }

    test('raw corpus matches snapshots', () => {
        expect(CORPUS).toMatchSnapshot();
    });
});

describe('RFST-005 rendered output preserves visible text', () => {
    for (const [name, raw] of Object.entries(CORPUS)) {
        test(`${name}: visible text equals raw modulo intended markdown rendering`, () => {
            const html = converter.makeHtml(raw);
            expect(visibleText(html)).toBe(expectedVisible(raw));
        });
    }

    test('canonical example: action is emphasised, dialogue is quoted, nothing is lost', () => {
        const html = converter.makeHtml(CORPUS.canonical);
        expect(html).toContain('<em>She places the rune stone on the table and smiles.</em>');
        expect(html).toContain('"Come closer. I have something to show you."');
        expect(visibleText(html)).toBe('She places the rune stone on the table and smiles. "Come closer. I have something to show you."');
    });

    test('rendered HTML matches snapshots', () => {
        const rendered = Object.fromEntries(Object.entries(CORPUS).map(([k, v]) => [k, converter.makeHtml(v)]));
        expect(rendered).toMatchSnapshot();
    });
});

describe('RFST-005 end-to-end: stages then rendering', () => {
    for (const [name, raw] of Object.entries(CORPUS)) {
        test(`${name}: raw -> stages -> HTML keeps the same visible text`, () => {
            let text = raw;
            for (const stage of [formatter.formatting_stage.BEFORE_REGEX, formatter.formatting_stage.AFTER_REGEX]) {
                text = formatter.MessageFormatter.runStage(stage, text, BASE_CTX);
            }
            expect(text).toBe(raw);
            const html = converter.makeHtml(text);
            const after = formatter.MessageFormatter.runStage(formatter.formatting_stage.AFTER_MARKDOWN, html, BASE_CTX);
            expect(visibleText(after)).toBe(expectedVisible(raw));
        });
    }
});
