# Search Query Excluder – Google Ads Script

Keeps broad match and AI Max campaigns on topic: every search term that does **not** match your *positive pattern* (a regular expression describing what you actually want) is added as an `[exact match]` negative to a shared negative keyword list.

Runs inside a single Google Ads account. No API keys, no external services.

## Features

- **Positive list instead of endless negative lists** – define what is relevant, everything else gets excluded
- **Multiple rules per account**, e.g. one per campaign group, each with its own list, pattern, date range and threshold
- **Configuration in the script or in a Google Sheet** (handy for many rules or for non-technical colleagues)
- **Dry run** globally or per rule (`mode = test`)
- **HTML summary e-mail** (English or German) with excluded terms, impressions, clicks, cost and CTR
- **Log tab** in the Google Sheet with every excluded, skipped and protected term
- **Safety nets**
  - terms with conversions are never excluded
  - terms identical to one of your own keywords are never excluded
  - a rule is skipped if a suspiciously high share of terms would be excluded (broken pattern)
  - max. number of new negatives per rule and run, 5,000-negatives-per-list limit respected
  - invalid terms are rejected individually instead of breaking the whole run
- **Creates the negative keyword list** if missing and **attaches it** to all campaigns matching the rule
- Umlaut-tolerant matching (`maenner` in the pattern also matches `männer`)
- Terms longer than Google's limit (80 characters / 10 words) are added as `"phrase match"` of their first words – a shortened exact negative would not block anything

## Quick start

1. In Google Ads open **Tools → Bulk actions → Scripts** and create a new script.
2. Paste the content of [`search-query-excluder.js`](search-query-excluder.js).
3. Edit the `SETTINGS` block at the top:
   - `RULES` (or `SPREADSHEET_URL`, see below)
   - `NOTIFY_EMAILS`
4. Click **Authorize**, then **Preview**. `DRY_RUN = true` is the default, so nothing is changed.
5. Check the log and the e-mail. If the result is plausible, set `DRY_RUN = false` and schedule the script (daily is a good start).

## Rules

| Field | Meaning | Example |
|---|---|---|
| `campaignFilter` | Campaign name, `%` = wildcard, empty = all campaigns. GAQL `LIKE` semantics (`_` matches any single character). | `%AI Max%` |
| `listName` | Shared negative keyword list (created if missing) | `SQE - AI Max negatives` |
| `positivePattern` | Regular expression, case-insensitive. Terms that match are **kept**. | `(shoe\|sneaker)s?` |
| `dateRange` | `LAST_7_DAYS`, `LAST_14_DAYS`, `LAST_30_DAYS`, `LAST_MONTH`, … or a number of days | `LAST_30_DAYS` / `90` |
| `minImpressions` | Only terms with at least this many impressions (summed over all campaigns), default `2` | `2` |
| `mode` | `live` or `test` | `live` |
| `active` | `false` = ignore rule | `true` |

Pattern tips:

- Require two concepts at once: `(brand1|brand2).*(product1|product2)|(product1|product2).*(brand1|brand2)`
- Your pattern must cover **all** your keywords' intent – anything not matching will be excluded across all campaigns the list is attached to.
- Test patterns on [regex101.com](https://regex101.com) (flavor: ECMAScript).

### Option A: rules in the script

```js
const SPREADSHEET_URL = '';
const RULES = [
  { campaignFilter: '%AI Max%', listName: 'SQE - AI Max', positivePattern: 'shoe|sneaker', dateRange: 'LAST_30_DAYS', minImpressions: 2, mode: 'live', active: true },
  { campaignFilter: 'Brand%',   listName: 'SQE - Brand',  positivePattern: 'mybrand|my brand', mode: 'test' }
];
```

Empty fields fall back to the defaults (`LAST_30_DAYS`, `2`, `live`, active).

### Option B: rules in a Google Sheet

1. Create an empty Google Sheet and put its URL into `SPREADSHEET_URL`.
2. Run the script once – it creates the tab `rules` with the header row.
3. Add one row per rule. Columns: `active | campaignFilter | listName | positivePattern | dateRange | minImpressions | mode | notes`
4. From now on every run appends to the tab `log`.

Column order does not matter, the script finds the columns by their header names.

## Settings reference

| Setting | Default | Description |
|---|---|---|
| `DRY_RUN` | `true` | Report only, change nothing |
| `SPREADSHEET_URL` | `''` | Use rules from a Google Sheet |
| `NOTIFY_EMAILS` | – | Recipients of the summary e-mail |
| `SEND_EMAIL_IF_NOTHING_CHANGED` | `false` | Also send a mail when nothing happened |
| `EMAIL_LANGUAGE` | `'en'` | `'en'` or `'de'` |
| `EMAIL_MAX_TERMS_PER_RULE` | `50` | Terms listed per rule in the mail |
| `PROTECT_CONVERTING_TERMS` | `true` | Never exclude terms with conversions |
| `PROTECT_OWN_KEYWORDS` | `true` | Never exclude terms identical to own keywords |
| `MAX_EXCLUDE_SHARE` | `0.95` | Skip a rule if more than this share would be excluded (`1` = off) |
| `MAX_NEW_NEGATIVES_PER_RULE` | `1000` | Limit per rule and run, the rest follows next run |
| `ATTACH_LIST_TO_CAMPAIGNS` | `true` | Attach the list to all matching campaigns |
| `MATCH_TRANSLITERATED` | `true` | ä/ö/ü/ß-tolerant pattern matching |
| `LONG_TERM_HANDLING` | `'phrase'` | `'phrase'` or `'skip'` for terms over 80 chars / 10 words |

## Good to know

- Only search terms that Google reports in the *Search terms* report are considered (low-volume terms may be hidden by Google).
- Negatives are added to **shared lists**. Google allows max. 5,000 negatives per list and 20 lists per account.
- Lists are only attached to campaigns returned by `AdsApp.campaigns()` (Search / Display). Attach lists to other campaign types manually if needed.
- The script runs in a single account. For manager accounts (MCC) run it in each client account.

## Development

The script has no dependencies. Tests run with Node.js and mocked Google Ads objects:

```bash
node test/run-tests.js
```

The test writes a preview of the e-mail to `test/output/mail.html`.

## License

[MIT](LICENSE) © 2026 [adtraffic](https://www.adtraffic.de)

Use at your own risk. Always start with `DRY_RUN = true`.
