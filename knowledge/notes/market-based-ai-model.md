# Market-Based Credit Risk Rating Model for Public Companies — 精读笔记

**来源**:`录播/Market Based Credit Risk Rating AI Model for Public Companies(1).pdf`(75 页,PFPA Training Course 系列)
**讲者**:Yimin Yang(杨一民,Duke University Executive in Residence,"Universal Time-Consistent (TiC) Credit Rating" 方法提出者)
**配套材料**:同目录 2026-07-15 讲座录播(`GMT20260715-003540_Recording*.mp4/.m4a`)+ `TiC TTC conversion.xlsx`(同日文件)
**对照材料**:30 页论文草稿《Universal Time-Consistent (TiC) Credit Rating》(`Universal Time-Consistent (TiC) Credit Rating simple.pdf`)、113 页教学课件(`课件.pdf`,PFPA Course #2,细节见项目 memory `kmv-tic-formula-discrepancy`/`kmv-engine-implementation`/`em-homework-annualization`)

---

## 1. 材料定位

这是一份 **PFPA(Pacific Financial Professionals Association)"金融行业入职培训课"的演讲 slide deck**,标题页写明系列名 "PFPA Training Course – To Prepare for working in Financial Industry: An In-depth Introduction Best Real World Practices",本份的子标题是 **"Market-Based Credit Risk Rating Model for Public Companies"**——注意:标题页(p.1)本身**没有"AI"字样**,"AI"只出现在文件名里("...AI Model for Public Companies"),正文 75 页中也没有任何一页真正讲解 AI/LLM/MCP 工程内容(详见第 3 节的关键发现)。

- **体裁**:讲座用 PowerPoint 导出 PDF(不是论文、不是白皮书),版式是"标题+要点列表",公式单独成页,几乎没有连续论述性文字,需要配合课堂讲解(即同目录录播)才能完整理解。
- **面向对象**:准备进入金融行业的学生/从业者(PFPA 培训学员),假定读者金融/随机过程背景较薄弱——因此用了约 40% 篇幅(p.14–44)从零讲债券市场、有效市场假说、布朗运动史、Black-Scholes-Merton,这在论文和(已知的)课件核心章节里都没有这么细。
- **讲什么**(结构见 p.3 Contents):①信用风险管理导论 + "LLM/AI/Function calling/MCP/python fastMCP/MCP SDK" ②金融市场导论 ③数据与自动化 ④KMV/TiC/评级机构/银行评级方法 ⑤AI 落地自动化 ⑥评级转换:PIT→TTC。其中①⑤两块"AI"内容**有标题、无正文**(见下)。
- **与录播的关系**:文件时间戳(2026-07-15)与"EM 作业年化口径" memory 记录的课程录播日期完全一致,`TiC TTC conversion.xlsx` 也是同日文件——**这份 PDF 就是 2026-07-15 那场讲座当天发的配套 slide**,不是独立的第三份材料,而是与已有"30 页论文"+"113 页课件"同属杨一民 PFPA/TiC 材料体系的最新一份,内容组织方式比课件更"体系化/培训化"。

## 2. 逐节要点(标页码)

### 封面/免责声明(p.1–2)
- p.1 标题:"Market-Based Credit Risk Rating Model for Public Companies"。
- p.2 Disclaimer:观点仅代表作者个人,不代表雇主/机构立场。

### Contents 总览(p.3)
六大板块(见"材料定位")。第一条明确写"LLM/AI/Function calling(context engineering)/MCP/python fastMCP/MCP SDK",第五条"AI Implementation Automation"——这是全篇唯一出现"AI/LLM/MCP"字样的地方。

### Credit Risk in Commercial Banks(p.4–13)
- p.4 分节标题是"Introduction to Credit Risk Management and as LLM"——**文字明显被截断**(像是想接上 Contents 那句 LLM/AI 介绍,但只留半句"and as LLM"就没有下文),是本篇"AI 名不副实"的第一处物证。
- p.5–7:信用/贷款常占银行资产 80–90%;信用风险管理两大支柱——资本管理(Basel II)、损失拨备管理(CECL);信用评级是 Basel 参数(PD/LGD/EAD/Correlation)的基石。
- p.8:评级生成方——银行、评级机构(Moody's/S&P/Fitch)、金融公司、学术研究者,彼此方法不同故不完全可比。
- p.9:**2012 年 SEC 向国会提交报告**,追问"能否统一/标准化所有评级",SEC 自己的结论是 "seems impossible"。
- p.10:杨一民自述研究经历——World Finance Conference(挪威 2021)、"First Annual Volatility Institute Conference"(NYU 2019);给出三方法论分类:评级机构=按流程(process-specific),银行=按历史分布(distribution-specific,面向 TTC),学术界=按违约事件(default-specific,基于市场数据,面向 PIT)。
- p.11:**Moody's B 级公司历史违约率表(2001–2016)**——同一个"B"档,PD 从 2001 年 9.8% 掉到 2007 年 0.0%,2009 年又跳回 7.6%,直观展示 TTC 标签下企业真实风险仍随周期大幅波动。
- p.12:银行评级两分——Commercial(大/上市/非上市/中/小,标注"No Data??")vs. Retail(房贷/信用卡,FICO,征信机构 Experian/Equifax/TransUnion)。
- p.13:学术机构方法特点——市场数据、短期、非上市证券;违约理论=资产跌破负债;举例 KMV EDF,理论基础"Equity is a Call Option with Debt being the strike"。

### Information in Stock Price(p.14–20)
股票基础扫盲:股票定义、公众/非公众公司流动性与价格差异、上市动机、股价即未来现金流折现期望值、有效市场假说(EMH)、Eugene Fama(1965 提出随机游走假说,2013 诺贝尔奖)。纯 101 内容,与 TiC 方法本身无直接新知识。

### Credit and Debt Market(p.21–28)
债券/贷款市场扫盲(面值/利息/终值、国债分类、市政债/MBS/公司债、长短期债务)、收益率曲线(正常/倒挂,附 2023/24 vs. 2021 实例图)、债券价格与利率反向关系 $\text{Price}=\dfrac{100}{1+\text{interest rate}}$、银行信用风险管理"三阶段"演进史(Pre-CRO 线性风险时代 → Basel 极端风险/资本要求时代 → 压力测试系统性风险时代)、损失分布图(Expected Loss=拨备,尾部=资本,尾部面积=银行失败概率,示例 0.1%)。行业背景扫盲,非 TiC 数学核心。

### Market Value of a Company(p.29–37)
账面价值 vs. 市场价值、会计恒等式 $\text{Asset}=\text{Liabilities}+\text{Equity}$(此处是会计口径,非市场价值)、资产负债表负债分类(流动/长期)、市场价值下 $\text{Equity}=\text{Asset(market value)}-\text{Debt}$,并提出核心矛盾:Asset 不可观测、Debt 未来到期、只有 Equity 当下可观测——引出 p.37 "Equity is a Call option on the Asset with Debt being the Strike"(Robert Merton 的洞察)。

### Option Pricing Theory(p.38–44)
布朗运动发现史(Robert Brown 1827 观察花粉颗粒)→ Einstein 1905 扩散方程
$$\rho(x,t)=\frac{N}{\sqrt{4\pi Dt}}e^{-x^2/4Dt}$$
→ 高斯分布 → 股价=随机游走类比(投资者交易=分子碰撞花粉)→ Wiener 过程(1923)→ Ito 引理(1944)→ Feynman 路径积分(1948)→ **1973 Black-Scholes-Merton 看涨期权定价公式**:
$$P\cdot\Phi\!\left(\frac{\ln(P/K)+(r+\sigma^2/2)T}{\sigma\sqrt{T}}\right)-K e^{-rT}\Phi\!\left(\frac{\ln(P/K)+(r-\sigma^2/2)T}{\sigma\sqrt{T}}\right)$$
(1997 年诺贝尔奖)。纯期权定价史普及,论文/课件通常默认读者已知,这里专门展开给零基础学员看。

### Credit Rating Theory(p.45–50)
- 资产是否跌破负债需要:资产未来分布(布朗运动)+ Merton 的看涨期权关系(可用 BSM 公式从 Equity 反解 Asset)。
- p.48:明确点名 KMV——DD/EDF 由 KMV 首创,是 PIT 前瞻评级,"Moody's spent $220 millions to purchase KMV";但存在"most significant problem: unstable rating with huge volatility","not suitable for banks to use as banks often require Through-The-Cycle (TTC) ratings"。
- p.49:资产路径图解——今日资产/今日负债 → 未来资产分布 → 按分位数映射 A+/A/B/C/D/Default 字母评级,EDF=分布左尾面积。全篇最直观的 KMV 图。
- p.50:杨一民自陈研究成果——"revise EDF methodology and produce stable ratings that is consistent with Bank's TTC requirements";研究发表于 WFC(挪威 2021)、NYU Volatility Institute(2019);"My method is called Time-Consistent (TiC) approach that can unify all credit ratings";并提到存在**另一门独立课程 "Unified Credit Ratings"**,把 TiC 方法推广到不限于 KMV/市场化方法的所有评级类型——本课(现在这门)只讲"KMV and TiC ratings for public companies"这个子集。

### KMV Rating Method(p.51–58)
- 方法组成:理论假设、参数(可观测/不可观测)、关系方程、输入(财务/市场)、算法、输出。
- 理论假设(p.53):资产服从几何布朗运动 $A_t=A_0\cdot e^{\eta_A t+\sigma_A W_t}$。
- 参数(p.54):$A_t,\sigma_A,\eta_A$ 不可观测;$D$(短期债+0.5×长期债)、$r$ 可观测。
- 关系方程(p.55,**风险中性/无套利定价,用 $r$**):
$$E=A_0\Phi\!\left(\frac{\ln(A_0/D)+(r+\sigma_A^2/2)t}{\sigma_A\sqrt t}\right)-D e^{-rt}\Phi\!\left(\frac{\ln(A_0/D)+(r-\sigma_A^2/2)t}{\sigma_A\sqrt t}\right)$$
- 输入调整(p.56):$D=\text{ShortTermDebt}+0.5\times\text{LongTermDebt}$;股价需加回分红;需要总股数、1 年期无风险利率。
- 算法(p.57):E-M 双步交替(E 步用当前 $\sigma_A$ 反解 $A$,M 步用 $A$ 序列标准差重估 $\sigma_A$),$\eta_A$ 同步可得。
- 输出公式(p.58,**真实世界测度,用 $\eta_A$**,与 p.55 用 $r$ 形成对比):
$$DD=\frac{\ln(A_0/D)+(\eta_A-\sigma_A^2/2)}{\sigma_A},\qquad EDF=\Phi(-DD)$$

这一段把"解 $A,\sigma_A$ 时为何用无风险利率 $r$(风险中性定价),算违约概率 DD/EDF 时又换成真实资产回报率 $\eta_A$(真实世界测度)"的分工讲得比较清楚——两套测度各司其职,这个对比逻辑在已有 memory 中是隐含的(只记录数值验证结果),这份 deck 用两页并列公式的方式把逻辑显式摆了出来,是不错的教学素材。

### TIC Rating Method(p.59)
$$TiC=\frac{\sigma_A^2}{\ln^2(A_0/D)}$$
只给出 $Q=1$ 特例形式,不含论文里更一般的置信水平参数 $Q$。

### Deriving KMV and TIC Ratings(p.60–70)
完整的"从下载数据到算出最终 DD/TiC/EDF"工程流程:
- p.61–62:取数(股价时间序列、总股数、近几季资产负债表、近几季 1 年期无风险利率)→ 处理(逐日加回分红、$Equity=Price\times Shares$、$D=ST+0.5LT$、一年≈250 交易日)。
- p.63:定义 Equity 序列 $Equity_*=\{E_{t_1},\dots,E_{t_N}\}$ 与 **E2D 比例序列**
$$z_{t_i}=\frac{E_{t_i}}{D_{t_i(Q)}\cdot e^{-r_{t_i(Q)}\tau_{t_i}}},\qquad \tau_{t_i}\approx 1-\frac{t_i-t_i(Q)}{365}$$
("E2D" 这个序列命名在已知的课件笔记中未见提及,可能是这份 deck 更明确的记号)。
- p.64–65:定义特殊函数
$$g(x,\sigma,\tau)=x\,\Phi\!\left(\frac{\ln x+\sigma^2\tau/2}{\sigma\sqrt\tau}\right)-\Phi\!\left(\frac{\ln x-\sigma^2\tau/2}{\sigma\sqrt\tau}\right)$$
单调递增,可用二分法($x_{mid}=(x_{left}+x_{right})/2$)求逆 $g^{-1}$——与 memory 中"g 函数+二分法反解"完全一致。
- p.66–69:EM 算法逐步展开——初始化 $A_{t_i}^{(0)}=E_{t_i}$;E 步解 $g(x_{t_i}^{(m)},\sigma_A^{(m-1)},\tau_{t_i})=z_{t_i}$ 得每日 $x_{t_i}^{(m)},A_{t_i}^{(m)}$;M 步用 $R_{t_i}^{(m)}=\sqrt{250}\ln(A_{t_{i+1}}^{(m)}/A_{t_i}^{(m)})$ 重估 $\sigma_A^{(m)}=\text{Std}\{R_{t_i}^{(m)}\}$、$R_A^{(m)}=\text{mean}\{R_{t_i}^{(m)}\}$;收敛后声称
$$R_A^{(m)}\to R_A=\eta_A-\tfrac12\sigma_A^2$$
  ⚠ 这里需要小心,见第 3 节——这个写法与已知的"R̄ 年化陷阱"同构。
- p.70:严格版(含 $\tau$)与近似版 DD/EDF 并列给出:
$$DD=\frac{\ln(A/D)+(\eta_A-\frac12\sigma_A^2)\left(1-\frac{t_N-t_N(Q)}{250}\right)}{\sigma_A\sqrt{1-\frac{t_N-t_N(Q)}{250}}}\;\approx\;\frac{\ln(A/D)+(\eta_A-\frac12\sigma_A^2)}{\sigma_A}$$
**这是本次精读最有价值的发现之一**:它把"课堂上为何可以直接用不含 $\tau$ 的近似式 $DD=(\ln(A/D)+R_A)/\sigma_A$"的理由显式写在了 slide 上——因为 $\tau=1-(t_N-t_N(Q))/250$ 在最近交易日通常接近 1,$\tau$、$\sqrt\tau$ 项可近似略去。

### Credit Rating Conversions(p.71–75)
- p.72:$\text{TiC Risk Score}=100\times\dfrac{\sigma_A^2}{\ln^2(A_{t*}/D_{t*})}$(即论文式 5 的 RiskScore)。
- p.73:首过违约概率
$$CCM=\frac{\sigma_A^2}{R_A\cdot\ln(A_{t*}/D_{t*})},\quad \mu=\frac{\ln(A_{t*}/D_{t*})}{R_A}$$
$$PD_{PIT}=\Phi\!\left(\frac{1}{\sqrt{CCM}}\Big(\frac1{\sqrt\mu}-\sqrt\mu\Big)\right)+e^{2/CCM}\Phi\!\left(-\frac{1}{\sqrt{CCM}}\Big(\frac1{\sqrt\mu}+\sqrt\mu\Big)\right)$$
明确把首过违约概率标记为 **$PD_{PIT}$**(论文对应记号是 $PD_{FH}$)。
- p.74:到期违约概率 $DD=(\ln(A_{t*}/D_{t*})+R_A)/\sigma_A$,$EDF=1-\Phi(DD)=\Phi(-DD)$(与 p.58 写法等价,仅符号互换)。
- p.75(**全篇最后一页**):"Rating Conversion (Spreadsheet)" 只列清单——TiC Risk Scores、TiC PIT PD、**TiC TTC PD**、TTC PD to SP Rating、**Outlook = TTC PD – PIT PD (=sign of PIT PD – TTC PD)**、KMV DD、KMV EDF——**没有给出 PIT→TTC 转换本身的公式**(论文第 5.3 节的 No-Regulatory-Arbitrage 方法、$Q=0.625913$、$CML=e^{1.35}$、Prop 5.2.1/5.2.2、S&P Table 13/14 均未出现),只说这些量"在 spreadsheet 里",对应同目录 `TiC TTC conversion.xlsx`。

## 3. 与论文/课件的对照

**结论先给**:这份 75 页 deck 不是论文或课件的简单重复,而是**同一套 TiC/KMV 方法的"培训课版"包装**——数学核心(DD/EDF/TiC/CCM/μ/PD_PIT 公式)与论文、课件逐字一致(仅记号/命名略有差异),外面套了一层论文和课件都没有的、面向零基础学员的"金融行业导论"外壳(p.4–50,约三分之二篇幅);深入 EM 算法内部时,还暴露出与已知"课件不自洽"同类的新细节问题。

### 3.1 相同的部分(一笔带过)
- DD、EDF、TiC、CCM、μ、$PD_{PIT}$(=论文的 $PD_{FH}$)公式与已验证的课件/论文公式逐字一致,包括用 $|\eta_A-\sigma_A^2/2|=R_A$ 代替原始 $\eta_A$ 的写法。
- $g$ 函数+二分法反解、EM 的 E/M 双步结构,与 `kmv_engine.py` 的实现思路完全对应。
- 数据处理约定(分红加回、$D=ST+0.5LT$、250 交易日/年、递归用"最近一季财报")与团队已实现的 `rating_inputs.py` 默认口径一致。
- TiC 公式仍是 $Q=1$ 特例($TiC=\sigma_A^2/\ln^2(A/D)$),不含论文更一般的置信水平参数 $Q$——与课件相同。
- PIT→TTC 转换的具体公式(Q=0.625913、CML=e^1.35、Prop 5.2.1/5.2.2)**两份 slide 材料(课件+本 deck)都没有给出**,均只停留在"结果清单"层面,详细推导只在论文第 5.3 节——印证了此前的判断(课件 slide 113 空白)不是偶然缺失,而是杨一民的 slide 材料一贯把 TTC 转换的具体代数留给论文和 Excel,不放进 PPT。

### 3.2 新增/不同的部分(详写)

**(1)"AI 培训"名不副实——本篇最大的反直觉发现。** 文件名叫"...AI Model...",Contents(p.3)明确列出"LLM/AI/Function calling(context engineering)/MCP/python fastMCP/MCP SDK"和"AI Implementation Automation"两大板块,但整份 75 页里**没有一页真正讲解**这些内容:p.4 分节标题写到"...and as LLM"就戛然而止(明显是编辑时删减未清理干净的痕迹),后面直接跳进纯金融/数学内容,直到第 75 页结束都没有回到 AI 话题。这份材料关于"AI"的部分,要么当天课堂上只口头讲了没配 slide(需查录播),要么是计划中但尚未成稿的部分——**不要误以为这份 PDF 包含 AI/LLM 工程方法论,它实质仍是一份纯 KMV/TiC 量化方法课件**。

**(2)大篇幅金融基础与监管背景外壳(p.4–50,新增,论文和课件核心章节都没有)**:
- Basel II / CECL / 压力测试 / 模型风险管理的银行信用风险管理三支柱(p.5–6、27–28);
- 2012 年 SEC 向国会报告"评级能否统一"、结论"seems impossible"(p.9)——杨一民明确摆出来 motivate 自己研究的监管背景引用,论文/课件笔记中均未见提及;
- Moody's B 级公司 2001–2016 历史违约率表(p.11),作为"TTC 评级实际仍随周期剧烈波动"的实证例子;
- 评级生成方三分类(机构/银行/学术)及 Commercial vs Retail 银行评级分类体系(p.10、12);
- 完整债券市场(p.21–26)、期权定价史(布朗运动 1827→Einstein 1905→Wiener 1923→Ito 1944→Feynman 1948→BSM 1973,p.38–44)扫盲内容。
这些是纯粹的行业常识教学内容,和 TiC 方法本身无直接关系,但显示这次课比早期课件更"体系化"。

**(3)作者个人研究谱系的明确自述(p.10、45–50,新增)**:
- 点名两次学术会议:World Finance Conference(挪威,2021)、"First Annual Volatility Institute Conference"(NYU,2019);
- **明确提到存在另一门独立课程"Unified Credit Ratings"**,专门把 TiC 方法推广到"所有信用评级"(不限于 KMV/市场化方法这一类)——此前论文、课件、memory 笔记中均未出现过这条信息,说明杨一民的 TiC 框架有一个更大的、尚未被本项目接触到的课程/论文体系,当前项目手上的"论文+课件+这份 deck"只是他 TiC 研究里针对"上市公司+市场数据"这一个应用分支。
- 明确点出 KMV 的痛点(Moody's 收购 KMV 花费 2.2 亿美元、评级不稳定、不满足银行 TTC 需求)作为 TiC 方法存在的动机——这个"问题→动机→方法"的叙事线,论文(偏数学推导)和课件(偏公式罗列)都不如这里讲得直白。

**(4)EM 算法与 τ 近似的书面依据首次出现(p.66–70,重要,可与已有待验证问题直接对照)**:
- p.70 显式给出"精确式(含 τ)→ τ≈1 近似 → 无 τ 简化式"的推导过程,**首次以书面 slide 形式确认了"em-homework-annualization" memory 中仅靠课堂录音转写才得出的近似依据**("直接用 R_A,不需要单独求 η_A")。这是一条可以正式引用、不再需要仅依赖录音转写的书面证据。
- 但同时,p.69 的写法 $R_A^{(m)}\to R_A=\eta_A-\frac12\sigma_A^2$(其中 $R_A^{(m)}$ 定义为 $R_{t_i}^{(m)}=\sqrt{250}\ln(A_{t_{i+1}}/A_{t_i})$ 的样本均值)**与"kmv-tic-formula-discrepancy"/"em-homework-annualization" memory 中记录的年化陷阱是同一结构**:若 $R_{t_i}$ 的期望是 $(\eta_A-\frac12\sigma_A^2)/\sqrt{250}$(因为该期望只放大了 $\sqrt{250}$ 倍而非 $250$ 倍),样本均值 $R_A^{(m)}$ 理应收敛到 $(\eta_A-\frac12\sigma_A^2)/\sqrt{250}$,而不是 slide 上写的 $\eta_A-\frac12\sigma_A^2$ 本身。**这份新 deck 逐字重复了课件同样的"漏乘一次 √250"简写**,而不是提供了修正版。这不是新发现的错误(已经在 `em-homework-annualization.md` 里靠课堂口头澄清解决,口径是"正确年化 $R_A=\sqrt{250}\times\bar R$"),但值得记一笔:**该简写是杨一民 slide 材料的系统性习惯,在两份独立 slide 稿(课件+本 deck)中都存在**,不是某一次课件的孤立笔误;后续若再拿到第三份材料,大概率会重复出现同样的写法,处理时应统一按 memory 里已验证的口径(乘 √250)走,不要直接照抄 slide 字面公式。
- **新发现的一处 slide 内部不一致**:$\tau$ 的定义在 p.63/p.67 用"日历天/365"($\tau_{t_i}\approx 1-\frac{t_i-t_i(Q)}{365}$),但结构相同的量在 p.70 最终 DD 公式里却写成"/250"($1-\frac{t_N-t_N(Q)}{250}$)。两处分母不同,大概率是 p.70 汇总/复用 EM 部分(全篇都用 250 做交易日年化)时的笔误延续,但不能完全排除是"日历天用 365、交易日用 250"两套并行约定。**建议后续如需精确复现这份 deck 的口径,双重核对 `kmv_engine.py`/`rating_inputs.py` 里 τ 的实现到底按 365 还是 250**,目前引擎口径未见明确记录这一点。

**(5)命名/记号差异(非本质,但方便对齐代码)**:
- 论文的 $PD_{FH}$(首过 PD)在这份 deck 里命名为 **$PD_{PIT}$**,更直接地把"首过违约概率=PIT 视角"这一概念挂钩,可用作代码/文档注释的命名桥梁(`pd_fh` ≈ "市场当下视角"的 PD)。
- "RiskScore"(论文式 5)这里写作"TiC Risk Score",同一物理量,措辞更口语化。
- E2D 比例序列 $z_{t_i}=E_{t_i}/(D_{t_i(Q)}e^{-r\tau})$ 被单独命名为"E2D_\*",课件笔记中未见这个专门命名。
- p.75 的"Outlook = TTC PD – PIT PD (=sign of PIT PD – TTC PD)"内部符号有点绕:字面写的是"TTC−PIT"差值,括号又说"等于 PIT−TTC 的符号"——两者符号相反(除非 Outlook 只取符号、"TTC−PIT"是给另一中间量用),与 `em-homework-annualization` memory 记录的口径"Outlook=sign(PIT−TTC),PIT<TTC→Positive"**不完全对得上字面**。建议直接采用 memory 里经课堂澄清的版本,这页 slide 原文只作辅助线索,不要按字面直接实现。

## 4. 值得引用的原句(英文+页码)

- p.1: *"Market-Based Credit Risk Rating Model for Public Companies"*(标题不含"AI"二字)
- p.3: *"Introduction to Credit Risk Management, as well as LLM/AI/Function calling(context engineering)/MCP/python fastMCP/MCP SDK"*(全篇唯一提及 AI/LLM/MCP 之处,后文未见展开)
- p.9: *"SEC's answer: seems impossible."*
- p.23: *"This model is for Default Ratings"*
- p.37: *"Equity is a Call option on the Asset with Debt being the Strike"*(归于 Robert Merton)
- p.48: *"Moody's spent $220 millions to purchase KMV"*;*"banks often require Through-The-Cycle (TTC) ratings"*
- p.50: *"My method is called Time-Consistent (TiC) approach that can unify all credit ratings"*;*"My course: 'Unified Credit Ratings' applies my method to all ratings"*
- p.75: *"Outlook = TTC PD – PIT PD (=sign of PIT PD – TTC PD)"*

## 5. 对项目的启示

- **"方法讲解页"素材**:目前 `web/js/views/appendix.js` 只做数据溯源(provenance),项目里还没有一个专门讲"这个评级是怎么算出来的"的叙事页面。这份 deck 的 p.45–50(问题动机:资产不可观测 → Merton 期权洞察 → KMV 首创但不稳定 → TiC 改进)+ p.49 的资产路径→评级字母图解,是现成的、非技术读者也能看懂的"讲故事"素材,比论文和课件都更适合直接改写成仪表盘的方法论科普栏目。
- **p.70 的 τ≈1 近似推导**可直接作为"为什么 PIT PD 卡片用不含 τ 的简化 DD 公式"的脚注依据来源,替代目前只能引用课堂录音转写的做法,书面 slide 出处比纯录音转写更可信。
- **需要代码/口径核对的两个具体问题**(建议后续单开任务跟踪,不必现在处理):① p.69 的 $R_A$ 年化写法是否会被误用(已知需要 memory 里"乘 √250"的修正,这份 deck 没有提供修正,只是再次确认该简写在杨一民材料里普遍存在);② p.63/67 用 365、p.70 用 250 的 τ 分母不一致,需要与 `kmv_engine.py`/`rating_inputs.py` 里 τ 的实际实现对一下。
- **"Unified Credit Ratings" 这门独立课程**的存在提示:如果项目未来想扩展到"不限市场化方法的评级统一框架"(比如把银行内部评级、机构评级也纳入同一套 TiC 视角),那门课可能是更对口的下一步资料来源;但目前项目范围(KMV/TiC for 上市公司)不需要涉及。
- **AI/LLM/MCP 相关内容目前是空的**:如果对"杨一民怎么讲 AI 落地"感兴趣,需要去看同目录的录播视频/音频而非这份 PDF——本笔记不构成对该部分内容的调研,后续如有需要应另起一次转写/精读任务。
