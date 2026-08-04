# 课件精读：Market-Based Credit Risk Rating Model for Public Companies（Course #2，113 页）

> 文件：repo 根目录 `课件.pdf`（113 slides）
> 作者：Yimin Yang（杨一民），Duke University Executive In Residence；曾在美国大型银行负责信用评级建模，后任社区银行 Chief Credit Officer
> 场合：PFPA Training Course "To Prepare for working in Financial Industry — An In-depth Introduction Best Real World Practices"，Course #2
> 姊妹材料：`knowledge/notes/paper-tic-30p-draft.md`（30 页论文）、`knowledge/notes/yang-memo-20260618.md`（口述纪要）
> 本笔记由 agent 逐页精读并对每个数值例子做了独立复算（2026-07-31）。凡"已复算"字样均指用 `.venv` Python 按课件自身给出的输入重跑过。

**读这份课件前必须知道的一件事**：它是 *讲课用的骨架*，不是自洽的技术文档。KMV 那一段（slide 90–108）严密到可以直接照抄成代码；TiC/TTC 那一段（slide 81–89、97、113）是把论文的结论摘出来贴上去，**推导全部省略，且至少有 4 处公式或数值与课件自身其他页面对不上**（见第 6 节）。项目引擎之所以能跑通，是因为把课件缺的部分从论文和教授的答案 Excel 里补回来了。

---

## 1. 课件全景：章节地图

| Slides | 章节 | 主题 | 在方法链中的位置 |
|---|---|---|---|
| 1–3 | 封面 / 免责 / 目录 | Contents 承诺 6 章 | — |
| 4–13 | Introduction to Credit Risk Management | 信用风险为何是银行第一大风险；Basel II / CECL / 压力测试 / 模型风险都围绕 Credit Rating；2012 SEC 报告；三类评级生产者 | **问题意识**：为什么需要一个统一评级 |
| 14–16 | Large Language Model | token / decoder / encoder / attention / context window | 与评级无关，是"AI 素养"铺垫 |
| 17–31 | What Is Algorithm | 长除法、割圆术、Hilbert–Turing–Rice、**Newton 求根**、一个手写"训练"例子 | **数学工具铺垫**：为后面的二分法反解 + EM 迭代做直觉准备 |
| 32–35 | What Is Neural Network | 人脸识别的 token 分解、权重、全连接图 | 同上 |
| 36–48 | Information contained in stock price | 股票=公司所有权切片；EMH 与 Fama；债券市场；收益率曲线；利率-债价反向关系 | **输入的合法性**：凭什么可以从股价读出信用 |
| 49–50 | Three Stages Bank Credit Risk Management | Linear / Extreme / Systemic 三阶段；损失分布上 EL=Allowance、尾部=Capital | **监管落地**：评级最终服务于拨备与资本 |
| 51–59 | Market value of a company | Book / Market / Future value；风险中性概率；`Asset = Liabilities + Equity`；`Equity = Asset − Debt`；**资产不可观测** | **核心难题的提出** |
| 60–66 | Option pricing theory | 布朗运动（Brown 1827 → Einstein 1905 → Wiener 1923 → Ito 1944）；Price=Pollen 类比；BSM 公式 | **数学机器** |
| 67–69 | Credit rating theories | 需要资产的未来分布 + 落到债务以下的概率；资产不可观测 → Merton 看涨期权关系 → 反解资产 | **桥梁** |
| 70–75 | KMV 与作者自述 | DD/EDF 是 KMV 首创；Moody's 花 $220mm 收购；KMV 的病；Xerox 实战案例；作者转向 TiC | **动机转折点** |
| 76–89 | A Universal TiC Rating Model | 行业问题清单；SEC 原文；Behavior-Specific + 两个驱动因子；μ、CCM、TiC 定义；三种评级体系的 TiC 表达 | **理论层** |
| 90–97 | KMV Rating Method | 假设、参数、方程、输入、算法、DD/EDF 公式、TiC 公式 | **模型规格** |
| 98–108 | Deriving KMV and TIC ratings | 取数、处理、E2D 序列、g 函数、二分法、EM 三步、收敛、最终公式 | **可执行算法（本项目引擎的直接来源）** |
| 109–112 | Credit rating examples | MSFT 全流程数值示例 | **验收基准** |
| 113 | Credit rating examples（续） | 只有一行标题 "TIC can be converted to S&P TTC PD"，**正文空白** | **本应是 PIT→TTC 那一章，实际缺失** |

**目录承诺 vs 实际交付（slide 3）**：目录列了 6 条，其中 `LLM/AI/Function calling(context engineering)/MCP/python fastMCP/MCP SDK`、`Data and Automation`、`AI Implementation Automation`、`Rating Conversion: PIT to TTC` 四条在正文里**几乎或完全没有对应内容**（LLM 只讲到 slide 16 的 token/attention，MCP 一页没有；PIT→TTC 只有 slide 113 的一行标题）。写讲解页时不要假设课件覆盖了 TTC 转换——它没有。

---

## 2. 逐章精读

### 2.1 问题意识：为什么"统一评级"是个真问题（slide 4–13）

**核心论点**：信贷是银行 80–90% 的资产（s5），Basel II 资本、CECL 拨备、压力测试、模型风险管理**全部围绕 Credit Rating 建立**（s6–7）。所以评级不一致不是学术趣味，是监管资本被算错。

三类生产者，三种哲学（s10）：

| 生产者 | 作者的分类 | 数据基础 | 信用视角 |
|---|---|---|---|
| Rating agencies（Moody's/S&P/Fitch） | Process-specific | 定性流程 + 专家 | 介于两者之间 |
| Banks | Distribution-Specific | 历史数据 | **TTC** |
| Academic Researchers | Default-Specific | 市场数据 | **PIT** |

- s8：`"They may use different data and different approaches so all ratings are not fully comparable."`
- s9：2012 SEC 向国会报告，问"能不能统一"，列出三种不一致（跨机构、同一机构跨时间、PIT vs TTC），`"SEC's answer: seems impossible"`。**这句"seems impossible"是全课件的戏剧支点**——后面 slide 79 作者说"我给自己定了个目标"，就是直接回应它。
- s11：Moody's B 级历年历史违约率表（2001 9.8% → 2007 0.0% → 2009 7.6% → 2011 0.1%）。同一个字母，PD 差两个数量级。这张表在 s78 又出现一次，是"评级 ≠ PD"的经验证据。
- s12：银行评级=历史数据+Logistic/Probit 回归；商业信贷（大/公众/私有/中/小企业）标了红字 `No Data??`——这是"数据不存在"的第一次点题（口述纪要里的"全世界就一个 IBM"）。
- s13：学术方法 = 市场数据 + 违约理论（资产跌破债务），但 `Very unstable`、`Difficult to translate into bank ratings`。例子就是 KMV EDF，其理论基石是 `Equity is a Call Option with Debt being the strike`。

**衔接**：第 4–13 页把"三种评级互不相通"摆上台，第 76–89 页给出统一方案，中间的 14–69 页是补数学工具。

### 2.2 算法与 AI 的插曲（slide 14–35）

看似离题，实际是**为 slide 102–106 的二分法 + EM 迭代做直觉铺垫**，而且是作者的方法论宣言。

- Newton 求根（s23–26）：`f(x) = 0.1x³ − 0.25x − 1 = 0`，迭代式 `x_next = x_prev − (0.1x³_prev − 0.25x_prev − 1)/(0.3x²_prev − 0.25)`，从 x₀ = −2.5 出发经 3.629 → 7.277 → 5.832 → 5.280 → 5.191 → **5.189** 收敛（s24 的表，已复算路径合理）。s26 一句话总结：`"Newton's Root Finding Algorithm is to walk blindfolded"`。
- s28–31 的"训练例子"其实不是梯度下降，是**带符号翻转的二分搜索**：`w_{k+1} = w_k − S_k/2`，算 `D_{k+1}` 和 `(D_{k+1}−D_k)/(w_{k+1}−w_k)`，取其符号 `S_{k+1}`。先找到 w_b = 2，再找到 w_a = 0.5，输出 `Y = 0.5X³ + 2X`。**这套"步长减半 + 看符号"正是 slide 103 二分法的同一套思想**。
- s21：`"What's powerful is the knowledge behind algorithm, not its execution. AI is the execution of algorithms."`
- s22：Hilbert 1928 判定问题 → Turing 1936 不可计算性 → `"Decision process is NOT an algorithm"`；Rice 定理："图灵机无法回答关于其他图灵机行为的问题"。**这是作者对 AI 边界的立场**：AI 执行算法，不产生算法；决策不是算法。

**衔接**：s26 的"蒙眼走路"→ s103 的二分法；s28–31 的迭代表 → s104–106 的 EM 迭代表。

### 2.3 股价里有什么（slide 36–48）

- s40–41：股价 = 公司所有未来现金流的现值；EMH 三条：`Price is "randomly walking" around the expected value`、`Today's price is the best forecast for tomorrow's price`、`Price reflects all available information`。
- s42：Fama 1965 博士论文，2013 诺奖。
- s45：信用风险的两种缓释——抵押（有 Recovery Risk）与信用评级（无抵押）。明确定位：`Senior Unsecured Ratings for companies – Default ratings`，`This model is for Default Ratings`。**即本模型算的是"违约评级"，不含 LGD/回收。**
- s46–48：收益率曲线（正常 vs 倒挂）、利率与债价反向。这一段为 slide 101 的 `D·e^{−rτ}` 折现提供直觉。

### 2.4 公司价值与不可观测资产（slide 49–59）

- s49：三阶段风险管理框架（Linear/Pre-CRO 会计 → Extreme/Basel 资本 → Systemic/压力测试），并给出会计的两条硬约束：`Additive`、`Cannot book things have not happened, no future items`。**这解释了为什么会计资产 ≠ 市场资产**。
- s50：损失分布图——EL 是 Allowance，EL 到极端分位之间是 Capital，尾部面积是银行自身的倒闭概率（举例 0.1%）。
- s54：会计不含概率（成本摊销）；市场用 **Risk-Neutral Probabilities**（无套利定价）；经验概率可用但与市场价不一致。
- s55（**全课件最关键的一页设问**）：
  - `Asset = Liabilities + Equity` 是会计资产，不是市场资产。
  - 公众公司有 Market Equity（股票）和 Market Value of Asset：`Equity = Asset − Debt`。
  - `"The Problem: Asset is the market value and is not observable, Debt is to be paid in the future, the Equity is observed today"` —— 三个量三种时点/可观测性，这就是整个模型要解的方程。
- s59：Merton 的答案：`Equity is a Call option on the Asset with Debt being the Strike`。

### 2.5 期权定价与布朗运动（slide 60–66）

- 历史线：Brown 1827 观察花粉 → Einstein 1905 扩散方程 `ρ(x,t) = N/√(4πDt) · e^{−x²/(4Dt)}`（s62，并强调"位移正比于时间平方根"）→ Wiener 1923 → Ito 1944 → Feynman 1948。
- s63 的"祛魅"：花粉直径约 1/1000 米，水分子小 10000 倍，温度导致分子运动，每秒百万次碰撞。
- s64 的类比（讲解页可直接用）：`Price = Pollen`，`Individual Investors = Molecules`，`Trades by Individual Investors determine the price: Molecules collide Pollens`，`Therefore Random Walk is applicable to stocks`。
- s66：BSM 看涨期权公式
  $$C = P\,\Phi\!\left(\frac{\ln\frac{P}{K} + (r + \frac{\sigma^2}{2})T}{\sigma\sqrt{T}}\right) - K e^{-rT}\,\Phi\!\left(\frac{\ln\frac{P}{K} + (r - \frac{\sigma^2}{2})T}{\sigma\sqrt{T}}\right)$$

### 2.6 KMV 的病与作者的转向（slide 68–75）

- s68–69 把逻辑链摆清楚：要知道资产会不会跌破债务 → 需要资产未来值 + 概率 + 演化规律（布朗运动）→ 但资产不可观测 → Merton 说资产与股权之间有看涨期权关系 → 该关系可用 BSM 描述 → **用它从股权反解资产** → 再用随机微积分算跌破概率 → 得评级。
- s71（KMV 三宗罪，讲解页必用）：
  - `Most significant problem: unstable rating with huge volatility`
  - `It also changes too frequently as it is directly driven by stock prices`
  - `Not suitable for banks to use as banks often require Through-The-Cycle (TTC) ratings`
  - 同页也承认它的价值：`It is a Point-In-Time (PIT) forward looking rating that presents market's current view on the company`；`Moody's spent $220 millions to purchase KMV`。
- s72：那张"资产分布 + 评级带 + EDF 红尾"的图，是全课件最好的一张示意图（A+/A/B/C/D/Default 横线切未来资产分布）。
- s73–74（**Xerox 实战案例**）：2000 年 10 月 Xerox 商票发行失败、动用 $70 亿授信；12 月 2 日债券被降到垃圾级 Ba1；作者说自己用 PIT PD calculator 提前 5 个月预警，被老板当众表扬（s74 图上标注 "My report" → 7 Months → 降级，另标 2 Months）。**注意 s73 正文写"5 Months prior"，s74 图上标的是"7 Months"——同一事件两个数字，属于小口径不一致（见第 6 节 §6.10）。**
- s75：`"I was able to revise EDF methodology and produce stable ratings that is consistent with Bank's TTC requirements"`；方法叫 **Time-Consistent (TiC)**，`can unify all credit ratings (not just KMV rating)`。

### 2.7 TiC 理论层（slide 76–89）

**行业问题清单（s77）**，是"为什么需要 TiC"的正式陈述：各家定义/解释/方法不同 → 不一致；PIT/TTC/长短期/PD 之间**难以完整转换**；`"We know there are differences among them, but we do not have realizable methods to measure their differences"`；监管快速变化但没被纳入评级建模；`"There are many vague concepts that needs rigorous mathematical descriptions"`。

**SEC 原文（s79）**：`"It is desirable for a credit rating agency to have a standardized credit rating terminology…., However, … may not be feasible given the number and uniqueness of rating scales and differences in credit rating methodologies used by credit rating agencies"`。紧接着：`"I set an objective for myself: To establish a comprehensive credit rating theory and methodology that can address all the issues discussed early."` / `"It was completed in 2021 after 10 years of efforts"`。

**Behavior-Specific 与两个驱动因子（s81）**：
- 一个驱动 expected loss，另一个驱动 unexpected loss；对应两种信用行为：`Level of Defaults` 与 `Deterioration of Credit`；对应两项监管要求：Allowance 与 **Capital**（并注明 `this is addressed by none of existing rating approaches`）。
- 再加上两个驱动因子之间的交互。
- `"A common mistake made by many: Risk Rating is the same as Probability of Default (PD)"` ——**这是整套理论的立论前提**。

**因子一（s82）**：`"Every company will eventually default"`，只是寿命不同。设 τ 为违约时间，
$$\mu = E[\tau] \quad\text{(Expected Default Time / Life Expectancy)}$$
配一张"典型违约形状"密度图（横轴 Age(Years) 1→298，峰值约 0.9% 出现在 30 岁左右后长尾衰减）。

**因子二（s83）**：信用会像折旧/健康锈蚀一样恶化。`"But how do we measure this Corrosion? I created a Credit Corrosion Measure (CCM)"`
$$CCM = E[\tau]\cdot E[1/\tau] - 1$$
`Life Span E[τ] drives (Expected) PD`；`CCM drives credit deterioration`。

**TiC 定义（s84）**：
$$TiC\ Credit\ Rating = \frac{CCM}{\mu^{Q}} = \frac{E[\tau]\,E[1/\tau] - 1}{E^{Q}[\tau]}$$
两个自问自答：能解决前面所有问题吗——`"Answer: Yes, and a lot more"`；三大评级方法能否被视为 TiC——`"Answer: Yes, they are all special cases of TiC ratings."`

**三种体系的 TiC 表达**（本课件最重要的三页）：

| Slide | 适用对象 | 公式 |
|---|---|---|
| 85–86 | Agency Ratings | 在 $(x,y)=(\ln\mu(\tau),\ \ln CCI(\tau))$ 平面上，同一评级历年点位共线；TiC×100 即 RS。s86 给出 S&P 2005–2016 逐年 PD 与 RS，及 **Avg 行：AAA 2.7 / AA 3.5 / A 5.2 / BBB 9.9 / BB 22 / B 51 / CCC/C 155** |
| 87 | Bank Ratings | $\ln(CreditRating) = 0.75\cdot\Phi^{-1}(PD_1)\cdot\sqrt{-\tfrac{2}{3}\ln\lambda} + \tfrac{0.75}{3}\ln\lambda + \ln\!\left(\lambda^{-2/3}-1\right)$ |
| 88 / 97 | Market-driven Structural Model（PIT） | $CreditRating = \dfrac{CCM}{E^{1}[\tau]} = \dfrac{\sigma_A^2}{\ln^2(A_0/D)}$ |

s86 的红绿框在视觉上做了一个论证：AAA/AA/B 三列的 **PD 常年是 0.00%（无区分度、无法反推评级）**，而 RS 列每年都是有意义的连续数（AAA 1.2–3.5，B 39–67）。这就是"评级 ≠ PD"的图示。

s87 的 `PD is clearly different from the rating. The TiC rating reflects PD with different time periods` 是同一论点的文字版。

**s89**：`Rating Conversions between these ratings become simple and easy` / `Even government policies can be quantified`，配 μ-CCM 四象限图（`Long μ, Low PD` 向右；`High PD, low Peak(λ), High CCI` 向上；对角线是 `High PD, Bad Credit`；`High Required Confidence Level (Long-term)` 沿纵轴向下；截距是 `ln(TiCCR)`）。

**衔接**：s84 是抽象定义（τ 的分布泛函），s88/97 是结构模型下的落地形式。**从 `CCM/μ` 走到 `σ_A²/ln²(A/D)` 的推导，课件一步没写**（见 §6.4）。

### 2.8 KMV 模型规格（slide 90–97）

**组件清单（s90）**：Theory and Assumptions / Parameters（可观测 vs 不可观测）/ Relationship and Equations / Inputs（财务输入含调整 + 市场输入）/ Algorithms / Outputs。这个清单本身就是一份很好的"模型文档模板"。

**假设（s91）**：Merton + EMH（无套利、风险中性定价）+ 资产服从几何布朗运动
$$A_t = A_0\,e^{\eta_A t + \sigma_A W_t}$$

**参数（s92）**：$A_t$、$\sigma_A$（代表公司的 business risk）、$\eta_A$ 三者**不可观测**；$D$、$r$ 可观测。并注明 `Short-term debt plays bigger role than long-term debt`。

**方程（s93）**：股权的 BSM 表达
$$E = A_0\,\Phi\!\left(\frac{\ln\frac{A_0}{D}+\left(r+\frac{\sigma_A^2}{2}\right)t}{\sigma_A\sqrt{t}}\right) - D e^{-rt}\,\Phi\!\left(\frac{\ln\frac{A_0}{D}+\left(r-\frac{\sigma_A^2}{2}\right)t}{\sigma_A\sqrt{t}}\right)$$
一个方程两个未知数（$A_0$、$\sigma_A$）。两条路：加第二个方程（经典 KMV 的 $\sigma_E E = \Phi(d_1)\sigma_A A$）——`"But the solutions are less stable"`；或者**用估出来的 A 序列算标准差反过来估 $\sigma_A$**——即 EM。作者选后者。

**输入（s94）**：
- $D = (\text{short-term debt}) + 0.5\,(\text{long-term debt})$，并假设 D 在 1 年后到期
- 股价要 `add back dividends not reflected on the balance sheet`（即用分红调整后价）
- 总股数、1 年期无风险利率

**公式（s96）**：
$$DD = \frac{\ln\frac{A_0}{D} + \left(\eta_A - \frac{\sigma_A^2}{2}\right)}{\sigma_A},\qquad EDF = \Phi(-DD)$$
末尾一句 `η_A makes both unstable`——**这七个字是 TiC 存在的全部理由**：DD/EDF 里含漂移 $\eta_A$，而 $\eta_A$ 是从股价噪声里估出来的最不稳定的量；下一页的 TiC 公式里 $\eta_A$ **消失了**。课件没有明说这层因果，但两页并排就是论证。

**s97**：$TiC = \dfrac{\sigma_A^2}{\ln^2(A_0/D)}$

### 2.9 可执行算法（slide 98–108）——项目引擎的直接来源

**取数（s99）**：股价时间序列、总股数、近几个季度的资产负债表、近几个季度的 1 年期无风险利率。

**处理（s100）**：
- 用 adjusted close（复权）
- $Equity = \text{Stock Price} \times \text{Total Number of Shares}$
- $D = \text{Short-term Debt} + 0.5\times\text{Long-term Debt}$（按季）
- 一年约 250 个交易日，每天 ≈ 1/250 年
- 折现：$\text{DV of }C\text{ at }T_0 = C/(1+r)^{\tau}$，且**同页给了两个互相冲突的 τ 定义**：$\tau = \frac{\#\text{trading days between }T_0,T_1}{250}$ 与 $\tau \approx \frac{T_1-T_0}{365}$（见 §6.6）

**处理后数据（s101）**：
$$Equity_* = \{E_{t_1},\dots,E_{t_N}\},\qquad
z_{t_i} = \frac{E_{t_i}}{D_{t_i(Q)}\cdot e^{-r_{t_i(Q)}\tau_{t_i}}},\qquad
\tau_{t_i} \approx 1 - \frac{t_i - t_i(Q)}{365}$$
其中 $t_i(Q)$ 是交易日 $t_i$ 之前最近的季报日。规则：`Use the prior financials (and the risk free-rate) closest to the trading date`（**无前视偏差**，项目 `rating_inputs._as_of` 正是这条）。

**g 函数（s102）**：
$$g(x,\sigma,\tau) = x\,\Phi\!\left(\frac{\ln x + \frac{\sigma^2}{2}\tau}{\sigma\sqrt{\tau}}\right) - \Phi\!\left(\frac{\ln x - \frac{\sigma^2}{2}\tau}{\sigma\sqrt{\tau}}\right)$$
即把 BSM 股权方程按 $D e^{-r\tau}$ 归一化后的形式（$x = A/(De^{-r\tau})$，$g = E/(De^{-r\tau})$）。$g$ 对 $x$ 单调递增，故可反解 $g^{-1}$。

**二分法（s103）**：$x_{Middle} = (x_{Left}+x_{Right})/2$，按 $g(x_{Middle})$ 与目标 A 的大小更新端点。

**EM 初始步（s104，m=0）**：
$$A^{(0)}_{t_i} = E_{t_i},\qquad
R^{(0)}_{t_i} = \sqrt{250}\,\ln\frac{A^{(0)}_{t_{i+1}}}{A^{(0)}_{t_i}},\qquad
x^{(0)}_{t_i} = \frac{A^{(0)}_{t_i}}{D_{t_i(Q)}e^{-r_{t_i(Q)}\tau_{t_i}}}$$
$$\sigma^{(0)}_A = \mathrm{stdev}\{R^{(0)}_{t_i}\},\qquad R^{(0)}_A = \frac{\sum_{i=1}^{N-1}R^{(0)}_{t_i}}{N-1}$$

**E 步（s105）**：用上一轮的 $\sigma^{(m-1)}_A$ 解
$$g\!\left(x^{(m)}_{t_i},\ \sigma^{(m-1)}_A,\ \tau_{t_i}\right) = z_{t_i}
\quad\Longrightarrow\quad
A^{(m)}_{t_i} = x^{(m)}_{t_i}\cdot D_{t_i(Q)}\,e^{-r_{t_i(Q)}\tau_{t_i}}$$

**M 步（s106）**：
$$R^{(m)}_{t_i} = \sqrt{250}\,\ln\frac{A^{(m)}_{t_{i+1}}}{A^{(m)}_{t_i}},\qquad
\sigma^{(m)}_A = \mathrm{stdev}\{R^{(m)}_{t_i}\},\qquad
R^{(m)}_A = \frac{\sum_{i=1}^{N-1}R^{(m)}_{t_i}}{N-1}$$
然后 m←m+1 重复。

**收敛（s107）**：
$$\sigma^{(m)}_A \to \sigma_A,\qquad A^{(m)}_{t_i}\to A_{t_i},\qquad R^{(m)}_A \to R_A = \eta_A - \tfrac{1}{2}\sigma_A^2$$
**这一页把 $R_A$ 和 $\eta_A - \frac12\sigma_A^2$ 划了等号，是后面 DD 公式能写成 $(\ln(A/D)+R_A)/\sigma_A$ 的唯一依据。**（也是 §6.1 那个 $\sqrt{250}$ 量纲错误的所在。）

**最终（s108）**：取最近季报 $t_N(Q)$ 与最近交易日 $t_N$，令 $A=A_{t_N}$、$D=D_{t_N(Q)}$：
$$\tau^{*} \approx 1 - \frac{t_N - t_N(Q)}{365}$$
$$DD = \frac{\ln\frac{A}{D} + \left(\eta_A - \frac12\sigma_A^2\right)\tau^{*}}{\sigma_A\sqrt{\tau^{*}}}
\ \approx\ \frac{\ln\frac{A}{D} + \left(\eta_A - \frac12\sigma_A^2\right)}{\sigma_A}$$
$$EDF = \Phi(-DD),\qquad TiC = \frac{\sigma_A^2}{\ln^2\frac{A}{D}}$$

### 2.10 MSFT 数值示例（slide 109–112）——已逐项复算

**输入（s110，Balance Sheet as of 12/31/2022）**：Stock Price \$239.82；Shares 7,440,000,000；Current Liabilities \$81,718mm；Long Term Debt \$44,119mm；Other Non Current Liabilities \$16,479mm；Other Current Liabilities \$12,802mm；Short-term Rate 4.5%；**D = \$124,819,000,000**。

> **已复算**：`D = (81,718 + 12,802) + 0.5×(44,119 + 16,479) = 94,520 + 30,299 = 124,819` ✓ 精确吻合。
> 即课件所谓 "short-term debt" = **全部流动负债**，"long-term debt" = **全部非流动负债**。这与 s94 字面上的"短期债务/长期债务"（金融性负债）差很远，且课件正文从未说明——只能从这一页的算术反推出来。

**EM 收敛（s111）**：Run [1] 30.23% → [2]–[5] **28.42%**，`"The Algorithms is very fast and starts to converge almost immediately"`。同页给出 3/24–3/31/2023 的资产/权益表（单位为千）。

**输出（s112）**：
- 上表 DD 列：3/24 10.41、3/27 10.36、3/28 10.35、3/29 10.41、3/30 10.46、3/31 **10.51**；PIT PD 全部 0.00%
- 下表 MSFT 3/31/2023 汇总：Asset Volatility **28.64%**；Asset \$2,265,617,704,382；Equity \$2,144,951,910,720；Asset Growth Rate 12.85%；DD **10.426**；PIT PD 0.0000%；**TiC Rating 0.08531**；TTC PD 0.0001%

> **已复算（关键）**：
> - "Asset Growth Rate 12.85%" 是 **$\eta_A$**（不是 $R_A$）。取 $\sigma_A=28.64\%$ → $R_A = 0.1285 - \tfrac12(0.2864)^2 = 0.087488$，$\ln(A/D)=2.898738$，$DD = 2.986226/0.2864 = \mathbf{10.4268}$ ✓ 对上 10.426。
> - 上表 DD 列用的是 $\sigma_A = 28.42\%$：逐日复算得 10.4191 / 10.3691 / 10.3553 / 10.4185 / 10.4602 / **10.5097** ✓ 全部对上。
> - **所以同一张 slide 上下两个表用了两个不同的 $\sigma_A$**（28.42% vs 28.64%）。见 §6.3。
> - DD 里 $\tau^{*}$ 被取成 1。若按 s108 自己的定义 $\tau^{*} = 1 - 90/365 = 0.7534$，则 DD = 11.93，与两个印出来的值都不符。**课件的例子采用的是"≈"那一支**。
> - $TiC = 0.082018/8.402682 = \mathbf{0.009762}$（$\sigma=28.64\%$）或 $0.009612$（$\sigma=28.42\%$）；**印出来的 0.08531 都对不上**，差 8.74×。见 §6.2。

**s113**：只有 `TIC can be converted to S&P TTC PD` 一行，**整章内容缺失**。

---

## 3. 完整方法链（从原始输入到字母评级）

| # | 步骤 | 公式 / 规则 | Slide | 项目实现 |
|---|---|---|---|---|
| 1 | 选公司、取数 | 股价序列、股数、季度资产负债表、1y 无风险利率 | 99 | `sp500_cache.py` / `test_massive_api.py` |
| 2 | 日频股权 | $E_t = \text{adjClose}_t \times \text{shares}_t$ | 100 | `rating_inputs.build_inputs`（股数按季取，避免用今天的流通股算 2017 年市值） |
| 3 | 违约点 | $D = ST + 0.5\,LT$（课件）／实际是"流动负债 + 0.5×非流动负债" | 94, 100, 110 | `rating_inputs._default_points`；项目默认 `total_liabilities`，`--debt-basis kmv` 恢复课件式 |
| 4 | 到期时间 | $\tau_{t_i} \approx 1-\frac{t_i-t_i(Q)}{365}$，季报"就近向前取" | 100–101 | `DayInput.tau` + `_as_of` |
| 5 | 归一化目标 | $z_{t_i} = E_{t_i}/(D_{t_i(Q)}e^{-r\tau})$ | 101, 105 | `DayInput.z` / `DayInput.discounted_debt` |
| 6 | g 函数 | $g(x,\sigma,\tau)=x\Phi(d_1)-\Phi(d_2)$ | 102 | `kmv_engine.g_function` |
| 7 | 二分反解 | $g^{-1}$ | 103 | `kmv_engine.inverse_g` |
| 8 | EM 初始 | $A^{(0)}=E$，$R=\sqrt{250}\ln(A_{i+1}/A_i)$，$\sigma^{(0)}=\mathrm{stdev}$ | 104 | `run_em` 初始块（`sigma_e` 就是这一步的 stdev，即答案表的 "StockVol"） |
| 9 | E 步 | 用 $\sigma^{(m-1)}$ 解出每日 $A^{(m)}$ | 105 | `run_em` 循环 E 段 |
| 10 | M 步 | 由 $A^{(m)}$ 重算 $\sigma^{(m)}$、$R^{(m)}_A$ | 106 | `run_em` 循环 M 段 |
| 11 | 收敛 | $R_A = \eta_A - \frac12\sigma_A^2$ | 107 | `r_a`（**乘了 $\sqrt{250}$ 修正**）、`eta_a` |
| 12 | DD / EDF | $DD=(\ln\frac AD + R_A)/\sigma_A$，$EDF=\Phi(-DD)$ | 96, 108 | `_attach_rating.dd` / `pit_pd` |
| 13 | TiC / RS | $TiC=\sigma_A^2/\ln^2\frac AD$，$RS = 100\,TiC$ | 88, 97, 108, 86 | `_attach_rating.tic` / `risk_score` |
| 14 | CCM / μ | $CCM=\frac{\sigma_A^2}{\ln\frac AD\,\lvert R_A\rvert}$，$\mu=\frac{\ln\frac AD}{\lvert R_A\rvert}$ | **课件无**（论文 eq 11） | `_attach_rating.ccm` / `mu` |
| 15 | 首过 PD | $PD_{FH}=\Phi\!\left(\sqrt{\tfrac1{CCM}}(\sqrt{\tfrac T\mu}-\sqrt{\tfrac\mu T})\right)+e^{2/CCM}\Phi\!\left(-\sqrt{\tfrac1{CCM}}(\sqrt{\tfrac T\mu}+\sqrt{\tfrac\mu T})\right)$ | **课件无**（论文 eq 13） | `_attach_rating.pd_fh` |
| 16 | PIT→TTC | $CL_{FH}(CCM)=CL_{SP}(CCM^{*})$ 解 $CCM^{*}$ | **slide 113 空白**（论文 §5.3） | `ttc_conversion.cl_fh` / `cl_sp` / `solve_ccm_star` |
| 17 | S&P RiskScore | $\ln TiC_{SP}=Q\Phi^{-1}(PD)\sqrt{\ln(CCM^{*}+1)}-\frac Q2\ln(CCM^{*}+1)+\ln CCM^{*}$ | **87（λ 参数化的同一式）** | `ttc_conversion.sp_riskscore` |
| 18 | 字母 + TTC PD | Table 8 断点 + 细档插值 | **86 的 Avg 行 = Table 8** | `sp_letter` / `sp_ttc_pd` / `sp_letter_fine` |

**断点在第 14–16 步**：课件在第 13 步就停了（TiC 是终点），第 14–18 步的全部内容来自论文 + 教授答案 Excel + 课堂录播。写方法讲解页时，"从 TiC 到字母"这一段不能引课件页码。

---

## 4. 思想与哲学：作者反复强调的立场

### 4.1 评级不是 PD——全套理论的第一原理
- s81：`"A common mistake made by many: Risk Rating is the same as Probability of Default (PD)"`
- s87：`"PD is clearly different from the rating. The TiC rating reflects PD with different time periods"`
- 证据不是论证而是数据：s11/s78 的 Moody's B 级历年 PD（0.0%–9.8%）和 s86 的 S&P 逐年表（AAA 列 PD 常年 0.00%，RS 列却在 1.2–3.5 之间连续变化）。**如果评级=PD，那么 AAA 十二年都是同一个数 0.00%，评级体系就没有信息量；而 RS 有。**

### 4.2 用"行为"而不是"定义"来刻画信用
- s81 标题即 `Behavior-Specific Approach & Two Driving Factors`。两个行为：`Level of Defaults`（违约水平）与 `Deterioration of Credit`（信用恶化），分别由 $\mu$ 与 $CCM$ 量化，分别对应监管的 Allowance 与 Capital。
- s83：`"Like Depreciation or Corrosion in health. But how do we measure this Corrosion? I created a Credit Corrosion Measure (CCM)"`
- s81 顺带指出行业空白：Capital 这一维 `"this is addressed by none of existing rating approaches"`。

### 4.3 "每家公司最终都会违约"——把 PD 换成寿命
- s82：`"Every company will eventually default"` `"With different life spans"`。
- 这一步换掉的是整个提问方式：不问"一年内违约概率是多少"（对单个 IBM 无法统计），而问"违约时间 τ 的分布长什么样"。评级刻画的是这个分布的形状，不是它在某一年的截面积。

### 4.4 对 KMV 的态度：不是否定，是"信息对、期限错"
- 肯定：s71 `"It is a Point-In-Time (PIT) forward looking rating that presents market's current view on the company"`；Moody's 花 $220mm 买它。
- 否定：s71 三条（不稳、跟着股价天天变、不适合银行的 TTC 需求）；s13 `Very unstable` / `Difficult to translate into bank ratings`。
- 病灶定位：s96 一句 `"η_A makes both unstable"`。TiC 公式里没有 $\eta_A$——**这就是"稳定"的数学来源**。

### 4.5 对行业现状的批评
- s8：`"They may use different data and different approaches so all ratings are not fully comparable."`
- s9：`"SEC's answer: seems impossible"`
- s77：`"We know there are differences among them, but we do not have realizable methods to measure their differences"`；`"There are many vague concepts that needs rigorous mathematical descriptions"`
- s78：`"After the financial crisis, several rating agencies had to pay large amounts of penalties."`
- s12：`No Data??`（红字）——商业信贷根本没有可回归的违约样本。

### 4.6 评级"应该是什么"
- **一个可跨体系换算的量**：s84 `"they are all special cases of TiC ratings"`；s89 `"Rating Conversions between these ratings become simple and easy"`。
- **一个连续的分数而非离散字母**：TiC / RS 是实数，字母只是最后的量化落档。
- **一个直接连到监管的量**：s81 两因子 ↔ Allowance 与 Capital；s89 `"Even government policies can be quantified"`。
- **一个跨时间稳定的量**：PD 沿评级线滑动，评级线本身不动。

### 4.7 关于 AI 与算法的立场（与项目"AI 自动化"部分直接相关）
- s21：`"What's powerful is the knowledge behind algorithm, not its execution. AI is the execution of algorithms."`
- s22：`"Decision process is NOT an algorithm"`；Rice 定理"图灵机无法回答关于其他图灵机行为的问题"。
- 潜台词：AI 可以把这套评级流程自动化执行，但**方法本身（哪些行为、怎么用数学描述）来自二三十年的经验，不是 AI 产出的**。这与口述纪要"主要是经验，不需要数据"完全一致。

---

## 5. 公式-实现对照表

### 5.1 完全一致（课件即实现）

| 课件 | 公式 | 项目函数 | 备注 |
|---|---|---|---|
| s102 | $g(x,\sigma,\tau)=x\Phi(d_1)-\Phi(d_2)$ | `kmv_engine.g_function` | 逐字一致 |
| s103 | 二分法 | `kmv_engine.inverse_g` | 上界改成几何倍增（课件未给上界规则） |
| s101 | $z = E/(De^{-r\tau})$ | `DayInput.z` | 一致 |
| s101 | $\tau \approx 1-\frac{t-t(Q)}{365}$ | `rating_inputs`（并 clamp 到 $(0,1]$） | 课件未给 clamp |
| s104–106 | EM 三步 | `kmv_engine.run_em` | 结构一致 |
| s104 | $\sigma_A=\mathrm{stdev}\{\sqrt{250}\ln(A_{i+1}/A_i)\}$ | `_annualized_log_returns` + `stdev` | 一致 |
| s96/108 | $DD=(\ln\frac AD+R_A)/\sigma_A$，$EDF=\Phi(-DD)$ | `_attach_rating.dd` / `pit_pd` | 一致（都取 $\tau^{*}=1$） |
| s88/97/108 | $TiC=\sigma_A^2/\ln^2(A/D)$ | `_attach_rating.tic` | 一致 |
| s86 Avg 行 | RS 2.7/3.5/5.2/9.9/22/51/155 + PD 0.00/0.03/0.07/0.23/0.9/4.4/33.6% | `ttc_conversion._SP_TABLE8` | **直接对应**；代码用论文的更精确值 22.2/50.7/154.8 |
| s87 | $\ln(CR)=0.75\Phi^{-1}(PD_1)\sqrt{-\frac23\ln\lambda}+\frac{0.75}{3}\ln\lambda+\ln(\lambda^{-2/3}-1)$ | `ttc_conversion.sp_riskscore` | **数学上完全同一式**，见下 |

> **s87 ≡ `sp_riskscore` 的证明（已数值验证到机器精度）**：令 $\lambda = (CCM+1)^{-3/2}$，则
> - $-\frac23\ln\lambda = \ln(CCM+1)$
> - $\frac{Q}{3}\ln\lambda = -\frac{Q}{2}\ln(CCM+1)$
> - $\ln(\lambda^{-2/3}-1) = \ln((CCM+1)-1) = \ln CCM$
>
> 代入即得 $\ln TiC = Q\Phi^{-1}(PD)\sqrt{\ln(CCM+1)} - \frac Q2\ln(CCM+1) + \ln CCM$，正是 `sp_riskscore`。
> **差别只有常数**：课件写死 $0.75$，代码用 $Q_{SP}=0.625913$（S&P 校准值）。0.75 是给"银行内评"用的体系常数，不是 S&P 的。

### 5.2 实现做了取舍 / 修正

| 课件 | 项目实现 | 为什么 |
|---|---|---|
| s106–107：$R_A=\frac{\sum R_{t_i}}{N-1}$ 且 $R_A=\eta_A-\frac12\sigma_A^2$ | `r_a = sqrt(250) * mean(scaled returns)` | **课件字面值差 $\sqrt{250}\approx15.81$ 倍**。已用教授答案 Excel 复核：AMZN `AssetRet=0.10782`、`Mu=16.963=ln(A/D)/|R_A|`、`DD=7.30093` —— 全部只有在 $R_A$ 已年化时才成立。若按课件字面取 mean，AMZN 的 $R_A$ 只有 0.00682，DD 会变成 6.92。见 §6.1 |
| s94/100：$D=ST+0.5LT$ | 默认 `D = total_liabilities`，`--debt-basis kmv` 保留课件式 | 教授答案表 2026-07-27 定稿；且只有 total_liabilities 口径下首过 PD 才落在他理论预期的量级。另外 s110 的算术本身就把 ST 读成"全部流动负债"（§6.5） |
| s108：$DD$ 带 $\tau^{*}$ 的完整式 | 只实现 $\tau^{*}=1$ 那一支 | 课件的数值例子（s111/112）本身用的就是 $\tau^{*}=1$；引擎代码注释标为 "professor's no-tau approximation"。**注意 $\tau$ 在 E 步里是真用的（`g(x,σ,τ)`、`D·e^{-rτ}`），只在 DD 里被丢掉**——同一个 τ 在一条流水线里两种待遇 |
| s100：$\tau$ 的两个定义 | 统一采用 365 日历日制 | s101/105 自己也用 365 制；250 制那句是孤立的 |
| 课件无 | `ccm`、`mu`、`pd_fh` | 论文 eq 11/13 |
| s113 空白 | 整个 `ttc_conversion.py` | 论文 §5.3 + Prop 5.2.1/5.2.2 + Table 8/13/14 |
| 课件无 | `sigma_e`（StockVol） | EM 初始步的 stdev 即股权波动率，答案表里有这一行，课件没点名 |
| 课件无 | 细档 `_SP_FINE_SCALE`（AAA/AAA-/AA+…） | 来自课程转换表（2026-07 课堂），不在课件里 |
| 课件无 | 估计窗口长度 | 课件只说"近几个季度"；项目用 150 交易日（答案表口径），页面上可切 90/150/250 |

---

## 6. 矛盾与存疑清单

> 每条都标了页码与复算结果。**§6.1 和 §6.2 是必须知道的两条。**

### 6.1 【公式错误】$R_A$ 的年化差一个 $\sqrt{250}$（slide 104 / 106 / 107）
课件定义 $R_{t_i}=\sqrt{250}\ln\frac{A_{i+1}}{A_i}$（已是"日对数收益 × √250"），然后取 $R_A = \frac{\sum R_{t_i}}{N-1}$，s107 断言 $R_A \to \eta_A-\frac12\sigma_A^2$。

- 设日对数漂移为 $m_d$，则 $\mathrm{mean}(R) = \sqrt{250}\,m_d$，而年化漂移是 $250\,m_d = \sqrt{250}\cdot\mathrm{mean}(R)$。
- **所以课件字面的 $R_A$ 只有真实年化漂移的 $1/\sqrt{250}$。**
- 波动率那一支没错：$\mathrm{stdev}(R)=\sqrt{250}\,\sigma_d$ 正好是年化波动率。**同一个 $\sqrt{250}$ 缩放，对 stdev 是对的，对 mean 是错的**——这是这个错误最容易被忽略的原因。
- **已用教授答案 Excel 反证**：AMZN `AssetVol=0.265284`、`AssetRet=0.107822`、`Mu=16.9632`、`CCM=0.356865`、`RS=2.10376`、`DD=7.30093`。复算：$\ln(A/D)=\mu\cdot|R_A|=1.82902$；$CCM=\sigma^2/(\ln\frac AD\cdot|R_A|)=0.356865$ ✓；$DD=(1.82902+0.107822)/0.265284=7.30093$ ✓。**必须用年化的 $R_A$ 才对得上。**
- 项目 `kmv_engine.py` 已修正并写了注释。

### 6.2 【数值无法复现】MSFT 的 TiC Rating = 0.08531（slide 112）
用该页自己的输入（$\sigma_A=28.64\%$、$A=2{,}265{,}617{,}704{,}382$、$D=124{,}819{,}000{,}000$）：
$$\ln(A/D)=2.898738,\quad \ln^2=8.402682,\quad TiC=\frac{0.082018}{8.402682}=\mathbf{0.009762}$$
换 $\sigma_A=28.42\%$ 得 0.009612。**印出来的 0.08531 是公式值的 8.74 倍。**

排查过的假设，全部否掉：
- 换 D 为 total liabilities（155,118mm）→ 0.011407
- 用折现后的 D、用 12/31/2022 的 A、用千/元单位混淆 → 都在 0.0096–0.0114 区间
- 走 S&P 转换链得 $RS_{SP}=1.136$（即 $TiC_{SP}=0.01136$），换 $Q=0.75$ 得 0.00578 —— 也不是 0.08531
- 反解：要得到 0.08531，需 $\sigma_A=84.7\%$ 或 $A/D=2.666$（$D\approx\$850$B），均不合理

**唯一有意义的线索**：$\sqrt{0.08531}=0.2921$，即 0.08531 恰好是"某个 29.21% 波动率的平方"。倾向于判定这一格是**陈旧/串行的单元格**（写的是 $\sigma_A^2$ 量级的东西而非 $\sigma_A^2/\ln^2(A/D)$）。
同页的 DD 与 EDF 全部精确复现，**所以这是课件的数字问题，不是引擎的公式问题**。`kmv_engine.py` 第 279–283 行已就此写了注释。
> 对外表述建议：TiC×100（RS）对 MSFT 应约为 **0.98**，落在 AAA 区（Table 8 的 AAA 锚点是 2.7），与该页 "TTC PD 0.0001%" 的定性结论方向一致。

### 6.3 【自相矛盾】同一页两个 $\sigma_A$（slide 111 vs 112）
- s111 的 EM 收敛表：Run[1] 30.23% → Run[2]–[5] **28.42%**
- s112 汇总表：Asset Volatility **28.64%**
- **已复算**：s112 上表的 DD 列（10.41/10.36/10.35/10.41/10.46/10.51）只有用 **28.42%** 才对得上；s112 下表的 DD=10.426 只有用 **28.64%** 才对得上。
- 结论：**同一张 slide 的上下两个表分别用了两个不同的资产波动率**，且都不是"其中一个笔误"——两套数字各自内部自洽。最可能是两次不同的运行结果被拼到了一页。

### 6.4 【跳步】从 $CCM/\mu$ 到 $\sigma_A^2/\ln^2(A/D)$ 没有推导（slide 84 → 88/97）
- s84 定义 $TiC = CCM/\mu^Q$，$CCM = E[\tau]E[1/\tau]-1$。
- s88 写 $CreditRating = CCM/E^{1}[\tau] = \sigma_A^2/\ln^2(A_0/D)$（红色上标 1 表示 $Q=1$）。
- 但按定义 $\frac{CCM}{E[\tau]} = E[1/\tau] - \frac{1}{E[\tau]}$，**那个 "$-1$" 去哪了课件没交代**；且 s82 说"每家公司终会违约"意味着 $E[\tau]<\infty$，而结构模型里资产是**正漂移**的 GBM，$\tau$ 并非几乎必然有限，$E[\tau]$ 形式上发散。
- 论文补上了缺环（eq 11）：$CCM = \frac{\sigma_A^2}{\ln\frac AD\cdot|\eta-\frac12\sigma_A^2|}$，$\mu = \frac{\ln\frac AD}{|\eta-\frac12\sigma_A^2|}$，取绝对值使 $\mu$ 有限，相除得 $\sigma_A^2/\ln^2(A/D)$，漂移刚好抵消。
- **副产品（值得写进讲解页）**：正因为 $\eta_A$ 被约掉，TiC 在 Girsanov 变换下不变（风险中性/经验测度同值），也不依赖无风险利率——这才是它比 DD/EDF 稳定的机理，而 s96 只用了 `η_A makes both unstable` 五个词。

### 6.5 【定义缺口】"Short-term Debt" 的真实口径只能从算术反推（slide 94/100 vs 110）
- 正文（s94/100）：$D = \text{short-term debt} + 0.5\times\text{long-term debt}$。
- s110 的实际算法（**已复算精确吻合**）：$D = (\text{Current Liabilities} + \text{Other Current Liabilities}) + 0.5\times(\text{Long Term Debt} + \text{Other Non Current Liabilities}) = 124{,}819$mm。
- 也就是"**全部流动负债 + 0.5×全部非流动负债**"，等价于 $\text{Total Liabilities} - 0.5\times\text{Non-current Liabilities}$，而不是金融性有息负债。
- 项目实现的两种口径（`total_liabilities` / `kmv`）都与这个隐含口径不同——`kmv` 用的是 `debt_current + 0.5*long_term_debt`（纯有息债），比课件口径小得多。**做课件复现时必须注意这一点，否则 DD 会偏高。**

### 6.6 【记号冲突】同一页给了 τ 的两个定义（slide 100）
$$\tau = \frac{\#\text{ of trading days between }T_0,T_1}{250}\qquad\text{与}\qquad \tau \approx \frac{T_1-T_0}{365}$$
一个是 250 交易日制，一个是 365 日历日制，同一符号同一页。后续（s101/105/108）全部使用 365 制。250 制那一句形同废弃。

### 6.7 【记号不严】σ 与 R 的下标范围（slide 104/106）
$\sigma_A = \mathrm{stdev}\{R_{t_i}\}_{1\le i\le N}$，但由 $N$ 个资产只能生成 $N-1$ 个收益；同页的 $R_A$ 又正确地写成 $\sum_{i=1}^{N-1}/(N-1)$。下标范围前后不一致（应统一为 $1\le i\le N-1$）。

### 6.8 【单位/百分比】TTC PD 印成 0.0001%（slide 112）
Table 8（s86 Avg 行）的 AAA 锚点 PD 是 **0.01%**（十进制 0.0001）。s112 印的是 **0.0001%**（十进制 $10^{-6}$），正好差 100 倍——高度疑似把十进制 0.0001 直接加了个 `%`。教授答案 Excel 里 `SP_PD` 的下限是 $2\times10^{-4}$（0.02%），也支持"应读作 0.01%"。

### 6.9 【体系常数不同】0.75 vs 0.625913（slide 87 vs `ttc_conversion.Q_SP`）
s87 的银行评级式把体系常数写死为 0.75；项目对 S&P 用 $Q_{SP}=0.625913$（论文校准值，Moody's 是 0.746）。两者不是笔误关系，而是**不同评级体系的常数**——但课件没说 0.75 属于谁，容易被误当成通用常数。

### 6.10 【叙述不一致】Xerox 提前量：5 个月还是 7 个月（slide 73 vs 74）
s73 正文：`"I was able to predict the risk of Xerox 5 Months prior to the October event"`；s74 图上标注 `7 Months`（到 2000 年 12 月降级）+ 另标 `2 Months`。7 = 5 + 2，即 s74 标的是"到降级"的距离，s73 说的是"到 10 月事件"的距离。逻辑能自洽，但两个数字并排出现容易被读成矛盾；引用时应写"提前 5 个月预警了 10 月的流动性事件、提前 7 个月于 12 月的降级"。

### 6.11 【章节缺失】PIT→TTC 整章只剩一行标题（slide 113 + 目录 slide 3）
目录承诺 `Rating Conversion: PIT to TTC`，正文只有 s113 的 `TIC can be converted to S&P TTC PD` 一句，无公式、无例子。项目的置信原则 $CL_{FH}(CCM)=CL_{SP}(CCM^{*})$、$CCM^{*}$ 求解、Table 8 断点、细档全部来自论文与课堂材料。**任何"课件说 TTC 应该这么转"的表述都是错的。** 同理，目录里的 MCP/fastMCP/Function calling、Data and Automation、AI Implementation Automation 三章在正文中也无对应页。

### 6.12 【数据缺年】两张历史表各缺一年（slide 11/78 与 slide 86）
- Moody's B 级历史 PD 表（s11，s78 重复）：列了 2001–2005、**2007**–2016，**缺 2006**。
- S&P 逐年 PD/RS 表（s86）：列了 2005、2006、2007、**2009**–2016，**缺 2008**（金融危机当年）。
- 两张表都用 12/15 个年度点做"跨时间不一致"的经验论证，缺年不影响定性结论，但引用"十二年平均"时要说清样本年份。s86 的 Avg 行是 11 个年度的均值（不含 2008）。

### 6.13 【存疑】s111 与 s112 的资产值单位不统一
s111 表里 3/31/2023 资产写 `$2,265,639,515`，s112 写 `$2,265,617,704,382`。前者显然以千为单位，且两者在千位换算后仍差约 2,180 万（相对差 $10^{-5}$）。属于两次运行/不同 $\sigma_A$ 的残留（与 §6.3 同源），不影响结论，但复现时不能混用。

---

## 7. 可引用金句（英文原句 + 页码）

**关于行业与问题**
- `"They may use different data and different approaches so all ratings are not fully comparable."` — slide 8
- `"SEC's answer: seems impossible"` — slide 9
- `"It is desirable for a credit rating agency to have a standardized credit rating terminology…., However, … may not be feasible given the number and uniqueness of rating scales and differences in credit rating methodologies used by credit rating agencies"`（SEC 2012 原文引用） — slide 79
- `"We know there are differences among them, but we do not have realizable methods to measure their differences"` — slide 77
- `"There are many vague concepts that needs rigorous mathematical descriptions"` — slide 77
- `"After the financial crisis, several rating agencies had to pay large amounts of penalties."` — slide 78

**关于 KMV**
- `"It is a Point-In-Time (PIT) forward looking rating that presents market's current view on the company"` — slide 71
- `"Most significant problem: unstable rating with huge volatility"` — slide 71
- `"It also changes too frequently as it is directly driven by stock prices"` — slide 71
- `"Not suitable for banks to use as banks often require Through-The-Cycle (TTC) ratings"` — slide 71
- `"η_A makes both unstable"` — slide 96
- `"One method is to use another equation so that two equations can solve two unknows. But the solutions are less stable"` — slide 93

**关于 TiC 的立论**
- `"A common mistake made by many: Risk Rating is the same as Probability of Default (PD)"` — slide 81
- `"PD is clearly different from the rating. The TiC rating reflects PD with different time periods"` — slide 87
- `"Every company will eventually default"` — slide 82
- `"Like Depreciation or Corrosion in health. But how do we measure this Corrosion? I created a Credit Corrosion Measure (CCM)"` — slide 83
- `"Capital (this is addressed by none of existing rating approaches)"` — slide 81
- `"Answer: Yes, they are all special cases of TiC ratings."` — slide 84
- `"I set an objective for myself: To establish a comprehensive credit rating theory and methodology that can address all the issues discussed early."` / `"It was completed in 2021 after 10 years of efforts"` — slide 79
- `"Rating Conversions between these ratings become simple and easy"` / `"Even government policies can be quantified"` — slide 89

**关于模型机理**
- `"The Problem: Asset is the market value and is not observable, Debt is to be paid in the future, the Equity is observed today"` — slide 55
- `"Merton says that there is a Call Option relationship exists between the Asset and the Equity"` — slide 68
- `"Price = Pollen"` / `"Individual Investors = Molecules"` / `"Trades by Individual Investors determine the price: Molecules collide Pollens"` — slide 64
- `"Today's price is the best forecast for tomorrow's price"` — slide 41
- `"Short-term debt plays bigger role than long-term debt"` — slide 92
- `"The Algorithms is very fast and starts to converge almost immediately"` — slide 111

**关于算法与 AI**
- `"What's powerful is the knowledge behind algorithm, not its execution. AI is the execution of algorithms."` — slide 21
- `"Newton's Root Finding Algorithm is to walk blindfolded"` — slide 26
- `"Decision process is NOT an algorithm"` — slide 22
- `"Turing machine cannot answer questions about the behavior of other Turing machines"`（Rice 定理表述） — slide 22

---

## 8. 给下游使用者的提醒

1. **引用页码前先查第 6 节**。TiC 0.08531（s112）、$R_A$ 的 $\sqrt{250}$（s104–107）、两个 $\sigma_A$（s111/112）这三处不能原样搬到讲解页。
2. **TTC 转换不要引课件**。课件在 s113 断了；用 `knowledge/notes/paper-tic-30p-draft.md` 与 `ttc_conversion.py`。
3. **课件的 D 口径 ≠ 项目的 D 口径**。要复现课件的 MSFT 数字，得用"流动负债 + 0.5×非流动负债"。
4. **DD 的 τ**：课件的例子和项目实现都取 $\tau^{*}=1$；s108 那个带 $\tau^{*}$ 的完整式在课件自己的例子里也没用。
5. **s86 的 Avg 行就是 Table 8**，是课件与 `ttc_conversion._SP_TABLE8` 之间唯一的直接锚点，做溯源时可以引这一页。
6. **s87 与 `sp_riskscore` 是同一个公式**（$\lambda=(CCM+1)^{-3/2}$），只是常数不同——这是课件里唯一出现过的 TTC 侧公式，可以用来说明"转换方法在课件里露过一次脸"。
