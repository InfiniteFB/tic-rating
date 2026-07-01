# Massive API Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a minimal Massive API coverage test for the ten target companies.

**Architecture:** A stdlib-only Python script calls four independent Massive endpoints per ticker, writes raw responses, and produces a flat summary. Pure summary functions are unit-tested without network access.

**Tech Stack:** Python 3 standard library, `unittest`, Massive REST API.

---

### Task 1: Pure field-summary behavior

**Files:**
- Create: `test_test_massive_api.py`
- Create: `test_massive_api.py`

- [ ] Write failing tests for field presence, response wrappers, and endpoint failure continuation.
- [ ] Run `python3 -m unittest -v test_test_massive_api.py` and verify failure because the module is missing.
- [ ] Implement the minimum summary and fetch functions.
- [ ] Re-run the tests and verify they pass.

### Task 2: CLI and artifacts

**Files:**
- Modify: `test_massive_api.py`
- Modify: `test_test_massive_api.py`

- [ ] Add failing tests for CSV and per-ticker JSON output.
- [ ] Implement environment-key loading, output writing, and concise terminal conclusions.
- [ ] Verify all unit tests pass.

### Task 3: Real API verification

**Files:**
- Create: `massive_api_test_summary.csv`
- Create: `massive_api_raw_samples/*.json`

- [ ] Probe COST without persisting the API key.
- [ ] Run all ten tickers with an approximately six-month market-data window.
- [ ] Verify 10 CSV rows, 10 valid JSON files, and absence of the API key from artifacts.
- [ ] Report actual endpoint permissions, field gaps, PNC differences, and KMV suitability.

### Task 4: Derived KMV input fields

**Files:**
- Modify: `test_massive_api.py`
- Modify: `test_test_massive_api.py`
- Regenerate: `massive_api_test_summary.csv`
- Regenerate: `massive_api_raw_samples/*.json`

- [ ] Add failing tests for strict two-component total debt calculation.
- [ ] Add failing tests for Massive cumulative dividend-factor price adjustment.
- [ ] Implement both pure derivation functions and expose their row counts/latest values in the summary.
- [ ] Preserve raw responses and place calculated rows under `derived`.
- [ ] Re-run all ten tickers with the same key and verify artifacts contain no API key.
