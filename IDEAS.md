# Build-A-Dataset — 3 个方案（2026-11-07 11:45 起草）

官方要点（见 `GUIDE.txt`）：
- 主数据必须**本届活动期间自己采集**、来自真实世界；公开数据/API 只能做补充；**严禁伪造**，模拟/估计值必须标注。
- 必须是**可交互的应用**（网页/地图/工具/游戏），数据要驱动核心功能。
- 提交（Devpost）：GitHub 公开仓库（代码 + 数据集 CSV + README 运行说明 + 采集方法 + 数据字典 + 局限性）+ **约 2 分钟视频**（在哪/怎么采 → 数据内容 → 应用演示）。
- 评分 5×20：采集质量与严谨性 / 应用功能与数据融合 / 创意 / 实用性与对局限性的处理 / 展示与文档。
- 时间：现在周六中午 → 周日 12:00 截止。可采集窗口 ≈ 周六 14:00 – 周日 10:00。

---

## A. MSC Study-Spot Finder（推荐）
**问题**：现在去 MSC 哪里学习最好——安静、有插座、有座位、适合几个人？

**两张表**
1. `zones.csv`（每个区域采一次，约 15–25 个公共座位区，MSC 内 + 可选 Evans/ZACH）
   `zone_id, building, floor, name, seats_total, outlets_reachable, seat_type(table/soft/booth/counter), group_max, natural_light(y/n), food_ok(y/n), lat, lon, photo(无人物)`
2. `observations.csv`（巡查，每轮把所有区域走一遍）
   `obs_id, ts(自动), observer, device, zone_id, people_count, seats_occupied, noise_dba(10 s 平均), lux(可选), wifi_mbps(可选), notes`

**采样计划**：固定路线，周六 14、17、20、23 点，周日 02(可选)、08、10 点 → 6–7 轮 × ~20 区 ≈ **120–140 条观测**；每轮 1 人约 20–25 分钟。

**质量控制**：固定路线顺序；表单下拉选区域、自动时间戳、数值范围校验；噪声统一用同一台手机（或开始前两台手机同点对比得出偏移）；每轮随机抽 2 个区域由第二人独立复数 → 计算一致性；只记人数，不拍人、不记身份。

**应用**：「现在/某时去哪学」推荐器——筛选（安静/插座/人数/时间）→ 区域排名 + 按小时的拥挤度/噪声曲线 + 平面图热力色块 + 区域详情页。局限性：周末 + 黑客松人群 ≠ 平日。

**优点**：就在会场内采，不用跑远，最好落实；实用性强。**缺点**：官方示例里有"噪声/自习区"，原创性要靠「多维度 + 24 小时曲线 + 浏览器内测噪声」来拉开。

## B. Refill Radar（饮水/灌水站地图）
**问题**：最近的、能用的、出水快、滤芯没过期的灌水站在哪？谁用得最多？

`stations.csv`：`station_id, building, floor, location_desc, type(bottle-filler/fountain/both), working(y/n), filter_led(green/yellow/red/none), bottle_counter, counter_ts, fill_500ml_s(两次取平均), cold_rating(1–3), ada_height(y/n), lat, lon, photo`
- 周六下午全部走一遍，周日早上**再读一次计数器** → 每站每小时使用量（灌水机上的"已节省瓶数"计数器）。
- 规模：MSC + 附近 4–6 栋楼 ≈ 30–50 站。

**应用**：地图 + "最近的好灌水站"、出水速度排名、滤芯需更换清单（可报给校方）、使用量热力。
**优点**：原创性最高，计数器差值是很巧的"免费传感器"。**缺点**：周末其他楼可能锁门，样本可能偏少；需要走动。

## C. Accessible Aggieland（无障碍入口审计）
**问题**：MSC 周边哪些入口真正无障碍？

`entrances.csv`：`entrance_id, building, side, step_free(y/n), ramp_slope_deg(手机水平仪), ada_ok(坡度≤4.8°), auto_door_button(y/n/broken), open_delay_s, stay_open_s, door_width_in(卷尺/手机测距), surface(smooth/cracked), lat, lon, photo`
- 规模：MSC + 周边 6–8 栋楼约 40 个入口，2 人一组 3–4 小时。

**应用**：无障碍路线地图，按轮椅/推车/拐杖等需求筛选入口，标出"按钮坏了/坡太陡"。
**优点**：社会影响力强、测量严谨（坡度对比 ADA 1:12 标准）。**缺点**：需要卷尺、走动多；周末门可能锁（按钮测不了）。

---

## 不用走动的方案（第二轮）
- **D. Datathon 熬夜反应测试（Sleep Debt Meter）**：征得同意的参赛者在我们的手机/电脑上做 30 秒反应测试（5 次取中位数）+ 匿名填"已清醒几小时、今天喝了几杯咖啡/能量饮料、睡了几小时"。周六下午到周日早上在会场里分 3–4 次各问 15–20 人 → 60–100 人。应用：自己测一次，看你在同等清醒时长的人里排第几、全场反应时间随熬夜时长变慢的曲线、"该不该去睡一觉"。采集工具=应用本身。可选加手机陀螺仪"手稳不稳"测试。风险：评委可能觉得"数据是从屏幕上来的"，要在视频里展示线下逐桌邀请、统一流程。
- **E. Datathon 排队预测**：在活动饭点（周六晚饭、夜宵、周日早饭）每 3–5 分钟记一次队伍人数，并抽样计时"从排队到拿到饭"几分钟 → "现在去拿饭要等多久"。只在会场里，靠活动的饭点时间。数据量小（每顿饭 10–20 条）。
- **F. MSC 吃饭性价比**：拍下 MSC 各餐厅菜单牌/价格（只拍菜单不拍人），录入价格、份量、热量/蛋白质（有标注的话）→ "10 美元内最饱/蛋白质最多"推荐器。约 1 小时，只在 MSC 美食区。风险：周末部分店不开；数据偏"抄写"，测量含量少。

## 网上类似项目调研（2026-11-07，DuckDuckGo）
- **自习区/噪声类（A）——撞车很多**：Devpost "StudySpot"（噪声+拥挤彩色地图）、"Study Hall Checker"（VT 楼宇占用）、GitHub 多个 Campus-Study-Spot-Finder。TAMU 图书馆官方已有 "Explore" 自习区平面图 + "How busy are the libraries?"。→ A 原创性偏低，但 MSC 不在图书馆系统里。
- **灌水站（B）**：Penn 官方灌水站地图、BU CS506 课程项目、Devpost 有个同名 "Refill Radar"（要改名）。TAMU 的灌水机确实带"Plastic Bottles Saved"计数器（Waymarking 记录了 Schuhmacher Hall 的一台），但**没找到 TAMU 官方灌水站地图**；用计数器两次读数算使用率的做法没见别人做过。
- **无障碍（C）**：Devpost "Access Maps"（社区上报坡道/电梯问题）、GitHub Campus Accessibility Map；TAMU 办过 Diversity Accessibility Hackathon。用坡度实测对照 ADA 标准的较少见。
- **得奖项目共同点**：亮点都在"采集方式本身有创意"——DataHacks 2026 冠军 BioByte（可穿戴设备测热指数，绘制校园热点）、Packed（ESP32 用 Wi-Fi 噪声估算食堂拥挤度）、TrippinTracker（队友绑传感器走路采 500+ 样本）。

## 采集工具（三个方案通用做法）
单页手机网页（离线可用，数据存手机本地 → 一键导出/分享 CSV），自动时间戳、下拉选项、范围校验；方案 A 额外带"用麦克风测 10 秒噪声"按钮（未校准 dBFS，同一手机内可比，另填 SLM App 读数做主值）。
托管：最简单是 GitHub Pages（反正提交要公开仓库）；或团队成员把 HTML 文件直接存到手机打开（麦克风需 https，这种情况只能手填噪声）。
