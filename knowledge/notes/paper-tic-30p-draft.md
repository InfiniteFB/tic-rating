# 论文精读：Universal Time-Consistent (TiC) Credit Rating（30 页 DRAFT 版）

> 文件：repo 根目录 `Universal Time-Consistent (TiC) Credit Rating simple.pdf`
> 作者：Yimin Yang, Executive In Residence, Duke University（yimin.yang@duke.edu）
> 版本特征：每页 "DRAFT" 水印；页眉 "LOAN CREDIT RATING"；30 页；参考文献含作者本人 2019/2021 两场会议报告。
> 杨一民 2026-06-18 口述：手头流传的 word/早期版"是很早版本的了"，他会发比较新的版本；算法在新版中"越来越简单"。
> 本笔记由项目主 agent 逐页精读后写成（2026-07-31）。

## 1. 问题意识：Credit Rating 1.0 → 2.0（§1–2, p1–4）

- 缘起：2008 金融危机暴露评级体系的问题；2012 年 SEC 向国会提交 "Credit Rating Standardization Study"（Dodd-Frank 要求），提出"标准化评级术语、评级与违约概率/损失预期定量对应"。论文是对这一提议的直接回应。
- 作者双重身份是问题意识的来源：多年为美国大行开发评级系统 + 社区银行 Chief Credit Officer（中小企业客户为主）。大公司财报全且季更；中小企业数据少、口径乱、评级难与公开评级比较。
- **两类不一致（p2–3）**：
  - **Cross-Time inconsistency**：同一评级的经验违约率年际剧烈波动。Table 1：Moody's B 级 1 年历史 PD 从 0.0%（2007）到 9.8%（2001）——同一个字母，违约率差两个数量级。
  - **Cross-System inconsistency**：跨体系换算不稳定（KMV EDF ↔ 银行内评要每季"Rating Calibration"；并购后评级换算困难到干脆不换）。
- **关键转折（p3，思想核心）**："this seemingly problematic behavior unveils an important insight … This is not a problem, but a well-explainable and manageable behavior. In fact, this is what should be expected." —— 历史 PD 波动不是评级的失败，而是"评级 ≠ PD"的证据。
- 根因四条（p3–4）：数据少+简单统计模型；历史数据缺关键信用信息（升降级行为）；**"credit ratings are the same as PDs over a period" 是几乎所有银行和研究者的共同误解**；监管（拨备/资本）从未被纳入评级建模。
- Credit Rating 2.0 需求清单（p4）：捕捉迁移行为；是现有评级的**扩展而非替换**；跨时间一致、区分度好、连续/细粒度；统一 TTC 与 PIT；覆盖无担保+担保；个体+组合（分散化收益）；与监管要求直接相连；跨体系可稳定转换。

## 2. 方法分类学：第四种进路（§4, p5–6）

| 进路 | 谁在用 | 特征 | 局限 |
|---|---|---|---|
| Process-Specific | Moody's/S&P 等 agency | 定性+定量流程、专家排序 | 评级不必等于 PD；流程难保持跨时一致；离散 |
| Distribution-Specific | 大银行 | Probit/Logistic 回归出 PD，评级=PD | 绑死在"选哪种 PD"上；PD 本身跨时波动 |
| Default-Specific | 学术界 | 违约被数学定义（first-passage / Merton 到期违约），推理论公式 | 与银行数据脱节、转换难、市场数据导致评级不稳 |
| **Behavior-Specific（TiC）** | 本文 | **按行为区分信用："similar credits are expected to have similar behaviors"** | 定义基本行为+找数据有挑战 |

- 两个基本信用行为：**credit deterioration（恶化）与 credit default（违约）**，分别量化为 CCM 与 μ。
- "Universal" 的逻辑（p6 + §6, p29）：任何其他评级方法要么与基本行为吻合（=与 TiC 一致），要么没抓住行为（=坏方法）；三种传统进路都是 Behavior-Specific 的**特例**。
- 组合评级（p6, p15）：个体与组合的差 = 分散化收益，由 λ（default peak）承载——λ 代表所有信用的集体行为/违约聚集。

## 3. 核心定义（Definition 4.1, p7–8）

τ = 违约时间（随机变量）。其分布典型形状：早期低 → 爬到峰值 → 衰减（Figure 1，横轴月龄）。信用评级刻画的是 τ 的分布，不是某一段时间的违约概率。

- **μ = E[τ]** —— Life Expectancy（寿命期望）(eq 1)
- **CCM = E[τ]·E[1/τ] − 1** —— Credit Corrosion Measure (eq 2)。由 Jensen/Cauchy–Schwarz，CCM ≥ 0；τ 越分散 CCM 越大。度量"超出预期水平的信用恶化聚集"
- **λ = mode(τ)/E[τ]** —— Default Peak（众数/均值比）(eq 3)，反映违约来得早还是晚；实际中与违约聚集（default clustering）相联
- **TiC = CCM / μ^Q** (eq 4)，Q = Constant of Rating System（评级体系常数）
- **RS = 100·TiC** (eq 5)（RiskScore）

**μ-CCM 图**（Figure 2–4，方法可视化的核心）：以 (ln μ, ln CCM) 为坐标，每个信用/评级是一个点。同一评级等级历年数据连成**斜率为 Q 的直线**（rating line），RS 是截距。Moody's Caa-C 历年点位良好共线（Figure 3）——这就是"时间一致"的几何形象：**PD 沿着评级线滑动（所以历史 PD 波动），线本身不动（所以评级稳定）**。

要求 CCM 的百分比变化与 μ 的百分比变化成比例（比率即 Q）才能保持同一评级；Q 同时度量不同评级体系之间的差异。

## 4. Agency 实证（§4.2, p9–13）

- 数据：Moody's Annual Default Study（1920–2010）+ S&P Annual Global Corporate Default Study 的**评级转移矩阵**（Moody's 2001–2016 缺 2006；S&P 2005–2016 缺 2008）；WR（撤销）类按比例重分配；用平均转移矩阵（Table 2）。
- **Proposition 4.2**：Moody's Q = 0.746，S&P Q = 0.626。Table 3 给出各等级各年 μ/CCM。
- **Table 4/5（"评级≠PD"的实证锤）**：RiskScore 跨时间稳定且区分度好；1 年 PD 对好信用完全无区分（AAA~A 多年 0.00%）且对同一等级剧烈波动。Moody's B 级：历史 PD 0.0%–9.8%，RS 仅在 18–48 窄幅摆动（Table 5）。
- Figure 5/6（PD 热图）：1-year PD 沿评级线方向变化——"1-year PD is not exactly Time-consistent"。

## 5. 银行内评（§4.3, p13–15）

- 观察：几乎所有银行用 Probit/Logistic 回归估 PD 再"校准"成评级，且信用年龄 T 常作外生变量（CECL/IFRS 9 亦按 age 计损失）。
- **Proposition 4.3.1**：选 Probit ⇔ 假设 τ 服从 **Log-normal**；选 Logistic ⇔ **Log-logistic**。"choosing different regressions is the same as selecting different distributions for default time τ"。
  - Probit：CCM = λ^(−2/3) − 1；PD_T = Φ((ln T − ln μ + ½ln(CCM+1)) / √(ln(CCM+1))) (eq 6)
  - Logistic：CCM = (πs)²/sin²(πs) − 1（0<s<1）；λ、PD_T 见 eq 7
  - PD_T 与 CCM 均是 λ 的减函数；λ→0 时 CCM→∞，λ→1 时 CCM→0
- **Proposition 4.3.2（Regulatory Relationship I, eq 8/9）**：ln(TiC) 可用 (PD_T, λ 或 CCM, T) 显式表出——**不跑回归即可从可观测行为参数校准评级**。
- Proposition 4.3.3：组合的 μ、λ（从而 CCM）可同样估计；分散化收益体现在 λ。

## 6. First-passage 模型（§4.4, p15–17）——本项目引擎的理论出处

- **Proposition 4.4.1**：资产过程 A_t = A_0·exp((η − σ_A²/2)t + σ_A·W_t)，违约 = 首次触 D：τ = inf{t≥0: A_t ≤ D}。假设 |η − σ²/2| > 0 且 D < A_0：
  1. **τ ~ Inverse Gaussian**
  2. **CCM = σ_A² / (ln(A_0/D)·|η − σ²/2|)；μ = ln(A_0/D) / |η − σ²/2|** (eq 11)
  3. **Q=1 是唯一使 TiC 与 η 无关的选择：TiC = CCM/μ = σ_A²/ln²(A_0/D)** (eq 12)。因不含 η，**在 Girsanov 变换下不变——风险中性测度与实证测度给出同一个评级**（避开了漂移估计这个最不稳的环节）
  4. 首过违约概率 **PD_T = Φ(√(1/CCM)(√T/√μ − √μ/√T)) + e^(2/CCM)·Φ(−√(1/CCM)(√T/√μ + √μ/√T))** (eq 13)
  5. KMV 的 DD/EDF 也是 μ、CCM 的函数：DD_T = (ln(A_0/D)+(η−σ²/2)T)/(σ_A√T) = (1 ± T/μ)/(√T·√(CCM/μ))；EDF = Φ(−DD_T) (eq 14)。**明言 DD/EDF "are NOT time-consistent"**
- Proposition 4.4.2（市场风险×信用风险, eq 15/16）：MPR = (η−r)/σ_A；1/μ − 1/μ_RN = √TiC·MPR；1/CCM − 1/CCM_RN = MPR/√TiC；**TiC = CCM_RN/μ_RN = CCM/μ 不变**。

## 7. CCM ⇔ 资本（§4.5, p18–22）——"评级挂钩监管"的机制

- 资本=置信水平：监管要求银行至少以 α（如 99.9%）存活 ⇒ 转成对**寿命**的要求。
- Definition 4.5.1 + eq 17–19：RMST（Required Minimal Survival Time）= CML / (CCM/μ)，CML = Constant of Minimal Lifespan；VaR_α(τ) = RMST ⇒ α 与 CCM 一一对应。
- **关键观察：α 只由 CCM 决定，与 μ 无关**——资本（长期偿付性）看 CCM；损失拨备（短期损失，随 μ 增而减）看 μ。二者的权衡在 μ-CCM 图上可精确计算（Figure 7）。
- **Proposition 4.5.2 (eq 22)**：α = CL(CCM) 在三种 τ 分布下的显式公式——Log-Normal / Log-Logistic / **Inverse Gaussian（引擎 `cl_fh` 即此式，CML=e^1.35）**。α 是 CCM 的减函数，lim_{CCM→0}α=1、lim_{CCM→∞}α=0 ⇒ 任意 α 有唯一 CCM*（eq 23）——**这就是无套利转换的存在唯一性**。
- Proposition 4.5.3：agency 评级拟合 θ=1、**CML = e^1.35 = 3.857**；Table 6：Moody's Aaa α=99.93%…Caa-C 59.66%；S&P AAA α=99.97%…CCC/C 61.11%（λ 从 0.51 降到 0.04）。
- Proposition 4.5.4 (eq 24)：TiC 评级与 (PD₁, CCM, α) 的显式关系（log-normal）。
- Proposition 4.5.5 (eq 25)：**资本权重反比于 TiC 评级**：CW₁/CW₂ = TiC₂/TiC₁（例：评级 3.90 的信用需要 4.0 信用 97.5% 的资本）。

## 8. 跨体系转换（§5, p23–28）——`ttc_conversion.py` 的直接出处

### 5.1 TTC 转换（agencies 之间）
- 转换不稳的根源 = 各体系 Q 不同（rating line 斜率不同）。
- **Table 7/8（p24）**：Moody's / S&P 的 TTC PD₁、μ、CCM、λ、RiskScore。**Table 8 = 引擎 `_SP_TABLE8` / 前端 `fields.js TABLE8` 的逐字来源**：S&P AAA RS 2.7 (PD₁ 0.01%)、AA 3.5、A 5.2、BBB 9.9、BB 22.2、B 50.7、CCC/C 154.8。
- Table 9/10：Moody's↔S&P 互转（保持 TTC PD₁ 一致；两家 Q 接近所以可行）。

### 5.2 No-Regulatory-Arbitrage 转换
- 原则：转换必须**同时保持拨备（PD）和资本置信水平（α）不变**——否则同一信用换个体系表述就改变了监管负担，即"监管套利"。
- **Proposition 5.2.1（两步程序）**：①解 CL_B(CCM*) = CL_A(CCM_A) 保 α；②RS_B = TiC_B(PD_A, CCM*)。
- 实操用 log-normal 近似（agency 无显式公式）；Q_MD=0.7462、Q_SP=0.625913、CML=e^1.35 代入 CL_MD/CL_SP（p26 顶部两式）。Table 11 承认 log-normal PD 与历史 PD₁ 有偏差（且规避了观测 PD=0 的除零/无穷问题）。
- Table 12：Moody's→S&P 无套利转换结果与 5.1 的 TTC 转换（Table 9）"very similar"——两法互证。

### 5.3 First-Hitting（PIT）→ S&P（引擎主链）
- TiC_FH = CCM/μ = σ_A²/ln²(A_0/D)；PD_FH 用 eq 13 的 μ 参数化。
- **CL_FH(CCM) = Φ(√(e^1.35)/CCM − 1/√(e^1.35)) + e^(2/CCM)·Φ(−√(e^1.35)/CCM − 1/√(e^1.35))**（IG 版, CML=e^1.35）
- 锚点数值（引擎回归测试全对上）：**CCM=1.5 → α=91.906% → 解 CL_SP(CCM*)=α 得 CCM*=1.35373**；**CCM=5 → α=72.749% → CCM*=2.22928**
- ln(TiC_SP) = 0.625913·Φ⁻¹(PD)·√(ln(CCM+1)) − (0.625913/2)·ln(CCM+1) + ln(CCM)（= 引擎 `sp_riskscore`）
- **Table 13/14**：CCM 固定（1.5/5）、μ 变动时 RS_FH/PD_FH/DD/EDF → S&P RS → S&P TTC PD → 字母的完整转换表（Table 13 是引擎的回归基准）。
- 批评（p29）：常见做法直接把 EDF 数值贴到机构字母上、忽略 μ 差异 ⇒ 转换不稳。

### Outlook（Proposition 5.3, eq 28）
**Outlook = PD_FH − S&P TTC**。>0 ⇒ positive；<0 ⇒ negative；=0 ⇒ neutral。逻辑：PD_FH/EDF 是 PIT（短期），S&P TTC 是长期均衡；若相信风险终将回归 TTC 水平，二者之差就是未来趋势的指示。（引擎 `outlook: "+" iff pd_fh > ttc_pd` 与此一致。）
※ 注意方向直觉：PIT 高于 TTC ⇒ 当前压力大于长期均衡 ⇒ 论文把它读作"正面展望"（回归观）。讲解页需要把这个反直觉点讲清楚。

## 9. 总结（§6, p29）

四进路的最终定位：TiC=Behavior-specific，涉及 τ 的分布与违约概率，两个本质风险驱动因子；**其余三种都是特例**——agency 不知道 τ 的理论分布（从观测数据估）；银行假设 τ 为 Log-normal/Log-logistic（从历史数据回归）；学术界同时推导 τ 的理论分布和 PD 公式。

## 10. 引擎/前端对照速查

| 论文 | 引擎/前端 |
|---|---|
| eq 11 CCM, μ | `kmv_engine._attach_rating`（CCM/µ 用 \|r_a\|） |
| eq 12 TiC=CCM/μ (Q=1) | `RS = 100·TiC`，`rs_first_passage` |
| eq 13 PD_T | `ttc_conversion.pd_first_passage`（T=1） |
| eq 14 DD/EDF | `kmv_engine`（DD 无 τ 近似式版本，见课件笔记） |
| eq 22 IG 版 α | `ttc_conversion.cl_fh` |
| p26/27 CL_SP、ln(TiC_SP) | `ttc_conversion.cl_sp` / `sp_riskscore`（Q=0.625913） |
| eq 23 CCM* 唯一性 | `ttc_conversion.solve_ccm_star`（锚点 1.35373 / 2.22928） |
| Table 8 | `ttc_conversion._SP_TABLE8`、`web/js/fields.js TABLE8` |
| fine scale（Table 8 内插细分） | `_SP_FINE_SCALE`、`fields.js FINE_SCALE`（"AAA-" 为课程尺度产物） |
| eq 28 Outlook | `convert_fh_to_sp` 的 `outlook` |

## 11. 版本线索（供 versions.md 汇总）

- 本文自引：Yang (2019) "Theory and applications of Time-Consistent Credit Rating"，NYU Volatility Institute 五届年会（上海，2019-11-22）；Yang (2021) "Time-Consistent Credit Risk Rating – Approach and Applications"，World Finance Conference（挪威，2021-08）。
- 口述（2026-06-18）：流传版是早期版；新版算法更简；正写千页级专著（数学证明约 200 页，多数发表版不含证明）。
- 重要参考：US SEC (2012) Credit Rating Standardization Study；Crosbie & Bohn (2002) KMV；Avellaneda & Zhu (2001) Distance to Default；Carlehed & Petrov (2012) PIT–TTC 分解。
