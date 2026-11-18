# Changelog

## 1.1.0 – 2026-11-18

- **Coverage check against the live list:** a search term is no longer added if a negative of the list already blocks it – not only an identical `[exact]` negative, but also a `"phrase"` or broad negative (Google's negative matching, whole words, no close variants). Fixes the loop with the [Search Query Negatives Consolidator](https://github.com/RicSti/google-ads-search-query-negatives-consolidator): `[karate landshut]` is no longer re-added after it was consolidated into `"karate"`. Manually added phrase / broad negatives are respected the same way. No log or sheet is needed – the list itself is the source of truth.
- Negatives planned in the same run count as well (no duplicate phrase negatives for long terms).
- Summary e-mail: "already blocked" note with examples and the blocking negative (`karate landshut ← "karate"`).

## 1.0.0 – 2026-10-30

First public release as a single-account script (based on an internal MCC version).

- Rules in the script or in a Google Sheet (tabs `rules` and `log` are created automatically)
- Dry run globally and per rule
- HTML summary e-mail (en/de)
- Safety nets: converting terms, own keywords, max. exclude share, per-run and per-list limits
- Creates and attaches the negative keyword list
- Impression threshold applied to the summed term (not per ad group)
- Deduplication of terms and of negatives already in the list
- Long terms become phrase match negatives instead of non-blocking shortened exact negatives
