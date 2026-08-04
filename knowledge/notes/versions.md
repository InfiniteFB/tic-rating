# Yimin Yang / TiC Credit Rating — 版本清单

调研日期：2026-07-31
调研范围：SSRN、Google Scholar、arXiv (q-fin)、ResearchGate、Academia.edu、Duke University 官网、PFPA 官网、通用网页搜索（含 filetype:pdf）
调研方法：WebSearch + WebFetch 多轮交叉检索，本地磁盘全盘检索（排除 node_modules/.venv）；并与项目 knowledge/notes/ 下同日产出的三份精读笔记（`paper-tic-30p-draft.md` 论文精读、`yang-memo-20260618.md` 电话沟通纪要精读、`market-based-ai-model.md` 75页培训 deck 精读）交叉核对版本线索。

## 结论摘要

全网未找到本论文的任何"新"可下载 PDF（SSRN / arXiv / ResearchGate / Academia.edu 均无命中）。该论文看起来主要通过会议演讲、PFPA 课程、私下分享（微信/邮件）流通，未走公开预印本平台。**更关键的是：杨一民本人在 2026-06-18 电话沟通中明确说过，项目手头流传的这份 word/PDF 稿"是很早版本的了"，他会再发比较新的版本，且"算法在新版中越来越简单"**（见 `yang-memo-20260618.md` 第131行）——也就是说本地30页 DRAFT 已被作者本人定性为旧版，真正的"最新版"不在本地也不在网上，需要直接向作者索取。本地已有的三份 PDF（30页论文 DRAFT + 75页/113页两份 PFPA 培训 slide）是目前能拿到的最完整材料，已统一归档到 `knowledge/papers/`。网上只找到 3-4 条"这篇论文/方法存在过"的书目线索（会议摘要页、Google Scholar 引用条目），均无正文可下载。

---

## 版本一：Universal Time-Consistent (TiC) Credit Rating — 30页 DRAFT（本地已有，已归档）

- **标题**：Universal Time-Consistent (TiC) Credit Rating
- **作者**：Yimin Yang, Executive In Residence, Duke University（yimin.yang@duke.edu）
- **页数**：30 页（letter size）
- **PDF 内部创建时间**：2026-05-30（Acrobat PDFMaker for Word 生成；文件内嵌的 Title/Author 元数据是残留的 JMLR Word 模板信息"Journal of Machine Learning Research"/"George Forman"，属于模板未清理干净，与真实作者无关）
- **页眉**：第2页起页眉为 "LOAN CREDIT RATING"（与任务描述一致）
- **来源**：本地磁盘，原路径 `/Users/yedoubleeagles/BaiduNetdiskWorkspace/pfpa/Universal Time-Consistent (TiC) Credit Rating simple.pdf`（非本次下载，本次任务开始前已存在）
- **归档路径**：`/Users/yedoubleeagles/BaiduNetdiskWorkspace/pfpa/knowledge/papers/yang-2026-tic-universal-time-consistent-draft-30p.pdf`
- **内容概要**：提出 Time-Consistent Rating Method（时间一致性评级法），回应2012年美国SEC/国会关于统一信用评级体系的报告要求；用统一数学公式在不同评级体系（银行内部、评级机构、学术模型）、不同时间视角（TTC/PIT）、不同主体类型（大企业/中小企业）之间生成可比评级；提出 No-Regulatory-Arbitrage rating conversion 作为应用之一。正文分为 "Background and Credit Rating 1.0"、"Credit Rating 2.0 is Needed" 等章节。
- **文中自引的其他版本/演讲**（见参考文献列表，构成本论文的"版本谱系"证据链）：
  - Yang, Yimin. (2019) *Theory and applications of Time-Consistent Credit Rating*, Fifth Annual Volatility Institute Conference at NYU Shanghai: "Credit Risk in a New Era", 2019年11月22日，上海
  - Yang, Yimin. (2021) *Time-Consistent Credit Risk Rating – Approach and Applications*, World Finance Conference, Kristiansand, 挪威，2021年8月

---

## 版本二（会议摘要，无正文）：Theory and Applications of Universal Time-Consistent Credit Rating — HKUST 2019 讲座

- **标题**：Theory and Applications of Universal Time-Consistent Credit Rating
- **演讲人**：Dr. Yimin Yang, Senior Director, Protiviti Inc.（当时头衔，早于 Duke/Loyal Trust Bank 阶段）
- **日期/地点**：2019年7月19日，香港科技大学（HKUST）LSK Building Room 3003，由 Center for Investing（金融系）与 Crypto-Fintech Lab（数学系）联合主办
- **来源 URL**：https://calendar.hkust.edu.hk/events/theory-and-applications-universal-time-consistent-credit-rating
- **是否可下载**：否——该页仅为活动预告页，摘要与本地30页版摘要高度一致（统一框架、first-hitting default / Distance-to-Default 联系、rating mapping），但页面本身未附论文PDF或讲义链接
- **与本地30页版关系初判**：应为同一研究脉络的早期（2019）版本/同题演讲，标题几乎完全一致，只是本地版去掉了"Theory and Applications of"前缀、加了"(TiC)"缩写。当时作者头衔为 Protiviti Senior Director，晚于此的 Duke 版本说明作者在 Protiviti → Loyal Trust Bank → Duke 的职业轨迹中持续携带并更新这份研究。

## 版本三（书目线索，无正文，无法定位下载页）：Time-Consistent Credit Rating: Approach and Applications

- **标题**：Time-Consistent Credit Rating: Approach and Applications
- **署名（Google Scholar 索引，疑似解析错误）**：显示为 "Y Yang, CR Officer, LT Bank" — 判断这是 Scholar 把作者栏 "Yimin Yang, Chief Risk Officer, Loyal Trust Bank" 错误拆分成了三个"作者"，实际仍是杨一民一人
- **来源**：Google Scholar 搜索命中一条记录，但页面未提供正文链接、年份或托管站点信息
- **尝试定位**：分别用 Google、Bing、DuckDuckGo 搜索该精确标题，均未找到可访问的托管页面（Bing/DuckDuckGo 返回不相关结果或反爬虫拦截页）
- **推测**：很可能对应本地版参考文献中提到的 2021年8月 World Finance Conference（挪威）投稿版本——该会议题目是"Time-Consistent Credit Risk Rating – Approach and Applications"，标题高度相似（仅"Credit Rating" vs "Credit Risk Rating"用词顺序差异，可能是引用转录误差或确有两个相近标题的版本）。World Finance Conference 官网（world-finance-conference.com）对自动化请求返回 403，未能在其历史会议页/论文列表中直接核实此条目；该会议的论文集由 Springer 出版为《Innovations in Finance: Proceedings of the World Finance Conference》，是否收录此文需要访问该出版物验证，未免费公开。
- **是否可下载**：否

## 版本四（会议记录，仅确认会议存在，未见程序单）：Fifth Annual Volatility Institute Conference @ NYU Shanghai (2019)

- **会议标题**：Credit Risk in a New Era
- **来源 URL**：https://vins.shanghai.nyu.edu/conference/fifth-annual-volatility-institute-conference-nyu-shanghai-credit-risk-new-era
- **说明**：页面确认会议真实存在，程序委员会名单中未见"Yang"（committee 是別的教授），但本地论文自己的参考文献明确写了杨一民在此会议做过同题报告（2019年11月22日）。页面提供的会议议程 PDF 链接（`research.shanghai.nyu.edu/.../2019会议日程 EN_0.pdf`）经 curl 验证已失效（返回站点404页面），无法核实具体场次时间或下载讲义。
- **是否可下载**：否（链接已失效）
- **⚠ 名称不一致待核实**：本地论文参考文献写的是 "**Fifth** Annual Volatility Institute Conference"（2019），但 75 页 PFPA 培训 deck（见下方"版本六"）第10页杨一民自述研究经历时写的是 "**First** Annual Volatility Institute Conference"（NYU, 2019）。两者不可能同时为真，只能是其中一份材料的笔误——论文是正式出版物性质、更可能准确，deck 是口语化 slide、更可能是随手写错顺序词，暂以论文的"Fifth Annual"为准，但未找到第三方信源（如 VINS 官网历年会议列表）交叉验证具体是第几届。

## 版本五、六（本地已有，已归档）：PFPA Training Course 两份 slide deck

论文之外，杨一民以 "PFPA Training Course – To Prepare for working in Financial Industry" 系列讲义的形式，把同一套 KMV/TiC 方法又完整讲了两遍（面向培训学员，公式内核与论文一致，外面包了一层零基础的金融/期权定价扫盲内容）：

- **75页版**《Market-Based Credit Risk Rating Model for Public Companies》——PDF 内部创建时间 2026-07-15，与同目录讲座录播 `GMT20260715-003540_Recording*.mp4/.m4a` 及 `TiC TTC conversion.xlsx` 为同一天material。归档路径：`knowledge/papers/yang-2026-market-based-credit-risk-rating-ai-model-75p.pdf`
- **113页版（标题页标注 "Course #2"）**——PDF 内部创建时间 2026-06-23，比75页版更早、篇幅更大。归档路径：`knowledge/papers/yang-2026-market-based-credit-risk-rating-course2-113p.pdf`
- 两者均是本次任务开始前就已存在于本地磁盘的材料（非本次网络下载所得），来源均为本地磁盘（`录播/`目录与项目根目录），非网络下载
- 详细逐页精读见 `knowledge/notes/market-based-ai-model.md`（同批次笔记，本次任务顺带交叉核对了其中的版本线索）

---

## 未能获取的版本 / 页面

| 条目 | URL / 位置 | 原因 |
|---|---|---|
| Google Scholar 索引的 "Time-Consistent Credit Rating: Approach and Applications" 正文 | 无法定位托管页面 | 多引擎搜索无果，可能只存在于会议内部系统或纸质/PPT形式，未被通用搜索引擎收录 |
| NYU Shanghai 2019 会议日程 PDF | research.shanghai.nyu.edu/sites/default/files/media/2019会议日程 EN_0.pdf | 链接已失效（404，经 curl 验证返回站点自定义404页） |
| World Finance Conference 2021（挪威）论文/程序页 | world-finance-conference.com/conference.php?id=21 及关联 programFinalWFC.php 等 | 站点对自动化请求返回 403 Forbidden，需人工浏览器访问；该会议论文集经 Springer 出版，非免费 |
| Yang, Yimin. "Hierarchical allocation method for capital: a general method", *Journal of Credit Risk*（Risk.net, 2025-09-17） | https://www.risk.net/node/7962191 | Risk.net 是订阅付费墙站点，需登录/付费账号，未注册获取 |
| PFPA 官方教育站是否有该论文/课程讲义公开页 | https://www.pfpa-education.com | 已访问，站点为 Shopify 电商结构，公开页面仅见 "modern-mathematics-for-technology-ai-finance" "blockchain-cryptocurrency-investment-workshop" "pfpa-financial-summer-camp" 等课程条目，未见与 credit rating / TiC 直接对应的公开页面或免费讲义下载 |
| sites.google.com/site/yiminecon/ | Google Sites 链接 | 该地址会跳转到 Google 登录页（`accounts.google.com/ServiceLogin?...`），判断为私有/未公开站点，按规则未登录访问，且无法确认是否为同一人 |

未发现任何声称是该论文但要求注册/登录的镜像站（如 Scribd）——搜索结果中没有出现这类站点。

### 已确认存在、但目前既不在本地也不在网上的材料（来自作者本人口述，见 `yang-memo-20260618.md`）

这三项不是网络搜索找到的线索，而是杨一民本人在 2026-06-18 电话沟通中主动提到、目前项目完全没有拿到的材料，记录在此以便后续直接向作者索取，而不是继续在网上搜索（搜也搜不到，均未发表/未公开）：

1. **更新版 TiC 论文/算法**——作者原话大意：流传的这份是很早的版本，他会发比较新的版本，新版算法"越来越简单"。本地30页 DRAFT 应视为**已过时**的版本，不是作者当前的最新工作。
2. **一本尚在写作的专著**（估计上千页，含约200页数学证明）——作者说目前发表/流传的版本通常不含证明过程（"能花时间读懂这个东西的人已经不容易"），完整证明只会出现在这本书里。书名、进度、出版计划均未提及。
3. **独立课程 "Unified Credit Ratings"**——75页 PFPA deck 第50页提到，这门课把 TiC 方法推广到"所有信用评级"，不限于本项目接触到的 KMV/市场化评级这一个分支。目前项目手上的论文+两份 PFPA deck 只覆盖"上市公司+市场数据"这一个应用子集，这门课的讲义/论文完全没有找到，也未在网上搜到任何公开信息（推测是内部/未公开课程，非公开发表物）。

### PFPA 背景补充（来自电话沟通，非网络搜索，仅作背景参考）

杨一民是 PFPA（Pacific Financial Professional Association）的发起人/负责人：课程收入全部捐出，由20-30位银行从业者义务授课；每年10月在亚特兰大（Georgia Convention Center）举办年会（下一届 2026-10-25），免费、约40位讲者、10个 track、四五百人规模；另办夏令营。这解释了为什么本地能找到"PFPA Training Course"系列 slide 而非独立发表的期刊论文——他的材料分发渠道主要是这个培训体系，而非学术出版或预印本平台。

---

## 作者其他著作 / 相关材料清单

1. **Market-Based Credit Risk Rating Model for Public Companies**（PFPA Training Course 系列讲义，75页版 + 113页 "Course #2" 版，均已归档，详见上方"版本五、六"）
   - 75页版另有两份非本次下载所得的旧副本（MD5 不同、首页内容一致，应为不同日期重新导出），未额外归档，只记录路径备查：`/Users/yedoubleeagles/Downloads/Market Based Credit Risk Rating AI Model for Public Companies.pdf`（2026-06-16 导出）、`/Users/yedoubleeagles/BaiduNetdiskWorkspace/pfpa/录播/Market Based Credit Risk Rating AI Model for Public Companies(1).pdf`（2026-07-15 导出，即归档版底本）
   - 封面确认课程属于 "PFPA Training Course"，与 Pacific Financial Professional Association（pfpa-financial.com，杨一民任 President）直接对应
   - 未在网上找到独立公开下载页，判断为课程内部讲义，非公开发表论文

2. **Hierarchical allocation method for capital: a general method**（*Journal of Credit Risk*，Risk.net，2025-09-17）
   - 主题是银行风险资本的层级分摊方法（Hierarchy Allocation Method），与 TiC 评级不是同一篇，但同属信用风险方法论产出
   - 付费墙，未下载，见上表

3. **会议演讲记录**（均为二手书目线索，无独立可下载材料）：
   - HKUST《Theory and Applications of Universal Time-Consistent Credit Rating》，2019-07-19
   - Volatility Institute @ NYU Shanghai《Theory and applications of Time-Consistent Credit Rating》，2019-11-22（deck 里误写"First Annual"，论文写"Fifth Annual"，见版本四的不一致说明）
   - World Finance Conference（挪威）《Time-Consistent Credit Risk Rating – Approach and Applications》，2021-08

4. **尚未取得、仅确认存在**：更新版 TiC 论文（作者称算法更简单）、约千页专著（含200页数学证明）、独立课程"Unified Credit Ratings"——均见上方"已确认存在、但目前既不在本地也不在网上的材料"

5. **机构/背景页**（用于核实身份，非著作本身）：
   - Duke Scholars 主页：https://scholars.duke.edu/person/yimin.yang （Executive in Residence, Social Science Research Institute；Scholarly Works 板块目前为空，尚未收录论文）
   - Duke MIDS 讲者介绍：https://datascience.duke.edu/about/news/speaker-dr-yimin-yang/
   - Duke Pratt 活动页：https://pratt.duke.edu/events/141104 （已404，可能是过期活动链接）
   - Risk.net 作者页：https://www.risk.net/author/yimin-yang
   - PFPA 官网：https://www.pfpa-financial.com/ 、 https://www.pfpa-education.com

### 需注意的同名混淆

搜索中出现多个"Yimin Yang"重名人物，均已排除，非本任务目标人物：
- 中国科学院大学考古学方向 Yimin Yang（Academia.edu / ResearchGate，青铜时代/早期铁器时代研究）
- 中国人民大学金融学院在读博士 Yimin Yang（ResearchGate）
- 加拿大 Lakehead / Western University 的 Yimin Yang（RateMyProfessors，教学评价页，学科不明）
- Florida International University 机器学习方向 Yimin Yang（Google Scholar/OpenReview）
