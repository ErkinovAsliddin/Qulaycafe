/**
 * The one definition of "placeholder text" shared by
 * scripts/find-placeholder-text.js and scripts/purge-placeholder-text.js.
 *
 * Both read from here so they cannot disagree. They did, briefly, and it was
 * confusing in a way that matters: the scanner's broad `Respublika` needle
 * flagged a delivery address ("Registon ko'chasi 12, O'zbekiston Respublikasi")
 * that the purge script deliberately leaves alone, so a cleaned database would
 * still report as dirty and the operator would loop.
 *
 * The phrases are matched with their grammatical suffixes consumed (\p{L}*), so
 * "vazirligining" and "bankning" are matched whole rather than half-deleted —
 * removing a bare "Respublika" out of "RESPUBLIKASI" leaves "SI" behind.
 *
 * Bare "Respublika" and bare "O'zbekiston" are deliberately NOT patterns: both
 * are real restaurant names and real postal-address text.
 */

const DEFINITIONS = [
  { label: 'finance ministry', pattern: '\\bmoliya\\s+vazirlig\\p{L}*' },
  { label: 'ministry wording', pattern: '\\bvazirlik\\p{L}*|\\bvazirlar\\b' },
  { label: 'cabinet wording', pattern: '\\bmahkama\\p{L}*|\\bhukumat\\p{L}*' },
  { label: 'central bank', pattern: '\\bmarkaziy\\s+bank\\p{L}*' },
  { label: 'report caption', pattern: "\\bto['’ʻ‘`]?g['’ʻ‘`]?risida\\s+axborot\\p{L}*" }
];

/** Human-readable summary of the phrases, for usage text. */
export const PLACEHOLDER_LABELS = DEFINITIONS.map(d => d.label);

export const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Fresh matcher objects on every call — a /g regex carries lastIndex between
 * uses, so a single shared instance silently skips matches on later rows.
 * Custom phrases replace the defaults rather than adding to them.
 */
export function placeholderMatchers(customPhrases = []) {
  const definitions = customPhrases.length
    ? customPhrases.map(phrase => ({ label: `custom: ${phrase}`, pattern: `${escapeRegExp(phrase)}\\p{L}*` }))
    : DEFINITIONS;

  return definitions.map(({ label, pattern }) => ({ label, re: new RegExp(pattern, 'giu') }));
}
