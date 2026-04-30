---
description: RAG system coding standards for React, NestJS, and LangChain
alwaysApply: true
---

# RAG Coding Standards（强制）

本规则用于约束本项目后续所有代码生成与修改。Cursor 在响应任何开发请求时，必须先对照本规则进行自检，不满足规则时先重构方案再输出代码。

## 1. 全局规则

1. 必须使用 TypeScript 严格模式（`"strict": true`），禁止通过关闭类型检查来“修复”错误。
2. 必须遵循 ESLint 与 Prettier 的统一风格；提交前代码应可通过 lint 与格式化检查。
3. 文件与目录命名必须语义化，避免无意义缩写（`tmp`, `utils2`, `testNew` 等）。
4. 单个模块职责必须单一：路由层只处理请求，服务层只处理业务，AI 层只处理模型/检索编排。
5. 不要随意引入新依赖。新增依赖前必须满足：
   - 现有依赖无法完成目标；
   - 对包体积与维护成本影响可解释；
   - 在 PR/说明中写明引入理由与替代方案比较。

## 2. 后端规则（NestJS）

### 2.1 模块划分（必须）

- AI 相关能力统一放在 `AiModule`。
- `AiModule` 必须至少包含：
  - `AiController`（仅处理 HTTP 输入/输出）
  - `AiService`（承载业务编排逻辑）

示例结构：

```text
src/modules/ai/
  ai.module.ts
  ai.controller.ts
  ai.service.ts
```

### 2.2 依赖使用（必须）

- DeepSeek 模型调用必须使用 `@langchain/deepseek` 提供的类（如 `ChatDeepSeek`）。
- 向量化必须使用 `@langchain/openai` 提供的 `OpenAIEmbeddings`。
- 禁止绕过 LangChain SDK 直接手写 HTTP 请求去调用同类能力。

正确示例（`ChatDeepSeek` 初始化）：

```typescript
import { ChatDeepSeek } from "@langchain/deepseek";

const llm = new ChatDeepSeek({
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  apiKey: process.env.DEEPSEEK_API_KEY,
});
```

### 2.3 禁止事项（必须）

1. 禁止在 Controller 中编写业务逻辑（包括：检索、拼接提示词、模型调用、数据转换规则）。
2. 禁止硬编码 API Key、模型密钥、私有地址。
3. 禁止在异常处理中吞错（必须记录上下文并抛出可追踪错误）。

### 2.4 环境变量（必须）

- 所有模型、Embedding、向量库配置必须从 `process.env` 读取。
- 任何环境配置默认值都必须是“安全默认值”，不能默认写入真实密钥。

## 3. 前端规则（React + Zustand）

### 3.1 状态管理（必须）

- 全局状态必须使用 Zustand 的 `create` 方法创建。
- 全局状态文件必须放在 `store/` 目录下。

示例：

```typescript
import { create } from "zustand";

type ChatState = {
  mode: "rag" | "chat";
  setMode: (mode: "rag" | "chat") => void;
};

export const useChatStore = create<ChatState>((set) => ({
  mode: "rag",
  setMode: (mode) => set({ mode }),
}));
```

### 3.2 组件结构（必须）

1. 必须使用函数式组件，禁止新写 class 组件。
2. 复用型 UI 组件必须从 `@/components/ui` 导入，禁止在业务页面重复造轮子。
3. 页面组件只组织视图与交互，不承载 API 请求细节。

### 3.3 接口调用（必须）

- 所有 HTTP 请求统一封装在 `api/` 目录下。
- 必须使用 `axios` 发起请求。
- 组件中禁止直接拼接 URL 调接口。

## 4. AI 核心逻辑规则

### 4.1 向量化（必须）

- 统一使用 `OpenAIEmbeddings`。
- Embedding 模型名固定为：`text-embedding-ada-002`。

示例：

```typescript
import { OpenAIEmbeddings } from "@langchain/openai";

const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-ada-002",
  apiKey: process.env.OPENAI_API_KEY,
});
```

### 4.2 向量存储（必须）

- 演示阶段统一使用 `MemoryVectorStore`。
- 代码结构必须预留向量库替换接口（例如 `VectorStoreProvider`），禁止将 `MemoryVectorStore` 细节散落到业务代码中。

### 4.3 提示词模板（必须）

- 系统提示词必须包含“基于上下文回答”的强约束，核心要求至少包含：
  1. 仅根据提供的上下文回答；
  2. 上下文不足时明确说明“不确定/无法从资料得出”；
  3. 禁止编造来源与事实。

示例片段：

```text
你必须严格基于给定上下文回答问题。
如果上下文中没有足够信息，请明确回复“无法从提供的资料中得到答案”，不要猜测或编造。
```

## 5. 架构分层检查（每次改代码必须执行）

当用户要求修改代码时，Cursor 必须在实施前后检查以下事项：

1. 是否违反 Controller / Service / AI 编排分层（如有，必须先拆分再提交）。
2. 是否出现硬编码密钥或绕过 `process.env` 读取配置（如有，必须修复）。
3. 是否绕过 `AiModule` 直接在其他模块写 AI 主流程（如有，必须回收至 `AiService`）。
4. 是否在前端组件中直接请求后端（未走 `api/` 封装）（如有，必须修复）。
5. 是否新增了非必要依赖（如有，必须给出必要性说明或移除）。

不满足任一项时，禁止输出“已完成”，必须先修复到合规状态。

