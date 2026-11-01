# AGENTS.md

给接手这个仓库的 AI（或未来的自己）看的说明。**改动前先读这一页，避免重复踩坑。**

## 项目定位

单家庭自用的每日学习打卡系统。不做多租户、不做注册、不做支付；家长是唯一管理员，孩子只面对客户端，打开即用。

## 结构与数据库

- `api/app/`：models（catalog 年级孩子 / bank 三科题库 / study / reward / system）、api（client 无鉴权、auth、admin JWT）、services（mathgen 出题器注册表 / taskgen 每日任务 / grading / submit / points / srs / settings / homophone / ai）、seed（首次启动数据 + 手写迁移）、utils（responses 统一响应 / dates）
- `web/src/`：pages/client（首页·语数英·我的）、pages/admin、components/client（layout / quiz 答题内核 / poem-player / result）、components/ui（shadcn 同源手写组件）、lib（api / types / hooks / speech / phoneme-audio / utils）、stores（zustand，childId 持久化）
- `web/public/phonemes/`：48 个音标真人单音 mp3（IPA 符号 TTS 读不了）。播放走 `lib/phoneme-audio.ts` 的 IPA→文件名映射 + `speech.speakPhoneme()`，**不要**把音标符号丢给 TTS；映射改动必须与 `seed.SAMPLE_PHONEMES` 的 48 个符号对齐
- **TTS 缓存是内容寻址、不进数据库**：缓存键 = md5(音色|语速|文本)，前端把文本发到 `/client/tts`、后端现场算哈希查 `uploads/tts/` 下同名文件是否在。题库表不存音频地址，别加回来
- 数据库根目录 `db.sqlite`（WAL，备份=复制文件）。表：`grade / child / chinese_char / poem / english_word / english_sentence / english_phoneme / math_rule / math_question / daily_task / study_record / task_answer / recitation / checkin / srs_item / wrong_item / points_ledger / reward / redemption / admin_user / setting`
- 唯一约束：`daily_task(child_id,date,subject)`、`checkin(child_id,date)`、`srs_item`、`wrong_item`、`task_answer(task_id,item_id)`
- **没有迁移工具**：新表靠启动时 `db.create_all()`；新列在 `seed/seed.py` 手写 `ALTER TABLE`（照 `_add_wrong_snapshot_column()` 的写法，先 `inspect(db.engine)` 判断列存在再加）
- **年级不是枚举**：`grade` 表带 `stage`，题库用 `grade_id` 关联；但 `seed.GRADES` 是内置只读 9 条（一~六年级、初一~初三，无高中），启动时同步、无增删改接口，孩子管理在「系统 → 孩子管理」

## 核心规则

- **判分在服务端**：客户端只拿去掉 `answer` 的 payload；`/task/answer` 只做单题反馈，`/task/submit` 才写记录、算分、发积分。
- **任务幂等（含并发）**：同天同科重复 `start` 返回已有 payload；`get_or_create_task()` 撞唯一约束时回滚取另一路刚插的那条，不能 500。客户端 `startTask()`（`lib/hooks.ts`）用 in-flight map 兜并发；新增「先查后插」位点照此兜底。
- **答题进度以服务端为准**：`/task/answer` 每题 upsert，`/task/start` 返回 `answered[]`，前端 `lib/resume.ts` 过滤已答题；`submit` 的 `answer_map` 先取存档再被客户端传值覆盖。科目页要自动补交已答未提交的任务；完成判定必须带 `list.length > 0` 保护（题库空时别把 0 题任务标成完成）。
- **打卡**：三科 `done` 才 `full`，否则 `partial`；补卡 `is_makeup=true` 且 `streak=0`。
- **积分**：`points.add()` 内做日上限裁剪；流水只增不改、冲正写负数、有 `date`；`balance()` 取最后一条流水的 `balance_after`（滚动账本，不是求和）。
- **作废打卡 = 级联清理 + 余额重算**：删当天 `study_record / daily_task / checkin / task_answer / recitation`（含 `storage.delete_recite()` 音频）及 `ref_type ∈ {task, checkin, wrong_item}` 的流水（manual/redeem 不动），然后按 id 升序重滚该孩子所有流水的 `balance_after`。**任何新的任务位态表、任何删流水的地方都要同步这两步。**
- **SRS**：间隔 `[1,2,4,7,15,30]`，答对升 1 档、答错降 1 档明天再考；只记 char / word / poem（数学无稳定主键不入队）。
- **复习优先**：SRS 到期条目先占认读卡/朗读卡约四成（`taskgen._due_rows()`），其余到期词在选择池、组词题字里排最前；复习占少数、新题为主，别做成复习占大头。
- **复习队列和错题本的 `item_id` 必须是题库主键**：用 `taskgen.item_key(item)`（优先 `ref_id`；数学计算题是 `md5(kind+topic)` 知识点哈希）。绝不能存 payload 里的 `item_id`（那是当天第几题）。新增题型记得写 `ref_id`。
- **错题重练与当天题去重**：数学（`kind == 'math'`）比 `stem` 不比 `item_key()`（哈希按知识点聚合，会误删成半数），见 `_dedupe_key()`。
- **错题只能靠重做关闭**：①当天重练累计答对 2 次（`submit._upsert_wrong`）；②错题本专项订正 `/client/wrong-practice/*` 答对 1 次。题目由 `wrong_item.snapshot_json` 还原；快照残缺的要在列表提示「再做一次原题后就能订正」，别留点不动的死按钮。
- **古诗与朗读卡不判分**：`NO_SCORE_KINDS`（poem）/ `NO_SCORE_TYPES`（word_read/phoneme_read/char_read）不进总分、不进错题本、不发积分。朗读提交 `READ_ANSWER`（`__read__`）后**必须记 SRS**——朗读是新字词唯一的「学过」入口，不记第二天会当新内容重发。判断一律用 type/kind 白名单。客户端朗读/认读卡要停留 `quiz.tsx` 的 `READ_MIN_SECONDS`（10s）才能点「下一个」，防连点刷完。
- **物理删除**：模型没有 `enabled`，删除即 `db.session.delete()`，不做软删除。
- **奖励可以删，兑换记录不跟着删**：`redemption.reward_id` 可空，另有 `reward_name / reward_icon` 快照（下单时写入）。删除奖励时先看有没有 `pending` 申请（有就 409 拒绝），历史记录只把 `reward_id` 断成 NULL、名称靠快照显示——不能级联删，积分流水 `ref_type='redemption'` 还指着它。
- **删孩子要按外键顺序清子表**：`task_answer → recitation`（含 `storage.delete_recite()`）`→ study_record → daily_task → checkin / srs_item / points_ledger / wrong_item → redemption → reward`。漏一张就撞外键，前端表现为「服务端异常 FOREIGN KEY constraint failed」。
- **写 NULL 用 `sqlalchemy.null()`**：列有 `default=False`，直接传 `None` 会被顶成 `False`。

## 出题

- **每日题量后台可配**（`settings.py` 的 `DEFAULTS`；设置页按语/数/英/其它四个 Tab；0 = 当天不出该题型）：
  语文 认读 5 / 组词 5 / 古诗 1（`chinese_read / chinese_word / chinese_poem`）；
  数学 计算题 15 / 应用题 2（`math_calc / math_app`）；
  英语 朗读 10 / 音标朗读 2 / 音标选词 2 / 看中选英 2 / 看英选中 2 / 组句 1（`english_word_read / english_phoneme_read / english_phoneme_pick / english_word_choice / english_meaning_choice / english_sentence_count`）；
  其它 错题重练 `retry_count` = 2。旧键已删，`all_settings()` 只认 DEFAULTS 里的键。
- **等级只有一份定义**：`level.py` 的 `LEVELS` + `RATIOS`（10/40/30/15/5）+ `GRADE_LEVEL`（1、2 年级容易 … 6 年级困难）。六张题库表的 `level` 列都靠它归一，别复制比例常量。新题走 `level.split()` / `pick_one()`；**复习题和错题重练不按比例**。某档题库空了配额自动回补（数学同一学期常全在一档，这是正常的）。导入用 `from_grade()` 折算，不直接写 grade。
- **只有数学看年级学期**：语文英语题库不关联年级学期，全库随机；数学严格 `grade_id + term`，仅当该学期没配规则时退到本年级其他学期。别给语文英语加回年级过滤。
- **组词题**：题字取已学过的字（到期优先），答案是词里的另一个字；干扰项按词内真实读音取同音字，并排除一切能与题字拼成词的字（否则两个答案）。
- **数学**：`mathgen.GENERATORS` 注册表，`math_rule.generator` 存键名、`params_json` 存区间参数，`GENERATOR_SPECS` 声明可调参数。新增题型 = `@register` + 注册参数 + 加规则数据，前端自动出现。
- 词库小于「朗读 + 选择题总数」时先给选择题留词，朗读卡让路；当天朗读过的词不再出选择题，朗读过的音标不再出音标选词。

## AI（大模型）

- `services/ai.py` 用 urllib 调 OpenAI 兼容 `/chat/completions`，JSON 模式；结果走后端二次校验（字段白名单、出题器白名单、答案清洗），不合格丢弃；入库仍过题库唯一性检查。
- **没有 `ai_enabled` 开关**：配好参数即可用，`/admin/ai/status` 只看 `configured`（API Key 是否已填）。`ai_api_key` 属 `SECRET_KEYS`，只回掩码，PUT 留空/传掩码 = 不修改。
- DeepSeek 不传 thinking 默认开启，请求必须显式下发 `thinking`（仅 provider 为 deepseek 时下发）。
- 每次调用（含失败）写 `ai_call_log`，日志失败不影响主流程。
- **去重口径与唯一性一致**：`_existing_for_ai()` 交**全库**已有内容（诗按标题、词按 word、句按 en），别按年级过滤。
- `context.requirement` 由 `_extra_line()` 统一拼进所有提示词；条数写死（`items 必须有 N 个`），`max_tokens` 随 count 增长。新增生成类型记得接 extra。

## 题库

- **新增题库实体**：后端 `_register_bank(...)` 一行注册，前端 `BANK_CONFIGS` 加一条，页面自动生成（表格 + 表单 + AI 入口）。`fields` 支持 `select`（配 options）与 `list`（多值用 `components/ui/tag-input.tsx`，存 JSON，别用逗号分隔文本框）。
- **过滤通用**：`admin._filtered()` 遍历 `_FILTER_COLUMNS`（level/pos/type/category/genre），模型有列且请求带同名参数才加 WHERE；前端 `filters: [{name, label, options}]` 直接当查询参数，别写按库分支。音标库无 level，用 `type=vowel|consonant`。
- **唯一性**：`_register_bank(unique=[...])` 写入查重（不建索引），`unique_ci=True` 忽略大小写（单词）；更新排除自身。
- **排序**：题库 `created_at DESC, id DESC`，年级/奖励 `id ASC`；写进 `_register_bank()` 内，无 order_fields 参数。
- `App.tsx` 的 **`BankPage` 必须带 `key={cfg.key}`**，否则切库时筛选/页码串库。年级学期列配 `withGrade: true` 自动渲染，别手加。
- **AI 补全由配置声明**：`BANK_CONFIGS.aiFill: {from, key, hint}`；后端 context 带 char/word/sentence 走单条补全，不带走批量生成。
- **内置题库**：`seed/data/` 三包（2176 字 / 112 诗 / 740 词），`bank_import.py` 导入，入口「系统设置 → 内置题库」。导入幂等（按 汉字/诗标题/单词忽略大小写 查重跳过，不覆盖家长改过的内容）、**倒序写入**（同批 created_at 相同，正序会被 id DESC 顶乱）、不写 grade_id/term（年级只用于排序与折算等级）。数据包由 `scripts/build_*.py` 生成：单词按年级拆 g1–g6（一二年级人教新起点、三至六年级 PEP，`build_words.py` 带自检）；汉字结构靠 IDS 推断（`structure_of()` 三条兜底规则，改前抽查「火四云少太」）。

## 已删字段 / 旧接口（别加回来）

`chinese_char / poem / english_word / english_sentence` 的 `grade_id` + `term`；`unit`（`math_question.unit` 是答案单位，保留）；9 张表的 `sort_order`；`enabled`；`english_word.kind`；`math_rule.weight`；`math_question.difficulty`；`ai_enabled`；`POST /client/wrong-items/<id>/master`。对应迁移函数在 `seed/seed.py`（`_drop_legacy_*` 系列）。

## 开发约定

- 后端：Blueprint 只做参数校验与序列化，业务放 `services/`；响应统一 `{ok, data}` / `{ok:false, error:{code,message}}`；写操作短事务。
- 前端：TS strict；只用 Tailwind（动画除外不写内联样式）；API 字段 snake_case 前后端一致，不做驼峰转换；不引入新 UI 库（`components/ui` 是 shadcn 同源手写版）。
- 新增设置项要确认真的有人读（`get_setting`），并在 `Settings.tsx` 的 NUMBERS / SWITCHES / TAB_FIELDS 里露出。
- 客户端截图用 `web/scripts/shot.mjs`（已带 serviceWorkers block 防 PWA 旧包），落 `docs/screenshots`。
- 完成里程碑：勾 `docs/03-开发计划.md`，并在 `.workbuddy/memory/YYYY-MM-DD.md` 记一行结论。

## 常用命令

```bash
cd api && .venv/bin/python run.py     # 后端（开发）
cd web && npm run dev                 # 前端（5173 代理 /api 到 5001）
cd web && npm run build               # 生产构建，Flask 单端口托管
cd web && npx tsc --noEmit            # 类型检查
rm -f db.sqlite db.sqlite-wal db.sqlite-shm && cd api && .venv/bin/python run.py   # 重置数据库（删学习记录）
```

## 容器部署

- 源码和 `db.sqlite` 都不进镜像，运行时把仓库挂到 `/app`；不要 `COPY . /app`。
- 默认 `APP_MODE=dev`（Vite HMR + run.py 5001）；`prod` 才 `vite build` + gunicorn。
- `web/node_modules` 与 `/var/lib/learneveryday` 必须是命名卷，不能映射宿主机目录（macOS↔Linux 二进制不兼容）。
- 依赖：`requirements.txt` 变 → 启动自动 pip install；`package.json` 变 → `docker restart` 触发 npm ci。换源只改 ARG（`PIP_INDEX_URL` / `NPM_REGISTRY` / `APT_MIRROR`），别手写 sources 文件。纯 docker 命令见 README。

## 已知边界

默认账号 `admin/admin123`（首次登录提醒改密）；浏览器 TTS 离线不可用，需稳定发音就配 `audio_url`；SQLite 并发写有限（已开 WAL + 15s timeout）。
