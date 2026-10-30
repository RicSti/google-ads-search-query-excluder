/**
 * Google Ads Script: Search Query Excluder (single account)
 *
 * Adds irrelevant search terms as [exact match] negatives to a shared negative
 * keyword list. A search term counts as irrelevant if it does NOT match the
 * rule's "positive pattern" (a regular expression describing what you want).
 * Built for broad match / AI Max campaigns where you want to keep traffic on
 * topic without maintaining endless negative lists by hand.
 *
 * Features
 *   - Multiple rules per account (e.g. one per campaign group), configured
 *     directly in this script or in a Google Sheet
 *   - Dry run / test mode per rule, HTML summary e-mail, log tab
 *   - Safety nets: protects converting terms and your own keywords, aborts a
 *     rule when the pattern looks broken, respects Google Ads limits
 *   - Creates the negative keyword list and attaches it to matching campaigns
 *
 * @name        Search Query Excluder
 * @version     1.0.0
 * @author      Richard Stinauer (adtraffic) <rs@adtraffic.de>
 * @copyright   (c) 2026 adtraffic - https://www.adtraffic.de
 * @license     MIT - see LICENSE file or https://opensource.org/licenses/MIT
 *
 * Setup
 *   1. Google Ads > Tools > Bulk actions > Scripts > + > paste this file.
 *   2. Adjust the SETTINGS block below (at least RULES or SPREADSHEET_URL,
 *      and NOTIFY_EMAILS).
 *   3. Authorize, run "Preview" once, check the log / e-mail.
 *   4. Set DRY_RUN = false and schedule the script (e.g. daily).
 *
 * Changelog
 *   1.0.0  2026-10-30  First public single-account release.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. Always
 * test with DRY_RUN = true before letting the script change your account.
 */

// ===========================================================================
// SETTINGS
// ===========================================================================

// true = nothing is changed in the account, the script only reports what it
// would do. Switch to false once the dry run looks plausible.
const DRY_RUN = true;

// Optional: URL of a Google Sheet holding the rules (tab "rules"). If set, the
// RULES below are ignored. Leave empty ('') to use the RULES in this script.
// On the first run the script creates the tabs "rules" and "log" itself.
const SPREADSHEET_URL = '';

// Rules used when SPREADSHEET_URL is empty. One object per rule.
//   campaignFilter  Campaign name, '%' = wildcard ('%AI Max%'), '' = all campaigns
//   listName        Name of the shared negative keyword list (created if missing)
//   positivePattern Regex (case-insensitive). Terms matching it are KEPT.
//   dateRange       e.g. 'LAST_30_DAYS', 'LAST_7_DAYS' or a number of days (90)
//   minImpressions  Only terms with at least this many impressions (summed)
//   mode            'live' or 'test' (test = report only, like DRY_RUN)
//   active          false = rule is ignored
const RULES = [
  {
    campaignFilter: '%AI Max%',
    listName: 'SQE - AI Max negatives',
    positivePattern: '(shoe|sneaker|boot)s?',
    dateRange: 'LAST_30_DAYS',
    minImpressions: 2,
    mode: 'live',
    active: true
  }
];

// Recipients of the summary e-mail. Empty list = no e-mail.
const NOTIFY_EMAILS = ['you@example.com'];

// false = only send an e-mail if something was excluded or went wrong
const SEND_EMAIL_IF_NOTHING_CHANGED = false;

// Language of the e-mail: 'en' or 'de'
const EMAIL_LANGUAGE = 'en';

// Maximum number of search terms listed per rule in the e-mail
const EMAIL_MAX_TERMS_PER_RULE = 50;

// --- Safety nets -----------------------------------------------------------

// Never exclude search terms that had conversions in the date range
const PROTECT_CONVERTING_TERMS = true;

// Never exclude search terms identical to one of your own (positive) keywords
const PROTECT_OWN_KEYWORDS = true;

// Skip a rule if more than this share of its search terms would be excluded.
// Protects against a broken pattern. 1 = disabled.
const MAX_EXCLUDE_SHARE = 0.95;

// Maximum number of new negatives per rule and run
const MAX_NEW_NEGATIVES_PER_RULE = 1000;

// Attach the negative keyword list to all campaigns matching the rule's filter
const ATTACH_LIST_TO_CAMPAIGNS = true;

// Also test the pattern against an umlaut-free version of the term
// (ä->ae, ö->oe, ü->ue, ß->ss), so 'maenner' in the pattern matches 'männer'.
const MATCH_TRANSLITERATED = true;

// Terms above Google's negative keyword limits (80 characters / 10 words):
//   'phrase' = add the first words as "phrase match" negative (blocks the term)
//   'skip'   = do not add, only report
// (A shortened [exact] negative would not block the original term at all.)
const LONG_TERM_HANDLING = 'phrase';

// ===========================================================================
// No changes needed below this line.
// ===========================================================================

const SCRIPT_NAME = 'Search Query Excluder';
const SCRIPT_VERSION = '1.0.0';
const SCRIPT_URL = 'https://www.adtraffic.de';

const RULES_SHEET = 'rules';
const LOG_SHEET = 'log';

const LIMITS = {
  maxKeywordChars: 80,
  maxKeywordWords: 10,
  maxKeywordsPerList: 5000,
  addChunkSize: 500
};

const DATE_LITERALS = [
  'TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS',
  'LAST_BUSINESS_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'THIS_WEEK_SUN_TODAY',
  'THIS_WEEK_MON_TODAY', 'LAST_WEEK_SUN_SAT', 'LAST_WEEK_MON_SUN'
];

const RULE_DEFAULTS = {
  campaignFilter: '',
  listName: '',
  positivePattern: '',
  dateRange: 'LAST_30_DAYS',
  minImpressions: 2,
  mode: 'live',
  active: true
};

const RULE_HEADER = ['active', 'campaignFilter', 'listName', 'positivePattern', 'dateRange', 'minImpressions', 'mode', 'notes'];
const LOG_HEADER = ['timestamp', 'rule', 'campaignFilter', 'listName', 'searchTerm', 'negative', 'impressions', 'clicks', 'cost', 'conversions', 'action', 'note'];

// Header aliases, so older sheets (e.g. "positiveStrings") keep working
const HEADER_ALIASES = {
  active: ['active', 'enabled', 'aktiv'],
  campaignFilter: ['campaignfilter', 'campaign', 'kampagnenfilter'],
  listName: ['listname', 'negativelist', 'list', 'listenname'],
  positivePattern: ['positivepattern', 'positivestrings', 'pattern', 'regex', 'erlaubtebegriffe'],
  dateRange: ['daterange', 'impressiontimerange', 'timerange', 'zeitraum'],
  minImpressions: ['minimpressions', 'impressionthreshold', 'threshold', 'minimpressionen'],
  mode: ['mode', 'modeliveortest', 'modus']
};

const ACTION = {
  excluded: 'EXCLUDED',
  wouldExclude: 'WOULD_EXCLUDE',
  skipped: 'SKIPPED',
  protected: 'PROTECTED'
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (typeof AdsManagerApp !== 'undefined' && isManagerAccount()) {
    throw new Error('This is the single-account version. Please run it inside a client account, not in a manager account (MCC).');
  }

  const account = AdsApp.currentAccount();
  const context = {
    accountName: account.getName(),
    accountId: account.getCustomerId(),
    currency: account.getCurrencyCode(),
    timeZone: account.getTimeZone(),
    startedAt: new Date(),
    spreadsheet: SPREADSHEET_URL ? openSpreadsheet(SPREADSHEET_URL) : null
  };

  console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION} - ${context.accountName} (${context.accountId})${DRY_RUN ? ' - DRY RUN' : ''}`);

  const loaded = context.spreadsheet ? loadRulesFromSheet(context.spreadsheet) : { rules: RULES.map((r, i) => Object.assign({ id: `#${i + 1}` }, r)), problems: [] };
  const parsed = validateRules(loaded.rules);
  const problems = loaded.problems.concat(parsed.problems);

  problems.forEach(p => console.warn(p));
  console.log(`${parsed.rules.length} active rule(s).`);

  const listCache = loadNegativeKeywordLists();
  const results = [];

  for (const rule of parsed.rules) {
    try {
      results.push(processRule(rule, context, listCache));
    } catch (e) {
      console.error(`Rule ${rule.id}: ${e.message}`);
      results.push(emptyResult(rule, `${e.message}`));
    }
  }

  if (context.spreadsheet) {
    writeLog(context.spreadsheet, results, context);
  }

  logSummary(results);
  sendSummaryMail(results, problems, context);
}

// ---------------------------------------------------------------------------
// Rule processing
// ---------------------------------------------------------------------------

function processRule(rule, context, listCache) {
  const testMode = DRY_RUN || rule.mode === 'test';
  const result = emptyResult(rule);
  result.testMode = testMode;

  console.log(`Rule ${rule.id}: campaigns "${rule.campaignFilter || '(all)'}" -> list "${rule.listName}"${testMode ? ' (test)' : ''}`);

  // 1. Search terms (aggregated over campaigns / ad groups)
  const terms = fetchSearchTerms(rule, context);
  const ownKeywords = PROTECT_OWN_KEYWORDS ? fetchOwnKeywords(rule) : {};

  // 2. Classify
  const plan = buildPlan(rule, terms, ownKeywords);
  Object.assign(result, plan.stats);
  result.protectedTerms = plan.protectedTerms;
  result.skippedTerms = plan.skipped;

  console.log(`  ${plan.stats.checked} terms checked, ${plan.stats.irrelevant} irrelevant, ${plan.protectedTerms.length} protected.`);

  if (plan.abortReason) {
    result.errors.push(plan.abortReason);
    console.warn(`  ${plan.abortReason}`);
    return result;
  }

  // 3. Negative keyword list (existing negatives are not added again)
  let list = listCache[rule.listName] || null;
  const existing = list ? readExistingNegatives(list) : {};
  let candidates = plan.candidates.filter(c => !existing[c.negative.toLowerCase()]);
  result.alreadyExcluded = plan.candidates.length - candidates.length;

  const capacity = LIMITS.maxKeywordsPerList - Object.keys(existing).length;
  const limit = Math.min(MAX_NEW_NEGATIVES_PER_RULE, Math.max(capacity, 0));

  if (candidates.length > limit) {
    const reason = limit === capacity
      ? `list full (${LIMITS.maxKeywordsPerList} negatives) - please create a second list`
      : `limit of ${MAX_NEW_NEGATIVES_PER_RULE} new negatives per run reached - next run`;
    candidates.slice(limit).forEach(c => result.skippedTerms.push(Object.assign({}, c, { reason: reason })));
    result.warnings.push(`${candidates.length - limit} term(s) postponed: ${reason}.`);
    candidates = candidates.slice(0, limit);
  }

  if (candidates.length === 0) {
    console.log('  Nothing new to exclude.');
  } else if (testMode) {
    result.terms = candidates;
    console.log(`  Would add ${candidates.length} negative(s).`);
  } else {
    if (!list) {
      list = createNegativeKeywordList(rule.listName);
      listCache[rule.listName] = list;
      result.listCreated = true;
    }
    const added = addNegatives(list, candidates, result);
    result.terms = added;
    console.log(`  Added ${added.length} negative(s) to "${rule.listName}".`);
  }

  // 4. Attach list to the rule's campaigns
  if (ATTACH_LIST_TO_CAMPAIGNS) {
    result.attachedCampaigns = attachListToCampaigns(rule, list, testMode, result);
  }

  return result;
}

function emptyResult(rule, error) {
  return {
    rule: rule,
    testMode: DRY_RUN || rule.mode === 'test',
    checked: 0,
    irrelevant: 0,
    alreadyExcluded: 0,
    terms: [],
    protectedTerms: [],
    skippedTerms: [],
    attachedCampaigns: [],
    listCreated: false,
    errors: error ? [error] : [],
    warnings: []
  };
}

// Pure function: decides which terms become negatives (testable without Google Ads)
function buildPlan(rule, terms, ownKeywords) {
  const pattern = new RegExp(rule.positivePattern, 'i');
  const stats = { checked: 0, irrelevant: 0 };
  const candidates = [];
  const protectedTerms = [];
  const skipped = [];

  for (const t of terms) {
    if (t.impressions < rule.minImpressions) {
      continue;
    }

    stats.checked++;

    if (pattern.test(t.term) || (MATCH_TRANSLITERATED && pattern.test(transliterate(t.term)))) {
      continue;
    }

    stats.irrelevant++;

    if (PROTECT_CONVERTING_TERMS && t.conversions > 0) {
      protectedTerms.push(Object.assign({}, t, { reason: 'has conversions' }));
      continue;
    }

    if (PROTECT_OWN_KEYWORDS && ownKeywords[t.term]) {
      protectedTerms.push(Object.assign({}, t, { reason: 'identical to own keyword' }));
      continue;
    }

    const negative = toNegativeKeyword(t.term);

    if (!negative) {
      skipped.push(Object.assign({}, t, { reason: `longer than ${LIMITS.maxKeywordChars} characters / ${LIMITS.maxKeywordWords} words` }));
      continue;
    }

    candidates.push(Object.assign({}, t, { negative: negative }));
  }

  const plan = { stats: stats, candidates: candidates, protectedTerms: protectedTerms, skipped: skipped, abortReason: '' };

  if (stats.checked >= 20 && MAX_EXCLUDE_SHARE < 1 && stats.irrelevant / stats.checked > MAX_EXCLUDE_SHARE) {
    plan.abortReason = `Rule skipped: ${Math.round(100 * stats.irrelevant / stats.checked)}% of the search terms would be excluded ` +
      `(limit ${Math.round(100 * MAX_EXCLUDE_SHARE)}%). Please check the positive pattern.`;
    plan.candidates = [];
  }

  // biggest waste first
  plan.candidates.sort((a, b) => b.cost - a.cost || b.impressions - a.impressions);
  return plan;
}

// Builds the negative keyword text, or '' if it cannot be added
function toNegativeKeyword(term) {
  const clean = sanitizeKeyword(term);

  if (!clean) {
    return '';
  }

  const words = clean.split(' ');

  if (clean.length + 2 <= LIMITS.maxKeywordChars && words.length <= LIMITS.maxKeywordWords) {
    return `[${clean}]`;
  }

  if (LONG_TERM_HANDLING !== 'phrase') {
    return '';
  }

  // Shorten to a phrase match negative containing the first words
  const kept = words.slice(0, LIMITS.maxKeywordWords);

  while (kept.length > 1 && kept.join(' ').length + 2 > LIMITS.maxKeywordChars) {
    kept.pop();
  }

  const phrase = kept.join(' ');
  return phrase.length + 2 <= LIMITS.maxKeywordChars && kept.length > 1 ? `"${phrase}"` : '';
}

// Removes characters Google Ads does not accept in keywords
function sanitizeKeyword(term) {
  return normalizeTerm(String(term).replace(/[!@%,*(){}=~`<>?\\|^;\[\]"]/g, ' '));
}

function normalizeTerm(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function transliterate(text) {
  return text.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

// ---------------------------------------------------------------------------
// Rules: validation and Google Sheet
// ---------------------------------------------------------------------------

function validateRules(rawRules) {
  const rules = [];
  const problems = [];

  rawRules.forEach(raw => {
    const r = Object.assign({}, RULE_DEFAULTS);
    Object.keys(raw).forEach(k => {
      if (raw[k] !== '' && raw[k] !== null && raw[k] !== undefined) {
        r[k] = raw[k];
      }
    });
    r.id = raw.id;

    if (!toBool(r.active)) {
      return;
    }

    r.campaignFilter = String(r.campaignFilter).trim();
    r.listName = String(r.listName).trim();
    r.positivePattern = String(r.positivePattern).trim();
    r.mode = String(r.mode).trim().toLowerCase() === 'test' ? 'test' : 'live';
    r.minImpressions = parseInt(r.minImpressions, 10);
    r.dateRange = String(r.dateRange).trim().toUpperCase();

    if (!r.listName) {
      problems.push(`Rule ${r.id}: listName is missing.`);
      return;
    }

    if (!r.positivePattern) {
      problems.push(`Rule ${r.id}: positivePattern is empty (would exclude everything).`);
      return;
    }

    try {
      new RegExp(r.positivePattern, 'i');
    } catch (e) {
      problems.push(`Rule ${r.id}: invalid positivePattern - ${e.message}`);
      return;
    }

    if (isNaN(r.minImpressions) || r.minImpressions < 0) {
      problems.push(`Rule ${r.id}: invalid minImpressions.`);
      return;
    }

    if (!DATE_LITERALS.includes(r.dateRange) && !(/^\d+$/.test(r.dateRange) && +r.dateRange > 0)) {
      problems.push(`Rule ${r.id}: invalid dateRange "${r.dateRange}" (use e.g. LAST_30_DAYS or a number of days).`);
      return;
    }

    rules.push(r);
  });

  // Two rules writing different patterns into the same list are allowed, but worth a hint
  return { rules: rules, problems: problems };
}

function toBool(value) {
  if (value === true || value === false) {
    return value;
  }
  return !['false', 'no', 'nein', '0', 'off', 'inactive'].includes(String(value).trim().toLowerCase());
}

function openSpreadsheet(url) {
  try {
    return SpreadsheetApp.openByUrl(url);
  } catch (e) {
    throw new Error(`Cannot open spreadsheet (${e.message}). Check SPREADSHEET_URL and access rights.`);
  }
}

function loadRulesFromSheet(ss) {
  let sheet = ss.getSheetByName(RULES_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(RULES_SHEET);
    sheet.getRange(1, 1, 1, RULE_HEADER.length).setValues([RULE_HEADER]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return { rules: [], problems: [`Tab "${RULES_SHEET}" was created. Please add your rules there and run the script again.`] };
  }

  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return { rules: [], problems: [`Tab "${RULES_SHEET}" contains no rules.`] };
  }

  return parseRuleRows(values);
}

// Pure function: sheet values (incl. header row) -> rule objects
function parseRuleRows(values) {
  const header = values[0].map(h => String(h).toLowerCase().replace(/[^a-z]/g, ''));
  const columns = {};
  const problems = [];

  Object.keys(HEADER_ALIASES).forEach(key => {
    const index = header.findIndex(h => HEADER_ALIASES[key].includes(h));
    if (index >= 0) {
      columns[key] = index;
    }
  });

  ['campaignFilter', 'listName', 'positivePattern'].forEach(key => {
    if (columns[key] === undefined) {
      problems.push(`Tab "${RULES_SHEET}": column "${key}" not found.`);
    }
  });

  if (problems.length > 0) {
    return { rules: [], problems: problems };
  }

  const rules = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    if (row.every(cell => String(cell).trim() === '')) {
      continue;
    }

    const rule = { id: `row ${i + 1}` };
    Object.keys(columns).forEach(key => { rule[key] = row[columns[key]]; });
    rules.push(rule);
  }

  return { rules: rules, problems: problems };
}

function writeLog(ss, results, context) {
  const rows = [];
  const timestamp = Utilities.formatDate(context.startedAt, context.timeZone, 'yyyy-MM-dd HH:mm:ss');

  for (const r of results) {
    const base = [timestamp, r.rule.id, r.rule.campaignFilter, r.rule.listName];
    const row = (t, action, note) => base.concat([t.term, t.negative || '', t.impressions, t.clicks, round(t.cost, 2), round(t.conversions, 2), action, note || '']);

    r.terms.forEach(t => rows.push(row(t, r.testMode ? ACTION.wouldExclude : ACTION.excluded)));
    r.skippedTerms.forEach(t => rows.push(row(t, ACTION.skipped, t.reason)));
    r.protectedTerms.forEach(t => rows.push(row(t, ACTION.protected, t.reason)));
  }

  if (rows.length === 0) {
    return;
  }

  try {
    let sheet = ss.getSheetByName(LOG_SHEET);

    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET);
      sheet.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_HEADER.length).setValues(rows);
  } catch (e) {
    console.warn(`Could not write tab "${LOG_SHEET}": ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Google Ads access
// ---------------------------------------------------------------------------

function isManagerAccount() {
  try {
    AdsManagerApp.accounts().get();
    return true;
  } catch (e) {
    return false;
  }
}

function gaqlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function campaignCondition(rule) {
  return rule.campaignFilter ? ` AND campaign.name LIKE ${gaqlString(rule.campaignFilter)}` : '';
}

function dateCondition(rule, context) {
  if (DATE_LITERALS.includes(rule.dateRange)) {
    return `segments.date DURING ${rule.dateRange}`;
  }

  const days = parseInt(rule.dateRange, 10);
  const end = new Date(context.startedAt.getTime() - 24 * 3600 * 1000);
  const start = new Date(end.getTime() - (days - 1) * 24 * 3600 * 1000);
  const fmt = d => Utilities.formatDate(d, context.timeZone, 'yyyy-MM-dd');
  return `segments.date BETWEEN '${fmt(start)}' AND '${fmt(end)}'`;
}

// Search terms of the matching campaigns, aggregated per term.
// The impression threshold is applied to the SUM (search_term_view is
// segmented by ad group, so filtering in GAQL would miss spread-out terms).
function fetchSearchTerms(rule, context) {
  const query =
    'SELECT search_term_view.search_term, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    'FROM search_term_view ' +
    `WHERE ${dateCondition(rule, context)} AND metrics.impressions > 0 AND campaign.status != 'REMOVED'${campaignCondition(rule)}`;

  const byTerm = {};
  const rows = AdsApp.search(query);

  while (rows.hasNext()) {
    const row = rows.next();
    const term = normalizeTerm(row.searchTermView.searchTerm);

    if (!term) {
      continue;
    }

    const entry = byTerm[term] || (byTerm[term] = { term: term, impressions: 0, clicks: 0, cost: 0, conversions: 0, campaigns: [] });
    entry.impressions += Number(row.metrics.impressions) || 0;
    entry.clicks += Number(row.metrics.clicks) || 0;
    entry.cost += (Number(row.metrics.costMicros) || 0) / 1e6;
    entry.conversions += Number(row.metrics.conversions) || 0;

    if (!entry.campaigns.includes(row.campaign.name)) {
      entry.campaigns.push(row.campaign.name);
    }
  }

  return Object.keys(byTerm).map(k => byTerm[k]);
}

function fetchOwnKeywords(rule) {
  const keywords = {};
  const rows = AdsApp.search(
    'SELECT ad_group_criterion.keyword.text FROM keyword_view ' +
    `WHERE ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.negative = FALSE AND campaign.status != 'REMOVED'${campaignCondition(rule)}`
  );

  while (rows.hasNext()) {
    keywords[normalizeTerm(rows.next().adGroupCriterion.keyword.text)] = true;
  }

  return keywords;
}

function loadNegativeKeywordLists() {
  const lists = {};
  const it = AdsApp.negativeKeywordLists().get();

  while (it.hasNext()) {
    const list = it.next();
    lists[list.getName()] = list;
  }

  return lists;
}

// Returns a map of existing negatives, keyed by keyword text incl. match type syntax
function readExistingNegatives(list) {
  const existing = {};
  const it = list.negativeKeywords().get();

  while (it.hasNext()) {
    const kw = it.next();
    const text = normalizeTerm(kw.getText()).replace(/^[\["]|[\]"]$/g, '');
    const type = typeof kw.getMatchType === 'function' ? String(kw.getMatchType()).toUpperCase() : 'EXACT';
    const formatted = type === 'PHRASE' ? `"${text}"` : type === 'BROAD' ? text : `[${text}]`;
    existing[formatted] = true;
  }

  return existing;
}

function createNegativeKeywordList(name) {
  const operation = AdsApp.newNegativeKeywordListBuilder().withName(name).build();

  if (!operation.isSuccessful()) {
    throw new Error(`Negative keyword list "${name}" could not be created: ${operation.getErrors().join('; ')}`);
  }

  console.log(`  Created negative keyword list "${name}".`);
  return operation.getResult();
}

// Adds negatives in chunks; if a chunk fails, falls back to one by one so a
// single invalid term does not block the rest.
function addNegatives(list, candidates, result) {
  const added = [];

  for (let i = 0; i < candidates.length; i += LIMITS.addChunkSize) {
    const chunk = candidates.slice(i, i + LIMITS.addChunkSize);

    try {
      list.addNegativeKeywords(chunk.map(c => c.negative));
      chunk.forEach(c => added.push(c));
    } catch (e) {
      console.warn(`  Bulk add failed (${e.message}), retrying one by one.`);

      for (const c of chunk) {
        try {
          list.addNegativeKeyword(c.negative);
          added.push(c);
        } catch (err) {
          result.skippedTerms.push(Object.assign({}, c, { reason: `rejected by Google Ads: ${err.message}` }));
        }
      }
    }
  }

  return added;
}

function attachListToCampaigns(rule, list, testMode, result) {
  const attachedIds = {};

  if (!list && !testMode) {
    return []; // list does not exist yet (nothing to exclude so far)
  }

  if (list) {
    const it = list.campaigns().get();
    while (it.hasNext()) {
      attachedIds[it.next().getId()] = true;
    }
  }

  const attached = [];
  let selector = AdsApp.campaigns().withCondition("campaign.status != 'REMOVED'");

  if (rule.campaignFilter) {
    selector = selector.withCondition(`campaign.name LIKE ${gaqlString(rule.campaignFilter)}`);
  }

  const it = selector.get();

  while (it.hasNext()) {
    const campaign = it.next();

    if (attachedIds[campaign.getId()]) {
      continue;
    }

    if (testMode || !list) {
      attached.push(campaign.getName());
      continue;
    }

    try {
      campaign.addNegativeKeywordList(list);
      attached.push(campaign.getName());
    } catch (e) {
      result.warnings.push(`List could not be attached to "${campaign.getName()}": ${e.message}`);
    }
  }

  if (attached.length > 0) {
    console.log(`  ${testMode || !list ? 'Would attach' : 'Attached'} list to ${attached.length} campaign(s).`);
  }

  return attached;
}

// ---------------------------------------------------------------------------
// Output: log + e-mail
// ---------------------------------------------------------------------------

function logSummary(results) {
  const total = results.reduce((n, r) => n + r.terms.length, 0);
  const errors = results.reduce((n, r) => n + r.errors.length, 0);
  console.log(`Done: ${total} negative(s) ${DRY_RUN ? 'planned (dry run)' : 'added or planned'}, ${errors} error(s).`);
}

const I18N = {
  en: {
    subjectChanged: n => `${n} search term(s) excluded`,
    subjectPlanned: n => `${n} search term(s) would be excluded`,
    subjectNone: 'no changes',
    subjectErrors: n => `${n} error(s)`,
    testPrefix: '[Test] ',
    subtitleLive: 'Summary of the changes made',
    subtitleTest: 'Test run: preview of planned exclusions',
    banner: '<b>Test run:</b> nothing was changed in the account. The numbers show what the script would do in live mode.',
    tileTerms: 'Search terms excluded',
    tileTermsTest: 'Search terms (planned)',
    tileImpr: 'Impressions of these terms',
    tileClicks: 'Clicks of these terms',
    tileCost: 'Cost of these terms',
    tileProtected: 'Protected terms',
    tileErrors: 'Errors',
    metricsNote: 'Impressions, clicks and cost refer to the date range of each rule. They show how much irrelevant traffic these terms caused and will no longer cause.',
    ruleSub: (irr, chk) => `${irr} of ${chk} checked search terms irrelevant`,
    colTerm: 'Search term', colNeg: 'Negative', colImpr: 'Impr.', colClicks: 'Clicks', colCost: 'Cost', colCtr: 'CTR %',
    more: (n, hasSheet) => `... and ${n} more${hasSheet ? ` (see tab "${LOG_SHEET}")` : ''}.`,
    testRule: 'Rule in test mode - nothing was changed.',
    listCreated: name => `Negative keyword list "${name}" was created.`,
    attached: (test, n, names) => `${test ? 'Would attach' : 'List attached to'} ${n} campaign(s): ${names}`,
    alreadyExcluded: n => `${n} irrelevant term(s) were already in the list.`,
    protected: n => `${n} term(s) protected (conversions or own keyword):`,
    skipped: n => `${n} term(s) skipped:`,
    error: 'Error', warning: 'Note', general: 'General',
    openSheet: 'Open the Google Sheet',
    footer: 'Automated message from the Google Ads script',
    noRules: 'No active rules found.'
  },
  de: {
    subjectChanged: n => `${n} Suchbegriff(e) ausgeschlossen`,
    subjectPlanned: n => `${n} Suchbegriff(e) würden ausgeschlossen`,
    subjectNone: 'keine Änderungen',
    subjectErrors: n => `${n} Fehler`,
    testPrefix: '[Testlauf] ',
    subtitleLive: 'Zusammenfassung der vorgenommenen Änderungen',
    subtitleTest: 'Testlauf: Vorschau der geplanten Ausschlüsse',
    banner: '<b>Testlauf:</b> Es wurde nichts im Konto verändert. Die Zahlen zeigen, was das Script im Livebetrieb tun würde.',
    tileTerms: 'Begriffe ausgeschlossen',
    tileTermsTest: 'Begriffe (geplant)',
    tileImpr: 'Impressionen dieser Begriffe',
    tileClicks: 'Klicks dieser Begriffe',
    tileCost: 'Kosten dieser Begriffe',
    tileProtected: 'Geschützte Begriffe',
    tileErrors: 'Fehler',
    metricsNote: 'Impressionen, Klicks und Kosten beziehen sich auf den Zeitraum der jeweiligen Regel. Sie zeigen, wie viel unpassender Traffic auf diese Begriffe entfiel und künftig entfällt.',
    ruleSub: (irr, chk) => `${irr} von ${chk} geprüften Suchbegriffen unpassend`,
    colTerm: 'Suchbegriff', colNeg: 'Negative', colImpr: 'Impr.', colClicks: 'Klicks', colCost: 'Kosten', colCtr: 'CTR %',
    more: (n, hasSheet) => `... und ${n} weitere${hasSheet ? ` (vollständig im Tab "${LOG_SHEET}")` : ''}.`,
    testRule: 'Regel im Testmodus - es wurde nichts verändert.',
    listCreated: name => `Ausschlussliste "${name}" wurde angelegt.`,
    attached: (test, n, names) => `${test ? 'Würde zuordnen' : 'Liste zugeordnet'} (${n} Kampagnen): ${names}`,
    alreadyExcluded: n => `${n} unpassende(r) Begriff(e) war(en) bereits in der Liste.`,
    protected: n => `${n} Begriff(e) geschützt (Conversions oder eigenes Keyword):`,
    skipped: n => `${n} Begriff(e) übersprungen:`,
    error: 'Fehler', warning: 'Hinweis', general: 'Allgemein',
    openSheet: 'Google Sheet öffnen',
    footer: 'Automatische Nachricht vom Google-Ads-Script',
    noRules: 'Keine aktiven Regeln gefunden.'
  }
};

function sendSummaryMail(results, problems, context) {
  const recipients = NOTIFY_EMAILS.map(e => String(e).trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/@example\.com$/i.test(e));

  if (recipients.length === 0) {
    console.log('E-mail: no recipients configured.');
    return;
  }

  const html = buildMailHtml(results, problems, context);

  if (!html) {
    console.log('E-mail: nothing changed - not sent.');
    return;
  }

  try {
    MailApp.sendEmail({ to: recipients.join(','), subject: html.subject, htmlBody: html.body, name: SCRIPT_NAME });
    console.log(`E-mail sent to ${recipients.join(', ')}.`);
  } catch (e) {
    console.warn(`E-mail could not be sent: ${e.message}`);
  }
}

// Pure function (apart from formatting): returns { subject, body } or null if nothing to report
function buildMailHtml(results, problems, context) {
  const t = I18N[EMAIL_LANGUAGE] || I18N.en;
  const lang = EMAIL_LANGUAGE === 'de' ? 'de' : 'en';
  const fmt = (v, d) => formatNumber(v, d, lang);
  const money = v => `${fmt(v, 2)} ${context.currency}`;
  const allTerms = results.reduce((list, r) => list.concat(r.terms), []);
  const sum = key => allTerms.reduce((n, x) => n + (x[key] || 0), 0);
  const errorCount = results.reduce((n, r) => n + r.errors.length, 0) + problems.length;
  const protectedCount = results.reduce((n, r) => n + r.protectedTerms.length, 0);
  const attachedCount = results.reduce((n, r) => n + r.attachedCampaigns.length, 0);
  const allTest = results.length > 0 && results.every(r => r.testMode);
  const anyTest = results.some(r => r.testMode);

  if (allTerms.length + attachedCount + errorCount === 0 && !SEND_EMAIL_IF_NOTHING_CHANGED) {
    return null;
  }

  // Subject
  const parts = [];
  if (allTerms.length > 0) {
    parts.push(allTest ? t.subjectPlanned(allTerms.length) : t.subjectChanged(allTerms.length));
  }
  if (errorCount > 0) {
    parts.push(t.subjectErrors(errorCount));
  }
  const subject = `${allTest ? t.testPrefix : ''}${SCRIPT_NAME} | ${context.accountName}: ${parts.length ? parts.join(', ') : t.subjectNone}`;

  // Body
  let body = mailTiles([
    { value: fmt(allTerms.length), label: allTest ? t.tileTermsTest : t.tileTerms },
    { value: fmt(sum('impressions')), label: t.tileImpr },
    { value: fmt(sum('clicks')), label: t.tileClicks },
    { value: money(sum('cost')), label: t.tileCost },
    { value: fmt(protectedCount), label: t.tileProtected },
    { value: fmt(errorCount), label: t.tileErrors, color: errorCount > 0 ? '#c0392b' : null }
  ]) + mailNote(t.metricsNote);

  if (problems.length > 0) {
    body += mailHeading(t.general);
    problems.forEach(p => { body += mailNote(`${t.warning}: ${p}`, '#7a5a00'); });
  }

  if (results.length === 0) {
    body += mailNote(t.noRules, '#7a5a00');
  }

  for (const r of results) {
    const share = r.checked > 0 ? ` (${fmt(100 * r.irrelevant / r.checked, 1)} %)` : '';
    const title = `${r.rule.listName}  ←  ${r.rule.campaignFilter || '*'}`;
    body += mailHeading(title, `${t.ruleSub(fmt(r.irrelevant), fmt(r.checked))}${share}`);

    if (r.testMode && !allTest) {
      body += mailNote(t.testRule, '#7a5a00');
    }

    if (r.terms.length > 0) {
      body += mailTable(
        [{ title: t.colTerm }, { title: t.colImpr, align: 'right' }, { title: t.colClicks, align: 'right' }, { title: t.colCtr, align: 'right' }, { title: t.colCost, align: 'right' }],
        r.terms.slice(0, EMAIL_MAX_TERMS_PER_RULE).map(x => [
          x.negative && x.negative.charAt(0) === '"' ? `${x.term}  →  ${x.negative}` : x.term,
          fmt(x.impressions), fmt(x.clicks),
          x.impressions > 0 ? fmt(100 * x.clicks / x.impressions, 2) : '-',
          fmt(x.cost, 2)
        ]));

      if (r.terms.length > EMAIL_MAX_TERMS_PER_RULE) {
        body += mailNote(t.more(r.terms.length - EMAIL_MAX_TERMS_PER_RULE, !!context.spreadsheet));
      }
    }

    if (r.listCreated) {
      body += mailNote(t.listCreated(r.rule.listName), '#1d2530');
    }

    if (r.attachedCampaigns.length > 0) {
      const names = r.attachedCampaigns.slice(0, 10).join(', ') + (r.attachedCampaigns.length > 10 ? ', ...' : '');
      body += mailNote(t.attached(r.testMode, r.attachedCampaigns.length, names), '#1d2530');
    }

    if (r.alreadyExcluded > 0) {
      body += mailNote(t.alreadyExcluded(fmt(r.alreadyExcluded)));
    }

    if (r.protectedTerms.length > 0) {
      body += mailNote(`${t.protected(r.protectedTerms.length)} ${r.protectedTerms.slice(0, 10).map(x => `${x.term} (${x.reason})`).join(', ')}${r.protectedTerms.length > 10 ? ', ...' : ''}`);
    }

    if (r.skippedTerms.length > 0) {
      body += mailNote(`${t.skipped(r.skippedTerms.length)} ${r.skippedTerms.slice(0, 5).map(x => `${x.term} (${x.reason})`).join(', ')}${r.skippedTerms.length > 5 ? ', ...' : ''}`, '#7a5a00');
    }

    r.errors.forEach(e => { body += mailNote(`${t.error}: ${e}`, '#c0392b'); });
    r.warnings.forEach(w => { body += mailNote(`${t.warning}: ${w}`, '#7a5a00'); });
  }

  return {
    subject: subject,
    body: mailLayout({
      title: `${SCRIPT_NAME} · ${context.accountName} (${context.accountId})`,
      subtitle: allTest ? t.subtitleTest : t.subtitleLive,
      banner: anyTest && allTest ? t.banner : '',
      bodyHtml: body,
      sheetLink: context.spreadsheet ? `<a href="${escapeHtml(context.spreadsheet.getUrl())}" style="color:#1f3a5f;">${escapeHtml(t.openSheet)}</a> &middot; ` : '',
      footer: `${t.footer} ${SCRIPT_NAME} v${SCRIPT_VERSION} &middot; ${escapeHtml(Utilities.formatDate(context.startedAt, context.timeZone, 'yyyy-MM-dd HH:mm'))} &middot; <a href="${SCRIPT_URL}" style="color:#5a6472;">adtraffic.de</a>`
    })
  };
}

// --- HTML helpers (inline CSS + tables, so it renders in Gmail and Outlook) --

function escapeHtml(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function round(value, digits) {
  const f = Math.pow(10, digits);
  return Math.round((value || 0) * f) / f;
}

function formatNumber(value, digits, lang) {
  if (value === undefined || value === null || value === '' || isNaN(value)) {
    return '-';
  }

  const parts = Number(value).toFixed(digits || 0).split('.');
  const thousands = lang === 'de' ? '.' : ',';
  const decimal = lang === 'de' ? ',' : '.';
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return parts.join(decimal);
}

function mailTiles(tiles) {
  const width = Math.floor(100 / tiles.length);
  const cells = tiles.map(x =>
    `<td width="${width}%" align="center" valign="top" style="padding:12px 4px;background:#f2f5f9;border-radius:6px;">` +
    `<div style="font-size:20px;font-weight:bold;color:${x.color || '#1f3a5f'};">${escapeHtml(x.value)}</div>` +
    `<div style="font-size:12px;color:#5a6472;margin-top:3px;">${escapeHtml(x.label)}</div></td>`).join('');
  return `<table width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate;"><tr>${cells}</tr></table>`;
}

function mailTable(columns, rows) {
  const cell = 'padding:4px 10px;border:1px solid #d0d0d0;';
  const head = columns.map(c => `<th align="${c.align || 'left'}" style="${cell}background:#f0f0f0;white-space:nowrap;">${escapeHtml(c.title)}</th>`).join('');
  const body = rows.map(row => '<tr>' + columns.map((c, i) => `<td align="${c.align || 'left'}" style="${cell}">${escapeHtml(row[i])}</td>`).join('') + '</tr>').join('');
  return `<table width="100%" style="border-collapse:collapse;font-size:13px;"><tr>${head}</tr>${body}</table>`;
}

function mailHeading(text, sub) {
  return '<div style="margin:24px 0 8px;font-size:15px;font-weight:bold;color:#1f3a5f;border-bottom:2px solid #1f3a5f;padding-bottom:4px;">' +
    `${escapeHtml(text)}${sub ? ` <span style="font-weight:normal;font-size:12px;color:#5a6472;">${escapeHtml(sub)}</span>` : ''}</div>`;
}

function mailNote(text, color) {
  return `<div style="margin:6px 0 0;font-size:12px;color:${color || '#5a6472'};">${escapeHtml(text)}</div>`;
}

function mailLayout(o) {
  const banner = o.banner ? `<tr><td style="background:#fff4d6;color:#7a5a00;padding:10px 24px;font-size:13px;">${o.banner}</td></tr>` : '';

  return '<html><body style="margin:0;padding:0;background:#e9edf2;font-family:Arial,Helvetica,sans-serif;color:#1d2530;">' +
    '<table width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 10px;">' +
    '<table width="720" cellspacing="0" cellpadding="0" style="max-width:720px;width:100%;background:#ffffff;border-radius:8px;">' +
    '<tr><td style="background:#1f3a5f;color:#ffffff;padding:18px 24px;border-radius:8px 8px 0 0;">' +
    `<div style="font-size:19px;font-weight:bold;">${escapeHtml(o.title)}</div>` +
    `<div style="font-size:13px;color:#c9d6e8;margin-top:4px;">${escapeHtml(o.subtitle)}</div></td></tr>` +
    banner +
    `<tr><td style="padding:16px 24px 24px;font-size:14px;line-height:1.45;">${o.bodyHtml}</td></tr>` +
    '<tr><td style="padding:12px 24px;background:#f2f5f9;border-radius:0 0 8px 8px;font-size:12px;color:#5a6472;">' +
    `${o.sheetLink}${o.footer}</td></tr>` +
    '</table></td></tr></table></body></html>';
}

// Allows running the unit tests with Node.js (ignored by Google Ads)
if (typeof module !== 'undefined') {
  module.exports = { buildPlan, toNegativeKeyword, parseRuleRows, validateRules, buildMailHtml, main };
}
