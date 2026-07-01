# Massive API 最小验证设计

## 目标

用用户提供的 Massive API key 验证 10 家公司的季度资产负债表、短期日价、分红和最新股数是否可访问，并检查 KMV 所需字段的真实名称与缺失情况。

## 范围

- Tickers：COST、KO、DELL、ORCL、PNC、WMT、INTU、AMZN、T、KHC。
- 资产负债表：最多 8 个季度。
- 日价和分红：先取最近约 6 个月，避免免费层时间或调用限制。
- 公司信息：最新 Ticker Overview 股数。
- 不做数据库、SEC fallback、as-of merge 或完整 KMV pipeline。

## 接口

- `/stocks/financials/v1/balance-sheets`
- `/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}`
- `/stocks/v1/dividends`
- `/v3/reference/tickers/{ticker}`

## 输出与安全

- `massive_api_test_summary.csv`
- `massive_api_raw_samples/{ticker}.json`
- 每个 endpoint 独立容错；失败记录后继续。
- API key 仅通过进程环境传入，不保存到脚本、CSV 或 JSON。

## 字段判定

检查 `period_end`、`filing_date`、`total_assets`、`total_liabilities`、`total_current_liabilities`、`debt_current`、`long_term_debt_and_capital_lease_obligations`、`cash_and_equivalents`、`total_equity_attributable_to_parent`，并检查最新 `weighted_shares_outstanding`/`share_class_shares_outstanding`。明确记录 Massive 没有直接 `total_debt` 字段，以及价格是否仅为拆股复权。

## 派生字段

- 仅在两个债务分项都非空时计算 `derived_total_debt = debt_current + long_term_debt_and_capital_lease_obligations`；缺失值不按零处理。
- Massive aggregate 的 `c` 已做拆股复权。对价格日期 D，找到 D 之后最近一次除息记录，并计算 `dividend_adjusted_close = c * historical_adjustment_factor`；不存在未来除息记录时因子为 1。
- 原始 API 响应不修改，派生季度债务与日价写入每个原始样本文件的 `derived` 区域。
