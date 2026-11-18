// Minimal test runner with mocked Google Ads globals: `node test/run-tests.js`
// Writes the generated e-mail to test/output/mail.html for a visual check.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// --- Mocks -----------------------------------------------------------------

const state = { added: [], attached: [], mails: [], lists: {} };

function iterator(items) {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++], totalNumEntities: () => items.length };
}

function makeList(name, negatives) {
  const list = {
    getName: () => name,
    negativeKeywords: () => ({ get: () => iterator(negatives.map(n => ({ getText: () => n.text, getMatchType: () => n.type }))) }),
    campaigns: () => ({ get: () => iterator([]) }),
    addNegativeKeywords: kws => {
      if (kws.some(k => k.includes('bad'))) throw new Error('INVALID_CHARACTER');
      kws.forEach(k => state.added.push(k));
    },
    addNegativeKeyword: k => {
      if (k.includes('bad')) throw new Error('INVALID_CHARACTER');
      state.added.push(k);
    }
  };
  state.lists[name] = list;
  return list;
}

const searchTermRows = [
  ['running shoes', 'AI Max A', 100, 10, 5e6, 1],
  ['cheap flights to rome', 'AI Max A', 50, 2, 3e6, 0],
  ['cheap flights to rome', 'AI Max B', 30, 1, 1e6, 0], // aggregated with row above
  ['weather tomorrow', 'AI Max A', 1, 0, 0, 0],
  ['free movies', 'AI Max A', 20, 1, 0.5e6, 2],         // converting -> protected
  ['laufschuhe männer', 'AI Max A', 10, 1, 1e6, 0],     // transliteration match
  ['brand x', 'AI Max A', 40, 4, 2e6, 0],               // own keyword -> protected
  ['already excluded term', 'AI Max A', 5, 0, 0, 0],
  ['bad term', 'AI Max A', 5, 0, 0, 0],                 // rejected by API mock
  ['one two three four five six seven eight nine ten eleven twelve', 'AI Max A', 3, 0, 0, 0],
  ['karate landshut', 'AI Max A', 8, 1, 1e6, 0],        // blocked by phrase "karate" (consolidated)
  ['Kinder Karate', 'AI Max A', 6, 0, 0, 0],            // blocked by phrase "karate"
  ['karatekurs', 'AI Max A', 4, 0, 0, 0],               // NOT blocked: phrase needs whole words
  ['jobs in hamburg', 'AI Max A', 7, 0, 0, 0],          // blocked by broad hamburg jobs
  ['last minute flights', 'AI Max A', 5, 0, 0, 0]       // NOT blocked: "minute deals" not contained
];

global.AdsApp = {
  currentAccount: () => ({
    getName: () => 'Demo Account', getCustomerId: () => '123-456-7890',
    getCurrencyCode: () => 'EUR', getTimeZone: () => 'Europe/Berlin'
  }),
  search: query => {
    if (query.includes('FROM keyword_view')) {
      return iterator([{ adGroupCriterion: { keyword: { text: 'Brand X' } } }]);
    }
    assert.ok(query.includes('campaign.name LIKE "%AI Max%"'), 'campaign filter in query');
    return iterator(searchTermRows.map(r => ({
      searchTermView: { searchTerm: r[0] }, campaign: { name: r[1] },
      metrics: { impressions: String(r[2]), clicks: String(r[3]), costMicros: String(r[4]), conversions: r[5] }
    })));
  },
  negativeKeywordLists: () => ({ get: () => iterator(Object.keys(state.lists).map(k => state.lists[k])) }),
  newNegativeKeywordListBuilder: () => ({
    withName: name => ({ build: () => ({ isSuccessful: () => true, getResult: () => makeList(name, []) }) })
  }),
  campaigns: () => {
    const sel = { withCondition: () => sel, get: () => iterator(['AI Max A', 'AI Max B'].map((n, i) => ({
      getId: () => i + 1, getName: () => n, addNegativeKeywordList: () => state.attached.push(n)
    }))) };
    return sel;
  }
};
global.Utilities = { formatDate: (d) => d.toISOString().slice(0, 16).replace('T', ' ') };
global.MailApp = { sendEmail: o => state.mails.push(o) };
global.SpreadsheetApp = {};

// Load the script with test settings (live mode, mail enabled)
const src = fs.readFileSync(path.join(__dirname, '..', 'search-query-excluder.js'), 'utf8')
  .replace('const DRY_RUN = true;', 'const DRY_RUN = false;')
  .replace("const NOTIFY_EMAILS = ['you@example.com'];", "const NOTIFY_EMAILS = ['test@test.de'];")
  .replace("positivePattern: '(shoe|sneaker|boot)s?'", "positivePattern: 'shoe|schuh|maenner'")
  .replace('const MAX_EXCLUDE_SHARE = 0.95;', 'const MAX_EXCLUDE_SHARE = 1;')
  .replace(/minImpressions: \d+,\n    mode/, 'minImpressions: 1,\n    mode');
const mod = { exports: {} };
new Function('module', 'console', src)(mod, { log() {}, warn() {}, error: console.error });
const sqe = mod.exports;

// --- Unit tests ------------------------------------------------------------

assert.strictEqual(sqe.toNegativeKeyword('Foo  Bar'), '[foo bar]');
assert.strictEqual(sqe.toNegativeKeyword('a b c d e f g h i j k l'), '"a b c d e f g h i j"');
assert.strictEqual(sqe.toNegativeKeyword('x'.repeat(90)), '');
assert.strictEqual(sqe.toNegativeKeyword('price? (cheap)'), '[price cheap]');

const parsed = sqe.parseRuleRows([
  ['accountId', 'campaignFilter', 'listName', 'positiveStrings', 'impressionTimeRange', 'impressionThreshold', 'mode ("live" or "test")'],
  ['', '%A%', 'List A', 'abc', 'LAST_30_DAYS', 1, 'test'],
  ['', '', '', '', '', '', '']
]);
assert.strictEqual(parsed.rules.length, 1);
assert.strictEqual(parsed.rules[0].positivePattern, 'abc');
const validated = sqe.validateRules(parsed.rules.concat([{ id: 'x', listName: 'L', positivePattern: '(' }, { id: 'y', listName: 'L', positivePattern: 'a', dateRange: 90 }]));
assert.strictEqual(validated.rules.length, 2);
assert.strictEqual(validated.rules[0].mode, 'test');
assert.strictEqual(validated.problems.length, 1);

// Coverage: Google's negative matching
const idx = sqe.buildNegativeIndex([
  { text: 'weather today', type: 'EXACT' },
  { text: 'cheap flights', type: 'PHRASE' },
  { text: 'hamburg jobs', type: 'BROAD' }
]);
assert.strictEqual(sqe.findBlockingNegative('Weather  today', idx), '[weather today]');
assert.strictEqual(sqe.findBlockingNegative('weather today berlin', idx), '');       // exact: no extra words
assert.strictEqual(sqe.findBlockingNegative('today weather', idx), '');              // exact: order matters
assert.strictEqual(sqe.findBlockingNegative('cheap flights', idx), '"cheap flights"');
assert.strictEqual(sqe.findBlockingNegative('very cheap flights rome', idx), '"cheap flights"');
assert.strictEqual(sqe.findBlockingNegative('flights cheap', idx), '');              // phrase: order matters
assert.strictEqual(sqe.findBlockingNegative('cheap last minute flights', idx), '');  // phrase: consecutive
assert.strictEqual(sqe.findBlockingNegative('cheapflights', idx), '');               // whole words only
assert.strictEqual(sqe.findBlockingNegative('jobs in hamburg', idx), 'hamburg jobs');
assert.strictEqual(sqe.findBlockingNegative('hamburg', idx), '');                    // broad: all words
assert.strictEqual(sqe.findBlockingNegative('cheap flights? (rome)', idx), '"cheap flights"');

// Negatives planned in the same run block later candidates
const runIdx = sqe.buildNegativeIndex([]);
const filtered = sqe.filterBlockedCandidates([
  { term: 'a b c d e f g h i j k', negative: '"a b c d e f g h i j"' },
  { term: 'a b c d e f g h i j x', negative: '"a b c d e f g h i j"' },
  { term: 'foo', negative: '[foo]' },
  { term: 'Foo', negative: '[foo]' }
], runIdx);
assert.deepStrictEqual(filtered.candidates.map(c => c.term), ['a b c d e f g h i j k', 'foo']);
assert.deepStrictEqual(filtered.blocked.map(c => c.blockedBy), ['"a b c d e f g h i j"', '[foo]']);
assert.strictEqual(runIdx.count, 2);

// --- Integration: full run --------------------------------------------------

makeList('SQE - AI Max negatives', [
  { text: '[already excluded term]', type: 'EXACT' },
  { text: '"karate"', type: 'PHRASE' },
  { text: '"minute deals"', type: 'PHRASE' },
  { text: '+hamburg +jobs', type: 'BROAD' }
]);
sqe.main();

assert.deepStrictEqual(state.added.sort(), [
  '"one two three four five six seven eight nine ten"',
  '[cheap flights to rome]',
  '[karatekurs]',
  '[last minute flights]',
  '[weather tomorrow]'
]);
assert.deepStrictEqual(state.attached, ['AI Max A', 'AI Max B']);
assert.strictEqual(state.mails.length, 1);
assert.ok(state.mails[0].subject.includes('5 search term(s) excluded'), state.mails[0].subject);
assert.ok(state.mails[0].htmlBody.includes('cheap flights to rome'));
assert.ok(state.mails[0].htmlBody.includes('has conversions'));
assert.ok(state.mails[0].htmlBody.includes('INVALID_CHARACTER'));
assert.ok(state.mails[0].htmlBody.includes('4 irrelevant term(s) are already blocked'), 'blocked note');
assert.ok(state.mails[0].htmlBody.includes('karate landshut ← &quot;karate&quot;'), 'blocked example');
assert.ok(state.mails[0].htmlBody.includes('jobs in hamburg ← hamburg jobs'), 'broad example');
assert.ok(!state.mails[0].htmlBody.includes('already excluded term ←'), 'identical exact not listed as example');

const out = path.join(__dirname, 'output');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'mail.html'), state.mails[0].htmlBody);
console.log('All tests passed. Mail preview: test/output/mail.html');
