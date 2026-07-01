# Massive API 取数与 KMV 输入计算简明教程

## 1. 目标与环境变量

目标公司：

```python
TICKERS = ["COST", "KO", "DELL", "ORCL", "PNC", "WMT", "INTU", "AMZN", "T", "KHC"]
```

API key 只从环境变量读取：

```bash
export MASSIVE_API_KEY="..."
```

不要把 key 写进代码、日志、CSV 或 JSON。

## 2. Massive 接口

基础地址：`https://api.massive.com`

### 2.1 最近 8 个季度资产负债表

```text
GET /stocks/financials/v1/balance-sheets
```

```python
params = {
    "tickers": ticker,
    "timeframe": "quarterly",
    "limit": 8,
    "sort": "period_end.desc",
}
```

### 2.2 日频股价

```text
GET /v2/aggs/ticker/{ticker}/range/1/day/{from_date}/{to_date}
```

```python
params = {"adjusted": "true", "sort": "asc", "limit": 50000}
```

返回的 `c` 是拆股复权收盘价，不是直接的分红复权价。

### 2.3 分红

```text
GET /stocks/v1/dividends
```

```python
params = {
    "ticker": ticker,
    "ex_dividend_date.gte": from_date,
    "ex_dividend_date.lte": to_date,
    "limit": 1000,
    "sort": "ex_dividend_date.desc",
}
```

关键字段：`ex_dividend_date`、`cash_amount`、`historical_adjustment_factor`。

### 2.4 最新公司信息和股数

```text
GET /v3/reference/tickers/{ticker}
```

股数优先使用 `weighted_shares_outstanding`，缺失时退回 `share_class_shares_outstanding`。

## 3. 财务字段映射

| 目标指标 | Massive 字段 |
|---|---|
| 财务期末日 | `period_end` |
| 报表披露日 | `filing_date` |
| 总资产 | `total_assets` |
| 总负债 | `total_liabilities` |
| 流动负债 | `total_current_liabilities` |
| 短期债务 | `debt_current` |
| 长期债务 | `long_term_debt_and_capital_lease_obligations` |
| 现金及现金等价物 | `cash_and_equivalents` |
| 归母股东权益 | `total_equity_attributable_to_parent` |

所有财务字段都可能缺失。缺失值保存为 `None`/`NaN`，不能自动当成 0。

## 4. 债务指标计算

### 4.1 Total debt

```python
if debt_current is not None and long_term_debt is not None:
    total_debt = debt_current + long_term_debt
else:
    total_debt = None
```

长期债务字段包含资本租赁负债，输出名称建议使用：

```text
derived_total_debt_including_capital_leases
```

不要用 `total_liabilities` 代替 total debt。

### 4.2 KMV default point

常用 KMV 近似：

```python
default_point = debt_current + 0.5 * long_term_debt
```

只有两个债务分项都存在时才计算。

### 4.3 当前实测注意事项

- COST：`debt_current` 缺失，不能严格计算 total debt 或 default point。
- AMZN：`debt_current` 缺失，不能严格计算 total debt 或 default point。
- INTU：最新季度可计算，但 8 个季度中只有 7 个季度分项完整。
- PNC：两个债务字段都有，最新派生 total debt 为 66.666B；但它是银行，存款负债没有进入上述普通公司债务公式，模型解释时要单独标记。

## 5. 分红复权收盘价

Massive 的 `historical_adjustment_factor` 是累计分红调整因子。

对每一个价格日期 `D`：

1. 找到 `ex_dividend_date > D` 的第一条分红记录；
2. 使用该记录的 `historical_adjustment_factor`；
3. 没有未来除息记录时因子取 1；
4. 计算分红复权价。

```python
dividend_adjusted_close = split_adjusted_close * historical_adjustment_factor
```

示例：

```python
dividends = sorted(dividends, key=lambda x: x["ex_dividend_date"])

for price in prices:
    price_date = price["date"]
    factor = next(
        (
            d["historical_adjustment_factor"]
            for d in dividends
            if d["ex_dividend_date"] > price_date
        ),
        1.0,
    )
    price["dividend_adjusted_close"] = price["c"] * factor
```

除息日当天已经以除息状态交易，因此判断使用严格大于 `>`，不要使用 `>=`。AMZN 没有分红，因子始终为 1。

## 6. 股权市值和波动率

### 6.1 股权市值

```python
equity_value_t = dividend_adjusted_close_t * weighted_shares_outstanding
```

把最新股数用于整个历史窗口只是近似。若后续需要精确历史市值，应改用季度或每日历史股数并做 as-of merge。

### 6.2 日对数收益率

```python
log_return_t = log(price_t / price_t_minus_1)
```

### 6.3 年化股权波动率

```python
equity_volatility = std(log_returns, ddof=1) * sqrt(252)
```

计算前必须：按日期升序、去重、去掉空值和非正价格，并至少保留约 60 个有效交易日。

## 7. 建议输出

原始 JSON 保留 API 响应和派生数据：

```json
{
  "responses": {
    "balance_sheet": {},
    "prices": {},
    "dividends": {},
    "ticker_overview": {}
  },
  "derived": {
    "quarterly_total_debt": [],
    "daily_dividend_adjusted_prices": []
  }
}
```

季度输出至少包括：

```text
ticker
period_end
filing_date
debt_current
long_term_debt_and_capital_lease_obligations
derived_total_debt_including_capital_leases
default_point
total_assets
total_liabilities
cash_and_equivalents
total_equity_attributable_to_parent
```

日频输出至少包括：

```text
ticker
date
split_adjusted_close
dividend_adjustment_factor
dividend_adjusted_close
weighted_shares_outstanding
equity_value
log_return
```

## 8. 错误处理与验证

- 一个 endpoint 失败不能中断其他 endpoint 或 ticker。
- HTTP 403 记录为权限问题；HTTP 429 按 `Retry-After` 等待。
- Basic 市场数据常见限制为 5 calls/min，可设置至少约 12.5 秒请求间隔。
- 每个 ticker 检查是否返回 8 个季度。
- 检查价格日期是否覆盖预期交易日。
- 对所有非空 total debt 验证：

```python
assert total_debt == debt_current + long_term_debt
```

- 对所有复权价验证：

```python
assert dividend_adjusted_close == split_adjusted_close * factor
```

## 9. 现有参考实现

工作区已有：

```text
test_massive_api.py
test_test_massive_api.py
massive_api_test_summary.csv
massive_api_raw_samples/
```

Claude Code 应优先复用这些代码，不要重新搭建复杂 pipeline。

