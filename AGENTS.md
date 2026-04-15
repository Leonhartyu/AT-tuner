# at-tuner — AskTable 调优 CLI

独立发行的 npm CLI 工具，通过 AskTable API 完成数据源调优闭环。

## 架构

```
at-tuner/
├── src/
│   ├── index.ts              # CLI 入口（8 个命令注册）
│   ├── commands/             # 8 个命令: init, config, explore, generate, execute, analyze, apply, tune
│   │   ├── config.ts         # 配置管理: config set/list/init
│   ├── steps/                # 5 个核心步骤: explore, generate-test-cases, batch-execute, analyze, apply-tuning
│   ├── lib/
│   │   ├── asktable-api.ts   # AskTable REST API 封装
│   │   ├── agent-conv.ts     # Agent 对话（createAgentConv, askAgent, pollForResult）
│   │   ├── config.ts         # 配置加载: loadConfig, requireConfig, saveGlobalConfig
│   │   ├── storage.ts        # 工作区文件读写（config.json）
│   │   ├── llm-client.ts     # LLM 客户端（OpenAI / Claude 抽象）
│   │   ├── parser.ts         # Markdown 测试用例解析
│   │   └── report-formatter.ts  # 调优报告 → Markdown
│   └── types.ts              # 全部类型定义
├── package.json
├── tsconfig.json
└── AGENTS.md                 # 本文档
```

## 配置系统

配置加载优先级：CLI 选项 > 工作区配置（`.at-tuner/config.json`）> 全局配置（`~/.at-tuner/config.json`）

```json
{
  "server": "https://example.com/api/v1",
  "api_key": "ADMIN_xxx",
  "datasource_id": "ds_xxx",
  "project_id": "",
  "llm_provider": "openai",
  "llm_api_key": "sk-xxx",
  "llm_model": "MiniMax-M2.7",
  "llm_base_url": "https://api.minimaxi.com/v1"
}
```

## 实际 API 端点（已验证）

| 方法 | 路径 | 用途 | 已验证 |
|------|------|------|--------|
| GET | `/datasources/{ds_id}/meta` | 获取元数据（JSON） | ✅ |
| PATCH | `/datasources/{ds_id}/meta` | 更新字段备注（MetaAnnotation） | 未测 |
| POST | `/conversations` | 创建对话 | ✅ |
| GET | `/conversations/{conv_id}` | 获取对话详情+消息 | ✅ |
| POST | `/conversations/{conv_id}/messages` | 发送问题（202 异步） | ✅ |
| GET | `/data-agents` | 列出数据智能体 | 未测 |

## API 返回格式

### MetaResponse（GET /datasources/{ds_id}/meta）
```json
{
  "schemas": { "schemaName": { "name", "origin_desc", "curr_desc", "tables": {...} } },
  "datasource_id": "ds_xxx"
}
```

### Conversation messages（GET /conversations/{conv_id}）
消息使用 **content blocks 数组**格式（ProgressStep）：
```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "回复内容" },
    { "type": "tool_use", "id": "...", "name": "execute_sql", "input": "{...}" }
  ]
}
```

### 对话状态流
```
创建 → active
发送消息 → streaming → active (完成) / warning (错误)
```

## 关键发现

1. **创建对话不需要 data_agent_id**，但执行时若无 data_agent_id 可能不触发 Agent
2. **消息 question 字段限制 ≤ 4096 字符**，prompt 中 schema 需截断
3. **消息 content 是 blocks 数组**，不是 `{text: string}` 对象
4. **tool_use.input 是 JSON 字符串**，不是对象

## 调优闭环

```
探索数据源 → 生成测试问题 → 批量执行 → 分析结果 → 执行调优
  (schema)    (15 cases)    (conv)    (AI 分类)   (API 写入)
```
