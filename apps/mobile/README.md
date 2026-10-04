# AI Measure 手机演示版

这是独立的手机端呈现入口，手机样式不会加载到 PC 入口。共享业务视图的缺陷修复同时生效，PC 布局和启动方式保持独立。

## 启动

先确保原项目后端 `http://127.0.0.1:18000` 和数据库已经启动。

```powershell
# 在项目根目录：手机演示版
npm --prefix apps/mobile run dev

# 原 PC 版，保持原启动方式
npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

- PC 版：http://127.0.0.1:5173/
- 手机演示版：http://127.0.0.1:5174/
- 两个入口可以同时运行，账号和业务数据使用同一套后端。
- 电脑打开手机地址时，自动居中显示 460px 的独立手机视口，适合录制视频。
- 手机在同一 Wi-Fi 下，打开 `http://电脑局域网IP:5174/`，自动全屏宽度显示；需要 Windows 防火墙允许该端口。
- 右上角全屏按钮可用于录制演示。底部导航与顶部标题保留在屏幕上，内容单独滚动。
- 登录后，透明机器人悬浮在手机页面上：点击打开成长助手，拖动调整位置，切页和刷新后保留位置。键盘方向键也可以移动；正式作答页面不显示该入口。
- “我的”页展示当前账号的真实报告、进行中测评和训练进度，不填充虚构的学习天数或积分。

### 本地 DeepSeek 成长助手

如果本地原 API 容器已有密钥，但当前原生 API 没有加载成长助手配置，可在根目录运行：

```powershell
# 不带 --restart 时只检查；添加后重启本项目的本地 API（端口 18000）
.\apps\api\.venv\Scripts\python.exe -X utf8 scripts/start_local_growth_assistant.py --restart
```

该脚本保留原 API 的数据库、正式测评模型、评分、训练等配置，仅启用 DeepSeek 成长助手；缺失密钥时从原本地 API 容器读取到进程内存，不写入文件或前端。没有现成密钥时不会停止已有 API，需要先在被忽略的本地 `.env` 中配置。启动日志位于 `output/growth-assistant`，不进入 Git。

显式启用正式自动评分（开放题作答会发送到 DeepSeek，可能产生费用）：

```powershell
.\apps\api\.venv\Scripts\python.exe -X utf8 scripts/start_local_growth_assistant.py --restart --enable-formal-scoring
```

它会先验证模型与数据库/Redis/MinIO，再启用真实主评与复核，禁止失败后使用模拟分数；不带该参数不会擅自改变正式评分开关。

### 线上入口

服务器 Web 镜像分别构建 PC `/` 和手机 `/mobile/`，两者使用线上同一套 API。手机页面可直接打开 `https://101.35.52.148/mobile/`；电脑打开也会显示居中的手机视口。线上数据与本地数据独立，发布程序不会覆盖任何一端的数据库。

## 隔离约定

手机版的入口、首页、账号页、导航、样式和构建配置全部在此目录。业务视图、权限路由、请求服务、素材和依赖复用同一实现，以保留真实测评保存、题库抽题、评分、训练及账号安全逻辑。手机样式只由手机入口加载，不会影响 PC 页面。

测评选择使用独立的 `MobileAssessment.vue` 手机模板：四种方式为双列小卡，方案选择、题量与开始合并为一个区域，详细抽题规则按需展开。原 PC 测评选择脚本仅调整相对导入路径并增加纯展示函数；`assessment_mobile.py` 会逐字核对权限、默认选择、幂等创建和继续会话逻辑，防止双端分歧。PC 入口不导入这个手机模板。

作答工作区、报告和训练分别由 `assessment-compact.css`、`reports-compact.css`、`training-compact.css` 管理，共用 `compact.css` 的间距与字号。样式限定在手机入口的对应路由内，采用内容自然撑高，不用整页缩放；主要操作保留至少 44px 的触控区域。报告证据全文重排为阅读块，训练目录重复摘要移入详情，完整正文和来源警示仍可阅读。题目、成绩、证据、来源和训练记录仍使用原有业务数据。

依赖共用 `apps/web/node_modules`，首次使用时可在 `apps/web` 运行 `npm ci`。手机端 API 经同源 `/api` 代理访问，不需要修改后端 CORS 配置，也不把密钥放到前端。

```powershell
npm --prefix apps/mobile run type-check
npm --prefix apps/mobile run build
```

构建产物单独写入 `apps/mobile/dist`。这不是原 PC 页面的截图或静态展示：页面中的数据、登录与操作均连接现有服务。未登录状态不会填充虚构的个人成绩和记录。

## 验证

用原 API 虚拟环境中的 Python 和本机 Chrome 检查实际页面：

```powershell
# 360 / 390 / 460px 以及电脑中的手机视口：访客导航、登录校验、注册界面
.\apps\api\.venv\Scripts\python.exe -X utf8 apps/mobile/tests/smoke.py

# 可选：独立测试账号的真实登录、业务页面、极速测开始 / 暂存 / 继续
.\apps\api\.venv\Scripts\python.exe -X utf8 apps/mobile/tests/smoke.py --register-test-account --exercise-assessment

# 可选：增加一次真实 DeepSeek 问答（可能产生模型调用费用）
.\apps\api\.venv\Scripts\python.exe -X utf8 apps/mobile/tests/smoke.py --register-test-account --check-ai --exercise-assessment

# 隔离的紧凑布局回归：四种测评、报告详情/证据/弹窗、训练目录/任务/回顾
.\apps\api\.venv\Scripts\python.exe -X utf8 apps/mobile/tests/compact_layout.py

# 手机测评选择业务一致性与7类边界：空池、未开放、限时、来源、重试、继续
.\apps\api\.venv\Scripts\python.exe -X utf8 apps/mobile/tests/assessment_mobile.py

# 同一批内容移除共用紧凑样式，仅比较样式影响（不还原旧手机模板）
.\apps\api\.venv\Scripts\python.exe -X utf8 apps/mobile/tests/compact_layout.py --baseline --width 390 --output output/mobile-compact-baseline
```

独立账号检查只允许访问本地手机服务；它会新建一个专用验证账号，检查真实业务页面、机器人鼠标/触控拖动与位置记忆。测评检查保留一条暂存记录，最后禁用该账号，不删除数据、不提交答案，也不改动现有学员记录。截图写到根目录 `output/mobile-ui`，不进入源代码提交。

`compact_layout.py` 使用 `compact_fixtures.py` 中明确标识的浏览器测试数据，覆盖 360 / 390 / 460px 和电脑中的手机视口。全部 API 请求由测试拦截，未知接口和写请求直接失败，不创建真实账号、答案、训练记录或付费模型请求。测试数据不会进入运行入口；截图写入被排除的 `output/mobile-compact-layout`。

这轮重排的根元素标记为 `data-mobile-design="compact-v2"`，可用于确认实际加载的手机版版本。本地开发页面更新不等于服务器已经发布；线上只有在部署新版手机构建产物后才会改变。线上入口须使用 HTTPS 的 `/mobile/`，普通 HTTP 是保留的旧站。

成长助手是否可调用 DeepSeek、训练是否启用，继续遵守现有服务端配置与正式测评边界；手机呈现不会伪装已接通的模型服务。
