# at-tuner

AskTable 数据源调优 CLI —— 通过测试问题驱动，自动诊断 NL2SQL 质量问题并给出调优建议。

## 安装

```bash
npm install -g @datami/at-tuner
```

## 快速开始

```bash
# 1. 配置 AskTable 连接信息（只需一次）
at-tuner config set server https://your-server/api/v1
at-tuner config set api-key ADMIN_xxx
at-tuner config set datasource ds_xxx

# 2. 初始化工作区
at-tuner init

# 3. 一键跑完全流程
at-tuner tune
```

## 5 步调优流水线

| 步骤 | 命令 | 功能 | 输出 |
|------|------|------|------|
| 1 | `at-tuner init` | 创建工作区目录 | `.at-tuner/results/` |
| 2 | `at-tuner explore` | 获取数据源 schema 转为 Markdown | `schema.md` |
| 3 | `at-tuner generate` | AI 生成测试问题集 | `test-cases.md` |
| 4 | `at-tuner execute` | 批量并发提问，收集 SQL 结果 | `results/case-*.json` |
| 5 | `at-tuner analyze` | 分析结果 + LLM 诊断根因 | `tuning-report.md` + `.json` |
| 6 | `at-tuner apply` | 执行调优（更新字段备注/术语/Skill） | API 调用 |

一键执行全部步骤：

```bash
at-tuner tune    # 自动完成 explore → generate → execute → analyze → apply
```

## 配置管理

配置保存为 JSON，支持全局（`~/.at-tuner/config.json`）和工作区（`.at-tuner/config.json`）两级。

```bash
at-tuner config set <key> <value>   # 设置单个配置项
at-tuner config list                # 查看所有配置（敏感值掩码）
at-tuner config init                # 配置引导提示
```

支持的配置项：

| Key | 说明 |
|-----|------|
| `server` | AskTable API 地址 |
| `api-key` | 管理员 API Key |
| `datasource` | 数据源 ID |
| `project` | 项目 ID（术语库用） |
| `llm-provider` | LLM 引擎: `openai` / `claude` |
| `llm-api-key` | LLM API Key |
| `llm-model` | LLM 模型名 |
| `llm-base-url` | LLM API 自定义地址 |

优先级：CLI flag > 工作区配置 > 全局配置

## 调优建议类型

| 类型 | 说明 |
|------|------|
| **field_desc** | 字段描述不清，需更新元数据备注 |
| **glossary** | 业务术语歧义，需创建术语映射 |
| **skill** | 计算逻辑复杂，需固化计算 Skill |

## 参数速查

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-w, --workspace` | 工作区路径 | `.at-tuner` |
| `--datasource` | 数据源 ID | 从 config 加载 |
| `--server` | API 地址 | 从 config 加载 |
| `--api-key` | API Key | 从 config 加载 |
| `--concurrency` | 并发数 | `3` |
| `--timeout` | 单问超时（ms） | `120000` |
| `--scope` | 业务范围 | 交互式输入 |
| `--llm-provider` | LLM 引擎 | 从 config 加载 |
| `--llm-api-key` | LLM Key | 从 config 加载 |
| `--llm-model` | LLM 模型 | — |
| `--llm-base-url` | LLM 自定义地址 | — |
| `--project` | 项目 ID | `""` |
| `--dry-run` | 预览不执行 | `false` |
| `--confirm` | 跳过确认 | `false` |

## License

MIT
