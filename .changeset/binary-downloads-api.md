---
'@qtsurfer/sdk': minor
---

Add `qts.tickers({ exchangeId, base, quote, hour, format? })` and `qts.klines(...)` — stream one hour of raw tickers or klines as a `Blob`. Wire format selectable via `format: 'lastra' | 'parquet'` (Lastra default; Parquet via on-the-fly conversion). HTTP errors surface as `QTSDownloadError`, a new subclass of `QTSError`.
