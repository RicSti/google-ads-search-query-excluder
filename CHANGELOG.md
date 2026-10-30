# Changelog

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
