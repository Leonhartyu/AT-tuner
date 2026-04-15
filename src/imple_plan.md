Implement the following plan:                                                  
                                                                             
  # AskTable 调优 CLI Agent 方案                                             
                                                                             
  ## Context                                                                 
                                                                             
  目标：构建一个**独立发行的 npm CLI 工具**（`@datamini/at-tuner`），通过    
  AskTable 现有 API 完成数据源调优闭环，无需修改 AskTable 源码。             
                                                                             
  核心思路：**问题驱动治理**——用 AI 发现数据问题，用 AI 生成补全建议，用 API 
   完成知识补充。                                                            
                                                                             
  ---                                                                        
                                                                             
  ## 用户操作流程                                                            
                                                                             
  ```                                                                        
  用户导入数据源（拿到 ds_id）                                               
          ↓                                                                  
  用户启动 CLI：npx @datamini/at-tuner tune --datasource ds_xxx --server     
  https://xxx                                                                
          ↓                                                                  
  ┌─────────────────────────────────────────────┐                            
  │  Step 1: Agent 探索数据源                    │                           
  │   - 读取表结构（inspect_metadata）           │                           
  │   - 用 conv 跑 1-2 条示例查询看数据           │                          
  └─────────────────────────────────────────────┘                             
          ↓                                                                  
  ┌─────────────────────────────────────────────┐                            
  │  Step 2: Agent 生成测试问题集                 │                          
  │   - 5 个简单问题（表结构理解）                │                          
  │   - 5 个口径问题（指标定义歧义）              │                          
  │   - 5 个复杂查询（多表/聚合/窗口函数）        │                          
  │   - 用户可补充更多问题                       │                           
  │   - 存为 .at-tuner/test-cases.md            │                            
  └─────────────────────────────────────────────┘                            
          ↓                                                                  
  ┌─────────────────────────────────────────────┐                            
  │  Step 3: 批量执行（异步conv）                │                           
  │   - 对每个问题创建 conversation             │                            
  │   - 并发发送（控制并发数）                   │                           
  │   - 打印实时进度日志                         │                           
  │   - 所有结果存为 .at-tuner/results/        │                               
  └─────────────────────────────────────────────┘                             
          ↓                                                                  
  用户：把所有 conv JSON 文件放到 results/ 目录                                  
          ↓                                                                    
  ┌─────────────────────────────────────────────┐                            
  │  Step 4: 结果分析 + 生成报告                 │                           
  │   - 读取 JSON，判断是否有明显错误             │                          
  │   - 按根因分类（字段备注/术语/skill）        │                           
  │   - 生成调优报告 .at-tuner/tuning-report.md │                            
  └─────────────────────────────────────────────┘                            
          ↓                                                                  
  ┌─────────────────────────────────────────────┐                            
  │  Step 5: 执行调优（API 批量写入）            │                           
  │   - 字段备注：PATCH /{ds_id}/meta           │                            
  │   - 术语库：POST /v1/business-glossary      │                            
  │   - Skill：从失败场景生成 SKILL.md 草稿      │                           
  └─────────────────────────────────────────────┘                            
  ```                                                                        
                                                                             
  ---                                                                        
                                                                             
  ## 目录结构                                                                
                                                                             
  ```                                                                        
  .at-tuner/                    # 工作目录（.gitignored）                    
  ├── config.yaml               # ds_id、server、api_key 配置                
  ├── test-cases.md             # 测试问题集（Agent 生成 + 用户补充）        
  ├── schema.md                 # 缓存的数据源结构                           
  ├── tuning-report.md          # 调优报告                                   
  └── results/                  # conv 执行结果（JSON 文件）                 
      ├── case-001.json                                                      
      ├── case-002.json                                                      
      └── ...                                                                
  ```                                                                        
                                                                             
  ---                                                                        
                                                                             
  ## Step 1 实现：探索数据源                                                 
                                                                             
  ### 输入                                                                   
  - `datasource_id`                                                          
  - `server_url` + `api_key`                                                 
                                                                             
  ### 流程                                                                   
                                                                             
  ```typescript                                                              
  // src/steps/explore.ts                                                    
                                                                             
  interface ExploreResult {                                                  
    schema: string;           // Markdown 格式的表结构                       
    sampleQueries: SampleQuery[];                                            
  }                                                                          
                                                                             
  interface SampleQuery {                                                    
    question: string;                                                        
    sql: string;                                                             
    result: any;                                                             
  }                                                                          
                                                                             
  async function exploreDatasource(                                          
    datasourceId: string,                                                    
    ctx: AgentContext                                                        
  ): Promise<ExploreResult> {                                                
    // 1. inspect_metadata 拉完整 schema                                     
    const schema = await ctx.inspectMetadata({                               
      datasource_id: datasourceId,                                           
    });                                                                      
                                                                             
    // 2. 随机选 2-3 张核心表，用 conv 跑简单 count 查询                     
    const tables = extractCoreTables(schema);                                
    const sampleQueries = [];                                                
                                                                             
    for (const table of tables.slice(0, 3)) {                                
      const question = `这张表有多少行数据？`;                               
      const { sql, result } = await ctx.converse(question, {                 
        datasource_id: datasourceId,                                         
        schema_context: table,  // 只给 AI 看这张表的结构                    
      });                                                                    
      sampleQueries.push({ question, sql, result });                         
    }                                                                        
                                                                             
    return { schema, sampleQueries };                                        
  }                                                                          
  ```                                                                        
                                                                             
  ### CLI 命令                                                               
  ```bash                                                                    
  at-tuner explore --datasource ds_xxx --server https://xxx --api-key xxx    
  ```                                                                        
                                                                             
  ---                                                                        
                                                                             
  ## Step 2 实现：生成测试问题集                                             
                                                                             
  ### 核心逻辑                                                               
                                                                             
  ```typescript                                                              
  // src/steps/generate-test-cases.ts                                        
                                                                             
  interface TestCase {                                                       
    id: string;                                                              
    category: 'simple' | 'metric' | 'complex';                               
    question: string;                                                        
    expected_result_hint: string;  // 预期结果的方向提示（不是精确 SQL）     
    sql_template?: string;         // 可选：直接给定 SQL 模板                
  }                                                                          
                                                                             
  async function generateTestCases(                                          
    schema: string,                                                          
    sampleQueries: SampleQuery[],                                            
    ctx: AgentContext                                                        
  ): Promise<TestCase[]> {                                                   
    const prompt = `                                                         
  你是一个数据质量测试专家。基于以下数据源结构，生成 15 个测试问题：         
                                                                             
  数据结构：                                                                 
  ${schema}                                                                  
                                                                             
  示例查询（帮助理解数据）：                                                 
  ${sampleQueries.map(q => `Q: ${q.question}\nSQL: ${q.sql}`).join('\n')}    
                                                                             
  要求：                                                                     
  1. 5 个简单问题：表结构理解、基础筛选、计数汇总                            
  2. 5 个口径问题：涉及"延迟"、"占比"、"同比"等业务指标的定义                
  3. 5 个复杂查询：多表 JOIN、子查询、窗口函数、复杂聚合                     
                                                                             
  每个问题需要：                                                             
  - id: case-001 格式                                                        
  - category: simple | metric | complex                                      
  - question: 用户会问的自然语言问题                                         
  - expected_result_hint: 预期结果的方向（如"返回订单数量排名前10的供应商"） 
  `;                                                                         
                                                                             
    const response = await ctx.llm.complete([                                
      { role: 'user', content: prompt }                                      
    ]);                                                                      
                                                                             
    return parseTestCases(response.content);                                 
  }                                                                          
  ```                                                                        
                                                                             
  ### 输出格式（`.at-tuner/test-cases.md`）                                  
                                                                             
  ```markdown                                                                
  # AskTable 调优测试问题集                                                  
                                                                             
  ## 配置                                                                    
  - 数据源：ds_xxx                                                           
  - 生成时间：2026-04-14                                                     
                                                                             
  ## 说明                                                                    
  - simple：简单表结构理解                                                   
  - metric：涉及业务指标口径                                                 
  - complex：复杂多表查询                                                    
                                                                             
  ---                                                                        
                                                                             
  ## 简单问题（simple）                                                      
                                                                             
  ### case-001                                                               
  - **问题**：这张表有多少行数据？                                           
  - **预期结果方向**：返回一个数字（总行数）                                 
                                                                             
  ---                                                                        
                                                                             
  ## 口径问题（metric）                                                      
                                                                             
  ### case-006                                                               
  - **问题**：哪些供应商的交货延迟超过了30天？                               
  - **预期结果方向**：返回供应商名称 + 延迟天数列表，按延迟天数降序          
  - **口径说明**：延迟 = 实际审批日期 - 合同交付日期                         
                                                                             
  ---                                                                        
                                                                             
  ## 复杂查询（complex）                                                     
                                                                             
  ### case-011                                                               
  - **问题**：按月统计每个物料类别的交货延迟率趋势                           
  - **预期结果方向**：月份、物料类别、延迟率三列，按月排序                   
  - **口径说明**：延迟率 = 延迟订单数 / 总订单数                             
                                                                             
  ---                                                                        
                                                                             
  ## 用户补充问题                                                            
                                                                             
  （用户可在此区域手动添加更多测试问题，格式同上）                           
  ```                                                                        
                                                                             
  ### CLI 命令                                                               
  ```bash                                                                    
  # 生成问题集（基于已探索的数据源）                                         
  at-tuner generate --workspace .at-tuner                                    
                                                                             
  # 用户补充问题后，重新生成                                                 
  at-tuner generate --workspace .at-tuner --append                           
  ```                                                                        
                                                                             
  ---                                                                        
                                                                             
  ## Step 3 实现：批量执行对话                                               
                                                                             
  ### 核心逻辑                                                               
                                                                             
  **关键决策**：使用 AskTable conv 接口自身作为 Agent，让 AskTable           
  自己分析自己。批量执行通过 conversation API 轮询获取结果。                 
                                                                             
  ```typescript                                                              
  // src/steps/batch-execute.ts                                              
                                                                             
  interface ExecutionResult {                                                
    caseId: string;                                                          
    status: 'success' | 'error' | 'timeout';                                 
    question: string;                                                        
    convId: string | null;                                                   
    generatedSql: string | null;                                             
    result: any;                                                             
    error: string | null;                                                    
    duration: number;                                                        
  }                                                                          
                                                                             
  async function batchExecute(                                               
    testCases: TestCase[],                                                   
    ctx: AgentContext,                                                       
    options: { concurrency: number; timeout: number }                        
  ): Promise<ExecutionResult[]> {                                            
    const results: ExecutionResult[] = [];                                   
                                                                             
    console.log(`\n🚀 开始批量执行，共 ${testCases.length} 个问题`);         
    console.log(`⏱️   单题超时: ${options.timeout}ms | 并发数:                
  ${options.concurrency}\n`);                                                
                                                                             
    // 分批并发执行                                                          
    for (let i = 0; i < testCases.length; i += options.concurrency) {        
      const batch = testCases.slice(i, i + options.concurrency);             
      const batchResults = await Promise.all(                                
        batch.map(task => executeOne(task, options.timeout))                 
      );                                                                     
      results.push(...batchResults);                                         
      printProgress(results, testCases.length);                              
    }                                                                        
                                                                             
    console.log(`\n\n✅ 执行完成\n`);                                        
    return results;                                                          
  }                                                                          
                                                                             
  async function executeOne(                                                 
    task: TestCase,                                                          
    timeout: number                                                          
  ): Promise<ExecutionResult> {                                              
    const start = Date.now();                                                
    const ctx = getAgentContext();                                           
                                                                             
    try {                                                                    
      // 1. 创建 conversation                                                
      const conv = await ctx.api.createConversation({                        
        datasource_id: ctx.datasourceId,                                     
      });                                                                    
      console.log(`  📝 [${task.id}] 创建对话: ${conv.id}`);                 
                                                                             
      // 2. 发送问题                                                         
      await ctx.api.sendMessage(conv.id, task.question);                     
                                                                             
      // 3. 轮询等待结果（每 2s 检查一次）                                   
      const result = await pollForResult(conv.id, {                          
        timeout,                                                             
        interval: 2000,                                                      
        onProgress: (elapsed) => {                                           
          process.stdout.clearLine(0);                                       
          process.stdout.cursorTo(0);                                        
          process.stdout.write(`  ⏳ [${task.id}] 已等待 ${elapsed}s...`);   
        }                                                                    
      });                                                                    
                                                                             
      const duration = Date.now() - start;                                   
                                                                             
      // 4. 提取 SQL 和结果                                                  
      const { sql, data } = parseConvResult(result);                         
                                                                             
      return {                                                               
        caseId: task.id,                                                     
        status: 'success',                                                   
        question: task.question,                                             
        convId: conv.id,                                                     
        generatedSql: sql,                                                   
        result: data,                                                        
        error: null,                                                         
        duration,                                                            
      };                                                                     
    } catch (e) {                                                            
      return {                                                               
        caseId: task.id,                                                     
        status: e.message.includes('timeout') ? 'timeout' : 'error',         
        question: task.question,                                             
        convId: null,                                                        
        generatedSql: null,                                                  
        result: null,                                                        
        error: e.message,                                                    
        duration: Date.now() - start,                                        
      };                                                                     
    }                                                                        
  }                                                                          
                                                                             
  async function pollForResult(                                              
    convId: string,                                                          
    options: { timeout: number; interval: number; onProgress: (s: number) => 
   void }                                                                    
  ): Promise<any> {                                                          
    const start = Date.now();                                                
                                                                             
    while (Date.now() - start < options.timeout) {                           
      const messages = await ctx.api.getMessages(convId);                    
                                                                             
      // 检查是否有 assistant 的回复且状态为 completed                       
      const assistantMsg = messages.find(m => m.role === 'assistant');       
      if (assistantMsg && assistantMsg.status === 'completed') {             
        return assistantMsg;                                                 
      }                                                                      
                                                                             
      options.onProgress(Math.floor((Date.now() - start) / 1000));           
      await sleep(options.interval);                                         
    }                                                                        
                                                                             
    throw new Error('timeout');                                              
  }                                                                          
  ```                                                                        
                                                                             
  ### AskTable API 封装                                                      
                                                                             
  ```typescript                                                              
  // src/lib/asktable-api.ts                                                 
                                                                             
  class AskTableAPI {                                                        
    constructor(                                                             
      private serverUrl: string,                                             
      private apiKey: string                                                 
    ) {}                                                                     
                                                                             
    async createConversation(payload: {                                      
      datasource_id: string;                                                 
      skill_ids?: string[];                                                  
    }): Promise<{ id: string }> {                                            
      const res = await fetch(`${this.serverUrl}/v1/conversations`, {        
        method: 'POST',                                                      
        headers: {                                                           
          'Authorization': `Bearer ${this.apiKey}`,                          
          'Content-Type': 'application/json',                                
        },                                                                   
        body: JSON.stringify(payload),                                       
      });                                                                    
      return res.json();                                                     
    }                                                                        
                                                                             
    async sendMessage(convId: string, content: string): Promise<void> {      
      await fetch(`${this.serverUrl}/v1/conversations/${convId}/messages`, { 
        method: 'POST',                                                      
        headers: {                                                           
          'Authorization': `Bearer ${this.apiKey}`,                          
          'Content-Type': 'application/json',                                
        },                                                                   
        body: JSON.stringify({ content }),                                   
      });                                                                    
    }                                                                        
                                                                             
    async getMessages(convId: string): Promise<Message[]> {                  
      const res = await                                                      
  fetch(`${this.serverUrl}/v1/conversations/${convId}/messages`, {           
        headers: { 'Authorization': `Bearer ${this.apiKey}` },               
      });                                                                    
      return res.json();                                                     
    }                                                                        
                                                                             
    async inspectMetadata(payload: {                                         
      datasource_id: string;                                                 
      schema?: string;                                                       
      table?: string;                                                        
      field?: string;                                                        
    }): Promise<string> {                                                    
      const res = await fetch(`${this.serverUrl}/v1/meta/inspect`, {         
        method: 'POST',                                                      
        headers: {                                                           
          'Authorization': `Bearer ${this.apiKey}`,                          
          'Content-Type': 'application/json',                                
        },                                                                   
        body: JSON.stringify(payload),                                       
      });                                                                    
      return res.text(); // 返回 Markdown 格式                               
    }                                                                        
                                                                             
    async patchFieldDesc(                                                    
      datasourceId: string,                                                  
      payload: { table: string; field: string; desc: string }                
    ): Promise<void> {                                                       
      await fetch(`${this.serverUrl}/v1/${datasourceId}/meta`, {             
        method: 'PATCH',                                                     
        headers: {                                                           
          'Authorization': `Bearer ${this.apiKey}`,                          
          'Content-Type': 'application/json',                                
        },                                                                   
        body: JSON.stringify(payload),                                       
      });                                                                    
    }                                                                        
                                                                             
    async createGlossaryTerm(payload: {                                      
      term: string;                                                          
      definition: string;                                                    
      aliases?: string[];                                                    
      projectId: string;                                                     
    }): Promise<void> {                                                      
      await fetch(`${this.serverUrl}/v1/business-glossary`, {                
        method: 'POST',                                                      
        headers: {                                                           
          'Authorization': `Bearer ${this.apiKey}`,                          
          'Content-Type': 'application/json',                                
        },                                                                   
        body: JSON.stringify(payload),                                       
      });                                                                    
    }                                                                        
  }                                                                          
  ```                                                                        
                                                                             
  ### 输出：每个 case 保存一个 JSON                                          
                                                                             
  ```json                                                                    
  // .at-tuner/results/case-001.json                                         
  {                                                                          
    "id": "case-001",                                                        
    "status": "success",                                                     
    "question": "这张表有多少行数据？",                                      
    "convId": "conv_xxx",                                                    
    "generatedSql": "SELECT COUNT(*) FROM schema.table",                     
    "result": { "count": 12345 },                                            
    "duration": 12500,                                                       
    "executedAt": "2026-04-14T10:30:00Z"                                     
  }                                                                          
  ```                                                                        
                                                                             
  ### CLI 命令                                                               
                                                                             
  ```bash                                                                    
  at-tuner execute --workspace .at-tuner --concurrency 3 --timeout 60000     
                                                                             
  # 输出示例：                                                               
  # 🚀 开始批量执行，共 15 个问题                                            
  # ⏱️   单题超时: 60000ms | 并发数: 3                                        
  #                                                                          
  #   ⏳ [case-001] 已等待 2s...                                             
  #   ⏳ [case-002] 已等待 2s...                                             
  #   ⏳ [case-001] 已等待 4s...                                             
  #   ✅ [case-001] 完成 (12.5s) | SQL: SELECT COUNT(*) FROM ...             
  #   ⏳ [case-003] 已等待 2s...                                             
  # ...                                                                      
  #                                                                          
  # ✅ 执行完成 | ✅ 12 成功 | ❌ 3 失败 | ⏱️  总耗时 2m15s                   
  # 📁 结果保存在 .at-tuner/results/                                         
  # 💡 请将所有 JSON 文件保持在 results/ 目录，运行 at-tuner analyze 继续    
  ```                                                                        
                                                                             
  ---                                                                        
                                                                             
  ## Step 4 实现：结果分析 + 调优报告                                        
                                                                             
  ### 核心逻辑                                                               
                                                                             
  ```typescript                                                              
  // src/steps/analyze.ts                                                    
                                                                             
  interface TuningSuggestion {                                               
    category: 'field_desc' | 'glossary' | 'skill';                           
    case_id: string;                                                         
    question: string;                                                        
    root_cause: string;                                                      
    current_value?: string;       // 当前字段备注/术语定义                   
    suggested_value: string;      # 建议的字段备注/术语定义                  
    api_payload: object;          # 可直接调用 API 的 payload                
    priority: 'high' | 'medium' | 'low';                                     
  }                                                                          
                                                                             
  interface TuningReport {                                                   
    summary: {                                                               
      total: number;                                                         
      success: number;                                                       
      failed: number;                                                        
      field_desc_suggestions: number;                                        
      glossary_suggestions: number;                                          
      skill_suggestions: number;                                             
    };                                                                       
    cases: ExecutionResult[];                                                
    suggestions: TuningSuggestion[];                                         
  }                                                                          
                                                                             
  async function analyzeResults(                                             
    results: ExecutionResult[],                                              
    testCases: TestCase[],                                                   
    schema: string,                                                          
    ctx: AgentContext                                                        
  ): Promise<TuningReport> {                                                 
    const suggestions: TuningSuggestion[] = [];                              
                                                                             
    // 创建 Agent 分析用 conv（复用 AskTable conv 作为 LLM）                 
    const agentConvId = await ctx.createAgentConv(                           
      '你是一个 AskTable 调优专家，擅长分析 SQL 错误并给出精确的调优建议。'  
    );                                                                       
                                                                             
    for (const result of results) {                                          
      if (result.status !== 'success') {                                     
        const suggestion = await analyzeFailure(result, schema, ctx,         
  agentConvId);                                                              
        if (suggestion) suggestions.push(suggestion);                        
        continue;                                                            
      }                                                                      
                                                                             
      // 执行成功，但检查结果是否合理                                        
      const issues = await checkResultQuality(result, ctx, agentConvId);     
      if (issues.length > 0) {                                               
        for (const issue of issues) {                                        
          suggestions.push(...await generateSuggestions(result, issue,       
  schema, ctx, agentConvId));                                                
        }                                                                    
      }                                                                      
    }                                                                        
                                                                             
    return buildReport(results, suggestions);                                
  }                                                                          
                                                                             
  async function analyzeFailure(                                             
    result: ExecutionResult,                                                 
    schema: string,                                                          
    ctx: AgentContext,                                                       
    agentConvId: string                                                      
  ): Promise<TuningSuggestion | null> {                                      
    // 通过 AskTable conv 让 AI 分析失败原因                                 
    const answer = await ctx.askAgent(agentConvId, `                         
  以下是一个失败 case：                                                      
                                                                             
  问题：${result.question}                                                   
  错误信息：${result.error}                                                  
  生成的 SQL：${result.generatedSql}                                         
                                                                             
  数据源 Schema：                                                            
  ${schema}                                                                  
                                                                             
  请判断根因并生成调优建议。只输出 JSON 格式。                               
  `);                                                                        
    return parseSuggestion(answer);                                          
  }                                                                          
  ```                                                                        
                                                                             
  ### 报告格式（`.at-tuner/tuning-report.md`）                               
                                                                             
  ```markdown                                                                
  # AskTable 调优报告                                                        
                                                                             
  ## 执行摘要                                                                
                                                                             
  | 指标 | 数值 |                                                            
  |------|------|                                                            
  | 总问题数 | 15 |                                                          
  | 成功 | 12 |                                                              
  | 失败 | 3 |                                                               
  | 字段备注建议 | 2 |                                                       
  | 术语库建议 | 1 |                                                         
  | Skill 建议 | 0 |                                                         
                                                                             
  ## 调优建议                                                                
                                                                             
  ### 🔴 高优先级                                                            
                                                                             
  #### case-003：字段理解错误                                                
  - **问题**：哪些供应商交货延迟了？                                         
  - **根因**：AI 使用了 `wi_latest_createdate`（入库单创建日期）而非         
  `wi_latest_approveddate`（审批日期）                                       
  - **当前字段备注**：「入库单创建日期」                                     
  - **建议备注**：「入库单创建日期（注意：实际交货日期应使用审批日期         
  wi_latest_approveddate）」                                                 
  - **API 操作**：                                                           
    ```bash                                                                  
    curl -X PATCH "https://xxx/api/v1/ds_xxx/meta" \                         
      -H "Authorization: Bearer xxx" \                                       
      -d '{"table": "wi_workorder", "field": "wi_latest_createdate", "desc": 
   "入库单创建日期（注意：实际交货日期应使用审批日期                         
  wi_latest_approveddate）"}'                                                
    ```                                                                      
  - **影响范围**：所有涉及"实际交货日期"的查询                               
                                                                             
  ---                                                                        
                                                                             
  ### 🟡 中优先级                                                            
                                                                             
  #### case-007：业务术语歧义                                                
  - **问题**：计算本月订单的准时交付率                                       
  - **根因**："准时交付"口径不明确，AI                                       
  按"实际日期=计划日期"理解，实际应考虑审批流程                              
  - **建议**：在术语库添加「准时交付率」定义                                 
  - **API 操作**：                                                           
    ```bash                                                                  
    at-tuner glossary add \                                                  
      --term "准时交付率" \                                                  
      --definition "当月实际审批日期 <= 合同交付日期的订单数 / 当月总订单数  
  × 100%" \                                                                  
      --aliases "准时率,按时交付率"                                          
    ```                                                                      
  ```                                                                        
                                                                             
  ---                                                                        
                                                                             
  ## Step 5 实现：执行调优（API 批量写入）                                   
                                                                             
  ### 核心逻辑                                                               
                                                                             
  ```typescript                                                              
  // src/steps/apply-tuning.ts                                               
                                                                             
  async function applyTuning(                                                
    report: TuningReport,                                                    
    ctx: AgentContext,                                                       
    options: { dry-run: boolean; confirm: boolean }                          
  ) {                                                                        
    if (options.dry-run) {                                                   
      console.log('🔍 预演模式，只展示将执行的 API 调用\n');                 
    }                                                                        
                                                                             
    const applied: string[] = [];                                            
    const failed: string[] = [];                                             
                                                                             
    for (const suggestion of report.suggestions) {                           
      if (suggestion.category === 'field_desc') {                            
        await applyFieldDesc(suggestion, ctx, options);                      
      } else if (suggestion.category === 'glossary') {                       
        await applyGlossary(suggestion, ctx, options);                       
      } else if (suggestion.category === 'skill') {                          
        await applySkill(suggestion, ctx, options);                          
      }                                                                      
                                                                             
      applied.push(suggestion.case_id);                                      
      console.log(`  ✅ ${suggestion.case_id}: ${suggestion.category}`);     
    }                                                                        
                                                                             
    console.log(`\n📊 调优完成：${applied.length} 项成功，${failed.length}   
  项失败`);                                                                  
  }                                                                          
  ```                                                                        
                                                                             
  ### API 调用封装                                                           
                                                                             
  ```typescript                                                              
  // src/lib/asktable-api.ts                                                 
                                                                             
  class AskTableAPI {                                                        
    constructor(                                                             
      private serverUrl: string,                                             
      private apiKey: string                                                 
    ) {}                                                                     
                                                                             
    // 更新字段备注                                                          
    async patchFieldDesc(                                                    
      datasourceId: string,                                                  
      payload: {                                                             
        table: string;                                                       
        field: string;                                                       
        desc: string;                                                        
      }                                                                      
    ): Promise<void> {                                                       
      await this.request(`PATCH /v1/${datasourceId}/meta`, payload);         
    }                                                                        
                                                                             
    // 添加术语                                                              
    async createGlossaryTerm(payload: {                                      
      term: string;                                                          
      definition: string;                                                    
      aliases?: string[];                                                    
      projectId: string;                                                     
    }): Promise<void> {                                                      
      await this.request('POST /v1/business-glossary', payload);             
    }                                                                        
                                                                             
    // 同步 skill 到平台（如果平台支持）                                     
    async syncSkill(name: string, content: string): Promise<void> {          
      await this.request('POST /v1/skills', { name, description: content,    
  content });                                                                
    }                                                                        
  }                                                                          
  ```                                                                        
                                                                             
  ---                                                                        
                                                                             
  ## 完整 CLI 命令                                                           
                                                                             
  ```bash                                                                    
  # 安装                                                                     
  npm install -g @datamini/at-tuner                                          
                                                                             
  # 初始化工作区（创建 .at-tuner 目录）                                      
  at-tuner init --workspace ./tuning-test                                    
                                                                             
  # Step 1: 探索数据源                                                       
  at-tuner explore --datasource ds_xxx --server https://xxx --api-key xxx    
  --workspace ./tuning-test                                                  
                                                                             
  # Step 2: 生成测试问题集                                                   
  at-tuner generate --workspace ./tuning-test                                
                                                                             
  # Step 3: 批量执行对话                                                     
  at-tuner execute --workspace ./tuning-test --concurrency 3 --timeout 60000 
                                                                             
  # Step 4: 分析结果 + 生成报告                                              
  at-tuner analyze --workspace ./tuning-test                                 
                                                                             
  # Step 5: 确认并执行调优                                                   
  at-tuner apply --workspace ./tuning-test --confirm                         
                                                                             
  # 一键执行全部流程                                                         
  at-tuner tune --datasource ds_xxx --server https://xxx --api-key xxx       
  --workspace ./tuning-test                                                  
  ```                                                                        
                                                                             
  ---                                                                        
                                                                             
  ## 项目结构                                                                
                                                                             
  ```                                                                        
  at-tuner/                                                                  
  ├── src/                                                                   
  │   ├── index.ts              # CLI 入口                                   
  │   ├── commands/                                                          
  │   │   ├── tune.ts           # tune 命令（一键执行）                      
  │   │   ├── explore.ts        # explore 命令                               
  │   │   ├── generate.ts       # generate 命令                              
  │   │   ├── execute.ts        # execute 命令                               
  │   │   ├── analyze.ts        # analyze 命令                               
  │   │   └── apply.ts          # apply 命令                                 
  │   ├── steps/                                                             
  │   │   ├── explore.ts        # Step 1: 探索数据源                         
  │   │   ├── generate-test-cases.ts  # Step 2: 生成问题集                   
  │   │   ├── batch-execute.ts  # Step 3: 批量执行                           
  │   │   ├── analyze.ts        # Step 4: 结果分析                           
  │   │   └── apply-tuning.ts   # Step 5: 执行调优                           
  │   ├── lib/                                                               
  │   │   ├── asktable-api.ts   # AskTable API 封装                          
  │   │   ├── agent-conv.ts     # Agent 自分析用 conv 封装                   
  │   │   ├── storage.ts        # 文件读写                                   
  │   │   └── parser.ts         # 解析器（从 conv JSON 提取 SQL+结果）       
  │   └── types.ts              # 类型定义                                   
  ├── package.json                                                           
  ├── tsconfig.json                                                          
  └── README.md                                                              
  ```                                                                        
                                                                             
  ---                                                                        
                                                                             
  ## 技术选型                                                                
                                                                             
  - **Runtime**: Node.js 18+，TypeScript                                     
  - **CLI Framework**: commander.js（轻量、简单）                            
  - **HTTP Client**: built-in fetch                                          
  - **LLM**: 全部使用 AskTable conv 接口自身（详见下节）                     
  - **并发控制**: 原生 Promise.all + batch 分组                              
  - **存储**: 本地文件系统（`.at-tuner/` 目录）                              
  - **发行**: npm package (`@datamini/at-tuner`)                             
                                                                             
  ---                                                                        
                                                                             
  ## LLM 决策：全部使用 AskTable conv                                        
                                                                             
  **核心思路**：让 AskTable 自己分析自己，不需要额外的 LLM API Key。         
                                                                             
  所有需要 LLM                                                               
  能力的地方（生成测试问题、分析失败原因、生成调优建议），都通过 AskTable    
  conv 接口实现：                                                            
                                                                             
  ```                                                                        
  ┌──────────────────────────────────────────┐                               
  │          at-tuner Agent                   │                              
  │                                          │                               
  │  Step 2 生成问题 ────→ AskTable conv     │                               
  │  （问："基于这个schema，生成15个测试问题） │                             
  │                                          │                               
  │  Step 4 分析结果 ────→ AskTable conv     │                               
  │  （问："分析这个失败 case 的根因）        │                              
  └──────────────────────────────────────────┘                               
           ↓                                                                 
      AskTable 平台                                                          
  ```                                                                        
                                                                             
  **实现**：创建专门用于"Agent 自分析"的 conversation，带上 system prompt    
  说明角色和任务。                                                           
                                                                             
  ```typescript                                                              
  // src/lib/agent-conv.ts                                                   
                                                                             
  /**                                                                        
   * 创建一个 AskTable conv 会话，用于 Agent 自身做分析/生成任务             
   * systemPrompt 说明：你是 AskTable 调优专家，擅长分析 SQL                 
  错误和生成调优建议                                                         
   */                                                                        
  async function createAgentConv(                                            
    api: AskTableAPI,                                                        
    datasourceId: string,                                                    
    systemPrompt: string                                                     
  ): Promise<string> {                                                       
    const conv = await api.createConversation({ datasource_id: datasourceId  
  });                                                                        
                                                                             
    // 先发一条 system message 设置角色                                      
    await api.sendMessage(conv.id, `[SYSTEM] ${systemPrompt}`);              
                                                                             
    return conv.id;                                                          
  }                                                                          
                                                                             
  /**                                                                        
   * 用 Agent conv 问一个问题并等待回答                                      
   */                                                                        
  async function askAgent(                                                   
    api: AskTableAPI,                                                        
    convId: string,                                                          
    question: string,                                                        
    timeout: number                                                          
  ): Promise<string> {                                                       
    await api.sendMessage(convId, question);                                 
                                                                             
    // 轮询等待回答                                                          
    const result = await pollForResult(api, convId, timeout);                
    return extractAnswer(result);                                            
  }                                                                          
  ```                                                                        
                                                                             
  **优点**：                                                                 
  1. 用户不需要额外配置 LLM API Key                                          
  2. Agent 和被调优的系统是同一个，减少环境差异                              
  3. 复用了 AskTable 已有的 Schema Linking + SQL 生成能力                    
                                                                             
  ---                                                                        
                                                                             
  ## 错误处理策略                                                            
                                                                             
  | 错误类型 | 处理方式 |                                                    
  |---------|---------|                                                      
  | API 调用超时 | 重试 3 次，间隔 2s |                                      
  | LLM 分析失败 | 降级为规则判断，记录为"未分类" |                          
  | 执行结果 JSON 解析失败 | 跳过该 case，标记为"解析失败" |                 
  | API 写入失败 | 记录到 failed list，最后汇总重试 |    