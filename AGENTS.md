# AGENTS.md

给接手这个仓库的 AI（或未来的自己）看的说明。**改动前先读这一页，避免重复踩坑。**

## 项目定位

单家庭自用的每日学习打卡系统。不做多租户、不做注册、不做支付。
家长是唯一管理员；孩子只面对客户端，打开即用。

## 目录

```
api/
  app/
    __init__.py       create_app：注册蓝图、JWT 错误、SPA 静态托管、每日备份
    config.py         配置（读 .env）
    extensions.py     db / jwt / cors + SQLite PRAGMA（WAL、外键）
    models/           base / catalog（年级·孩子）/ bank（三科题库）/ study / reward / system
    api/              client.py（客户端，无鉴权）、auth.py、admin.py（后台，JWT）
    services/         mathgen（出题器注册表）、taskgen（每日任务）、grading、submit、points、srs、settings、ai（大模型）
    seed/seed.py      首次启动写入年级、账号、数学规则、示例题库、示例孩子、奖励
    utils/            responses（统一响应）、dates
  run.py
web/
  src/
    pages/client/     首页、语文、数学、英语、我的
    pages/admin/      登录、布局、概览、孩子、年级、题库（通用 Bank）、记录、打卡、积分、奖励、设置
    components/client/ layout、quiz（答题内核）、poem-player、result
    components/ui/    shadcn 同源组件（Button/Card/Dialog/Table/Select/Switch/Tabs…）
    lib/              api（fetch 封装）、types、hooks、speech（TTS）、utils
    stores/           zustand（childId 持久化）
```

## 数据库

- 文件：根目录 `db.sqlite`，WAL 模式，备份=复制文件。
- 表：`grade / child / chinese_char / poem / english_word / english_sentence / english_phoneme / math_rule / math_question / daily_task / study_record / task_answer / recitation / checkin / srs_item / wrong_item / points_ledger / reward / redemption / admin_user / setting`
- 唯一约束：`daily_task(child_id,date,subject)`、`checkin(child_id,date)`、`srs_item`、`wrong_item`、`task_answer(task_id,item_id)`。
- **没有迁移工具**：新表靠启动时 `db.create_all()` 自动建；新列要在 `seed/seed.py` 的迁移函数里手写 `ALTER TABLE`（照 `_add_wrong_snapshot_column()` / `_add_level_columns()` 的写法，先看 `inspect(db.engine)` 有没有这列再加）。
- **年级不是枚举**：`grade` 表带 `stage`（小学/初中/高中），家长可自行增删，题库用 `grade_id` 关联。新增学段不要改代码，改数据。

## 关键业务规则（改动前必须理解）

1. **打卡**：语文/数学/英语三科 `status=done` 才 `checkin.status=full`；否则 `partial`。家长补卡 `is_makeup=true`，`streak=0`。
2. **判分**：服务端持有答案。客户端只能拿到去掉 `answer` 的 payload；`/task/answer` 只做单题反馈，`/task/submit` 才写记录、算分、发积分。
3. **积分**：`points.add()` 内做日上限裁剪；流水只增不改，冲正写负数；有 `date` 字段用于当日累计。
4. **SRS**：`[1,2,4,7,15,30]` 天，答对升 1 级、答错降 1 级并明天再考。
5. **任务幂等**：同一天同科目重复 `start` 返回已有 payload；`submit` 遇到 `done` 直接返回既有结果，不重复计分。
   - **并发也要幂等**：`taskgen.get_or_create_task()` 插入撞 `daily_task` 唯一约束时回滚并取另一路刚插进去的那条，不能把 `IntegrityError` 抛成 500。客户端 `startTask()`（`lib/hooks.ts`）用模块级 in-flight map 让并发调用复用同一个请求——StrictMode 双挂载、双标签页、误双击都会同时发两条 start。新增「先查后插」的位点（如 `Checkin`、`SrsItem`）要按同样的思路兜底。
6. **数学出题**：`mathgen.GENERATORS` 是注册表，`math_rule.generator` 存键名，`params_json` 存区间参数；`mathgen.GENERATOR_SPECS` 声明可调参数（key/label/default/min/max），前端据此渲染参数表单。
   - 出题规则**严格按「年级 + 学期」**：`taskgen._build_math` 用 `filter_by(grade_id=child.grade_id, term=child.term)`，不会串年级、不会串学期。仅当该学期一条规则都没配时才退到本年级其他学期，避免孩子当天无题。
   - 新增题型：写一个 `@register` 函数 + 在 `GENERATOR_SPECS` 注册参数 + 加一条规则数据，前端下拉自动出现。
7. **大模型**：`services/ai.py` 只用 `urllib` 调 OpenAI 兼容的 `/chat/completions`，JSON 模式。所有生成都走后端二次校验（字段白名单、出题器白名单、答案只留数字），不合格直接丢弃；入库仍走题库 CRUD 的唯一性检查。
   - 配置存 `setting` 表：`ai_enabled / ai_provider / ai_base_url / ai_api_key / ai_model / ai_thinking`。
   - `ai_thinking` 默认 false。DeepSeek 不传时**默认开启思考**，所以请求里必须显式下发 `thinking: {"type": "disabled"|"enabled"}`（仅 provider 为 deepseek 时下发，避免自建代理不认这个字段）。
   - `ai_api_key` 属于 `settings.SECRET_KEYS`，接口只返回 `ai_api_key_masked` 和 `ai_api_key_set`，PUT 时留空或传掩码表示不修改。
   - 每次调用（含失败）都往 `ai_call_log` 写一条：`created_at / model / prompt(用户侧提示词) / input_tokens / output_tokens / ok`；`GET /admin/ai/calls` 返回分页 + 累计 token，`DELETE /admin/ai/calls` 清空。日志写失败不影响主流程。
8. **只有数学看年级**：语文（识字、古诗）、英语（单词、句子、音标）**不关联年级学期**，四张题库表的 `grade_id` / `term` 已删（v6 迁移 `_drop_legacy_bank_grade_columns()`）。取题一律全库随机：`taskgen._pick_unlearned()` / `_pick_learned()`，古诗与句子用 `rng.choice()`。数学严格按 `grade_id + term`。别再给语文英语加回年级过滤。
9. **唯一性**：`_register_bank(unique=[...])` 在写入时查重（不建索引），`unique_ci=True` 用于单词（忽略大小写）；更新时排除自身。
10. **没有启停用**：模型里不再有 `enabled` 字段，删除即 `db.session.delete()` 物理删除。旧库由 `seed._drop_legacy_enabled_columns()` 在启动时 `ALTER TABLE ... DROP COLUMN enabled`。不要再用软删除。
11. **没有单元**：`chinese_char / english_word / english_sentence` 的 `unit` 列已删（v4 迁移 `_drop_legacy_unit_columns()`）。`math_question.unit` 是**答案单位**（元/个/米），不能一起删。
12. **AI 去重口径必须与唯一性校验一致**：诗按标题、词按 word、句按 en 都是**全库**唯一，所以 `_existing_for_ai()` 必须把全库已有内容交给模型。曾按当前年级过滤，导致「选四年级生成 5 首，4 首因与一年级重复被 409 拒绝」。
13. **补充要求要进提示词**：前端所有 AI 弹窗都会传 `context.requirement`，由 `ai._extra_line(context)` 统一拼进六类提示词。新增生成类型时记得把 `extra` 接上，否则输入框会变成摆设。条数也要写死（`items 里必须有 N 个元素`），`max_tokens` 随 count 增长。
14. **没有排序字段**：9 张表的 `sort_order` 已删（v5 迁移 `_drop_legacy_sort_columns()`）。题库列表统一 `created_at DESC, id DESC`（最新的在最上面），年级/奖励用 `id ASC`（学段顺序、建奖励的顺序）。`_register_bank()` 不再收 `order_fields` 参数，排序写在里面；新增题库实体不用再配排序。语文英语取题是全库随机，数学按规则生成，都不再依赖 id 顺序。
15. **内置题库**：`app/seed/data/` 下有两个离线数据包（2176 字、112 首古诗），由 `scripts/build_chars.py` / `scripts/build_poems.py` 生成，导入逻辑在 `services/bank_import.py`，后台入口在「系统设置 → 内置题库」，接口是 `GET /admin/bank/builtin` + `POST /admin/bank/import`。
   - 导入**幂等**：按 汉字 / 古诗标题 查重后跳过，不覆盖已有记录（家长改过的内容不能被数据包冲掉）。
   - 写入必须**倒序遍历**：同一批 `created_at` 相同，列表按 `id DESC` 排会把六年级顶到最前；倒序插入后 id 才回到教材顺序。
   - 导入只写字形/文本内容，**不写 `grade_id` / `term`**（这两列已从题库表删除）；数据包里的年级只用于保持教材顺序。
   - 结构字段靠 IDS 推断，三条兜底规则见 `build_chars.py` 的 `structure_of()`：部首即本字 → 独体；末级部件全是笔画 → 独体；笔画 ≤ 4 的上下/全包围 → 独体。改这块先跑一遍 `build_chars.py` 抽查「火、四、云、少、太」这些典型字。
16. **年级是内置只读数据**：`seed.GRADES` 只有 9 条（一年级~六年级、初一~初三），没有高中。`seed._seed_grades()` 每次启动同步：补齐缺失、删掉多余（先清 `child.grade_id` 与挂在它上面的数学规则/应用题）。后台只有 `GET /admin/grades`，没有增删改，前端也没有年级管理页；孩子在「系统 → 孩子管理」。
18. **错题只能靠重做关闭**：`POST /client/wrong-items/<id>/master` 已删除，不要再加回来。关闭路径有两条：① 当天任务里的重练题累计答对 2 次（`submit._upsert_wrong`）；② 错题本专项订正 `GET /client/wrong-practice` + `POST /client/wrong-practice/check` 答对 1 次。题目一律由 `wrong_item.snapshot_json` 还原，快照残缺的条目列表里要提示「再做一次原题后就能订正」，别让它变成一个点不动的死按钮。
20. **等级（难度）只有一份定义**：`services/level.py` 里的 `LEVELS`（容易/较易/中等/较难/困难）+ `RATIOS`（20/30/30/15/5）+ `GRADE_LEVEL`（1、2 年级容易 … 6 年级困难）。六张表（`chinese_char / poem / english_word / english_sentence / math_rule / math_question`）的 `level` 列都靠它归一，别再复制一份比例常量。
   - 出题：新题走 `level.split()`（语文新字、英语新词、数学应用题）或 `level.pick_one()`（古诗、英语句子）；**复习题和错题重练不按比例**，该复习就得复习。某档题库空了配额自动让给其它档，不会少题。
   - 数学计算题靠 `math_rule.level` 分配配额，但规则本身按「年级 + 学期」过滤，同一学期往往全在同一档，配额会回补——这不是 bug。
   - 导入：数据包的 `grade`（教材年级）用 `level_svc.from_grade()` 折算，绝不直接写 grade 列。
   - 新增题库实体：模型加 `level`、`_register_bank` 白名单加 `"level"`、`BANK_CONFIGS` 加一列 + 一个 `type: 'select'` 字段（`options: LEVEL_OPTIONS`）。后台 `_coerce` 会把空值/脏值归一到「中等」，不用前端兜。
   - `math_question.difficulty(1-3)` 已删，别再引回来。

22. **题库检索过滤是通用的，不要按库写死**：`admin._filtered()` 里遍历 `_FILTER_COLUMNS`（`level / pos / kind / type / category / genre`），模型上有这一列且请求带了同名参数才加 `WHERE`。前端只在 `BANK_CONFIGS` 里写 `filters: [{ name, label, options }]`，`name` 直接当查询参数传给后端。所以加新过滤器 = 后端加列名进 `_FILTER_COLUMNS`（如需）+ 前端加一条 `filters`，不要在接口里写 `if prefix == 'words'` 这种分支。
    - 音标库没有 `level` 列，天然不支持难度过滤；它用 `type=vowel|consonant`。
    - `App.tsx` 的 `BankPage` 必须带 `key={cfg.key}`，否则切库时筛选/页码状态会串到下一个库。
    - **`math_rule.weight` 已删**（`data_version=9`）：出题比例只由 `level` 决定，同档规则等概率。别再引回权重。
    - 错题重练与当天题去重时，数学（`kind == 'math'`）要比 `stem` 而不是 `item_key()`——数学的 `item_key` 是按知识点聚合的哈希，用它去重会把同知识点的题全删掉（20 题变 10 题），见 `_dedupe_key()`。

19. **作废打卡 = 级联清理 + 余额重算**：`DELETE /admin/checkins/<id>`（`admin.checkin_void`）会删掉当天该孩子的 `study_record`、`daily_task`、`checkin`，以及当天 `ref_type ∈ {task, checkin, wrong_item}` 的 `points_ledger`（`manual` / `redeem` 不动）。因为 `points.balance()` 取的是**最后一条流水的 `balance_after`**（滚动账本，不是求和），删完必须把该孩子所有流水按 `id` 升序重新滚一遍 `balance_after`，否则余额会永久错位。新增任何删除流水的地方都要记得做这一步。
    - v1.11 起还要顺手清 `task_answer`（否则孩子重做时会「接着做」到作废前的进度）和 `recitation`（连同 `storage.delete_recite()` 的音频文件）。**任何新的任务位态表，作废路径都要同步加进去。**

21. **答题进度以服务端存档为准**：`task_answer(task_id, item_id)` 唯一约束，`/client/task/answer` 每答一题 upsert 一次，`/client/task/start` 返回 `answered[]`。客户端用 `lib/resume.ts` 过滤掉已答的题，题号写成「第 N / M 题 · 接着上次」。`/client/task/submit` 里 `answer_map` **先取存档再用客户端传值覆盖**，所以即使前端状态丢了也不漏题。新增科目页（或新增科目）要沿用这套：科目页自动补交已答完但未提交的任务，判定必须带 `list.length > 0` 的保护，否则题库空时会把 0 题的任务标记成完成。

22. **古诗与朗读卡不判分**：`taskgen.NO_SCORE_KINDS`（`poem`）+ `taskgen.NO_SCORE_TYPES`（`word_read` / `phoneme_read` / `char_read`）不计入 `count_scored()` 总分、不进错题本、不发积分。
    - 古诗：`task_answer` 记 `__recited__`，是否背诵以有没有录音为准；`study_record.is_correct` 写 `recited`（v1.11 起不再写 NULL）。
    - 朗读/认读卡：客户端点「下一个」时提交 `taskgen.READ_ANSWER`（`__read__`），`submit` 只记一条「已朗读 / 已认读」的学习记录 + 一条 SRS（`srs.record(..., True)`）。**SRS 不能省**：朗读是新词新字唯一的「学过」入口，不记的话第二天又当成新内容重发。
    - 两者判断都用 `item["type"]` / `item["kind"]` 的白名单，别再指望 `type == 'recite'`。

23. **每日题量是写死的结构，不是配置项**（`taskgen` 顶部常量）：
    - 语文：`char_read` 5 + `word_choice` 5 + `recite` 1；认读卡展示部首/笔画/结构/组词/例句，组词题从全库随机出（排除当天认读过的字）。
    - 英语：`word_read` 由 `english_word_read`（默认 10）决定 + `phoneme_read` 2 + `word_choice` 2 + `meaning_choice` 2 + `choice`（音标选词）2 + `order` 1；朗读过的单词不再拿去出词义选择题，音标朗读过的也不再出音标选词。
    - 词库太小（`len(words) < 4`）时先给选择题留 4 个词，朗读卡会让路；音标/句子两个开关关掉就整段不出。
    - 错题重练固定 `RETRY_LIMIT = 2` 道，`english_new_words` / `chinese_new_chars` / `poem_per_day` / `wrong_review_count` 这些旧配置已删除，`all_settings()` 只认 `DEFAULTS` 里的键，别再拿 `get_setting()` 读它们。

24. **写 NULL 要用 `sqlalchemy.null()`**：`StudyRecord(is_correct=None)` 因为列上有 `default=False`，插进去会被顶成 `False`。凡是「未判定/不适用」的三态，都要显式写 `null()`。

## 开发约定

- 后端：Blueprint 只做参数校验与序列化，业务放 `services/`；响应统一 `{ok, data}` / `{ok:false, error:{code,message}}`；写操作用短事务。
- 前端：TS strict；只用 Tailwind（动画除外不写内联样式）；API 字段保持 **snake_case**，前后端一致，不做驼峰转换。
- 新增题库实体：后端 `_register_bank(...)` 一行注册，前端往 `BANK_CONFIGS` 加一条配置，页面自动生成（表格 + 表单 + AI 入口）。`fields` 支持 `type: 'select'` 配 `options` 做中文下拉。
- **「AI 补全」由配置声明，不要在表单里写死**：`BANK_CONFIGS` 里加 `aiFill: { from, key, hint }`，`from` 是家长先填的字段、`key` 是传给 `/admin/ai/suggest` 的生成类型（`char` / `word` / `sentence`）。后端 `ai.generate()` 看到 context 里带 `char` / `word` / `sentence` 就走单条补全（`_gen_char` / `_gen_word` / `_gen_sentence`），不带就走批量生成。补全结果按字段名通用合并，`from` 字段本身不回填。
- 题库列表的「年级学期」列由 `Bank.tsx` 统一渲染（`gradeTermText()`），配置里只要 `withGrade: true` 就自动出现在表格最后一列，不要在 `columns` 里重复加学期列。
- 组件不要引入新的 UI 库；`components/ui` 里的组件是 shadcn 同源手写版。
- **客户端截图必须先绕开 PWA 离线包**：`web/scripts/shot.mjs` 里用 `serviceWorkers: 'block'` + 每次新建 context，否则 workbox 会把上一个版本的包喂给浏览器，截图看起来像改动没生效。截图默认落在 `docs/screenshots`。
- **多值字段（组词、例词等）用 `components/ui/tag-input.tsx`**：表单字段声明 `type: 'list'`，值在 form state 里是 `string[]`，保存时 `JSON.stringify`。不要再用「逗号分隔的文本框」，家长一次填多个词时容易漏分隔符。
- **复习队列和错题本的 `item_id` 必须是题库主键**，用 `taskgen.item_key(item)` 取（优先 `ref_id`，数学计算题走 `md5(kind+topic)`）。绝不能存 payload 里的 `item_id`（那是当天第几题），否则第二天复习会取到不相干的字。新增题型时记得在 item 里写 `ref_id`。
- 后端新增设置项后，要确认真的有人读它（`get_setting`），并在 `Settings.tsx` 的 `NUMBERS` / `SWITCHES` 里露出，否则就是「写在默认值里没人用」。

## 常见任务

```bash
# 起后端（开发）
cd api && .venv/bin/python run.py

# 起前端（开发，5173 代理 /api 到 5001）
cd web && npm run dev

# 生产：构建后由 Flask 单端口托管
cd web && npm run build && cd ../api && .venv/bin/python run.py

# 重置数据库（会删掉所有学习记录）
rm -f db.sqlite db.sqlite-wal db.sqlite-shm && cd api && .venv/bin/python run.py

# 类型检查
cd web && npx tsc --noEmit
```

## 容器部署

`Dockerfile` + `docker-entrypoint.sh`，`docker-compose.yml` 只是同一套参数的快捷方式，纯 `docker build` / `docker run` 的完整命令见 README「不用 compose：纯 docker 命令」。三条不能破的约定：

1. **源码和 `db.sqlite` 都不进镜像**。镜像只有 Python 3.12 + Node 22 + Python 依赖 + gunicorn，运行时把仓库目录挂到 `/app`。不要在 Dockerfile 里加 `COPY . /app`。
2. **默认 `APP_MODE=dev`，不构建前端**：Vite dev server 5173（HMR）+ `run.py` 5001（debug 自动重载）。`APP_MODE=prod` 才 `vite build` 到 `/var/lib/learneveryday/web-dist` 并起 gunicorn，靠 `WEB_DIST` 让 Flask 托管。
3. **`web/node_modules` 和 `/var/lib/learneveryday` 必须是命名卷**，不能映射到宿主机（macOS 的 esbuild/rollup 二进制在 Linux 里跑不了）。

依赖变化：`api/requirements.txt` 变了 → `pip install` 在容器启动时自动补（长期用还是重建镜像）；`web/package.json` 变了 → `docker restart` 就够，entrypoint 会自己 `npm ci`；只改业务代码 → 什么都不用做。

镜像源统一走 `ARG`：`PIP_INDEX_URL`（清华）、`NPM_REGISTRY`（npmmirror）、`APT_MIRROR`（阿里云）。apt 那段 `RUN set -eux` 会把 `deb.debian.org` / `security.debian.org` 替换成 `APT_MIRROR` 的 host，同时兼容 deb822（`sources.list.d/debian.sources`）和老 `sources.list`；换源只改这几个 ARG，不要去手写 sources 文件。

## 已知边界

- 默认账号 `admin/admin123`，首次登录后必须提醒用户修改。
- 识字库/古诗库已内置 2178 个常用字与 112 首统编版古诗（`api/app/seed/data/`），可在「系统设置 → 内置题库」一键导入；不足的再用「AI 补全」或「AI 生成」补。
- 音标库是内置 48 个（20 元音 + 28 辅音），`allow_create=False / allow_delete=False`，只能编辑；seed 按 symbol 幂等补齐，不会覆盖家长改过的内容。
- 浏览器 TTS 在部分离线场景不可用；需要稳定发音就给条目配 `audio_url`。
- SQLite 并发写有限，多设备同时提交极端情况下会短暂锁表（已开 WAL + 15s timeout）。

## 维护记忆

每次完成一个里程碑，在 `docs/03-开发计划.md` 勾选对应项，并在 `.workbuddy/memory/YYYY-MM-DD.md` 记一行结论（做了什么、为什么这么选）。
