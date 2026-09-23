# 打桩网

天下布魔社区打桩工具，参考 [TenkaAssist](https://inittt.github.io/tenkaassist/) 设计。

## 功能

| 页面 | 路径 | 说明 |
|------|------|------|
| 首页 | `/index.html` | 导航、数据概览、TenkaAssist 同步状态 |
| **卡池推荐** | `/banner/` | 当期 UP 分析、双池对比、保底/心愿提示 |
| **智能打桩** | `/smart/` | 按持有筛选社区配队并重算伤害、多队对比 |
| **配队列表** | `/comps/` | TenkaAssist 社区配队排行（API） |
| **组合搜索** | `/search/` | 按角色必须包含/排除搜索配队 |
| 配队详情 | `/comp/` | 查看行动序列、重算精确伤害、加入编队 |
| 持有角色 | `/have/` | 选角、羁绊、导入导出 |
| 编队 | `/team/` | 5 人编队、拖拽排序 |
| 打桩模拟 | `/calc/` | 精确引擎（社区/本地配队）/ 简化占位模式 |
| 账号 | `/login/` | 多账号、演示账号 mumu（木木） |

## 本地运行

**必须使用 `server.py`**（含 TenkaAssist API 代理 + 数据同步，解决 CORS）：

```bash
python server.py
```

或双击 `启动打桩网.bat`。浏览器打开 **http://localhost:8080**

> 不要用 `python -m http.server`，配队列表/搜索会因 CORS 无法加载。

### 数据同步

- 启动时及每 6h 后台与 TenkaAssist 同步角色与配队库（见 `data/sync_config.json`）
- `GET /api/sync/status` — 同步状态（含角色/配队分项）
- `POST /api/sync/run` — 手动触发同步
- `GET /api/health` — 检查关键数据文件是否存在

```bash
python scripts/update_all_data.py --chars   # 仅同步角色
python scripts/update_all_data.py --comps   # 仅同步配队库
python parse_characters.py                  # 重新解析角色 JSON
```

## 打桩引擎

- **精确模式**：从智能打桩 / 配队详情 / 本地组合进入，加载 `calculator.v3.js` + 社区出招顺序，重算 13 回合伤害
- **简化模式**：从编队页进入，**仅占位演示**（随机估算，不可信）

## 数据

- `characters_parsed.json` — 约 250 角色（含简中译名，部分 `ok: false` 不可用）
- `characterJson.js` — 官方角色数据（精确计算用）
- `data/banner_events.json` — 当期卡池公告（基于 tenkafuma.wikiru.jp / nutaku.net 维护，中文活动名可能为暂译，待 cht 官方公告校正；历期归档在 `history` 字段）
- `data/compdata.json` — 社区配队库（自动同步）
- `data/sync_meta.json` — 上次同步时间与状态

## 后续计划

- [x] 持有角色 → 智能打桩推荐（`/smart/`）
- [x] 卡池 UP 抽取推荐（`/banner/`）
- [x] 多配队组合方案（2~4 套不重复，smart 紧凑对比）
- [ ] 完整交互式 simulator UI（逐步行动高亮；精确重算已完成）
- [ ] GitHub Pages 部署 + 云端 API 代理
