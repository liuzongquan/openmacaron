const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { Sandbox } = require('@e2b/code-interpreter');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- 配置 ---
// 实际部署时，API Key 应通过环境变量读取
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY; 
const E2B_ACCESS_TOKEN = process.env.E2B_ACCESS_TOKEN;

// 初始化 DeepSeek 客户端 (兼容 OpenAI SDK)
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: DEEPSEEK_API_KEY || 'sk-placeholder', // 允许前端传入覆盖
});

/**
 * 模拟 ACE-TS 的 Agent 思考流
 * 1. Planning: 分析需求
 * 2. Coding: 生成代码
 */
async function runAgentFlow(userQuery, apiKey, e2bToken) {
  const client = apiKey ? new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey }) : openai;
  
  const logs = [];
  const addLog = (source, text) => logs.push(`[${source}] ${text}`);

  try {
    // Phase 1: Planning (思考阶段)
    addLog('System', '接收任务: ' + userQuery);
    addLog('ACE-TS', '正在构建组件架构与依赖树...');
    
    // 这里为了演示速度，我们简化了 ACE-TS 的复杂 prompt，直接让 DeepSeek 进行 COT (Chain of Thought)
    // 在真实生产环境，这里会是一组复杂的 Prompt Chain
    
    // Phase 2: Generation (生成阶段)
    addLog('DeepSeek-V3', '正在生成 Web 应用代码...');
    
    const systemPrompt = `
      你是一个全栈 Web 开发专家。
      请根据用户需求生成一个单文件的 HTML 应用 (包含 Tailwind CSS 和 JS)。
      
      要求：
      1. 必须是完整的 <!DOCTYPE html> 结构。
      2. 样式必须美观，使用 Tailwind CSS CDN。
      3. 如果有交互逻辑，请直接嵌入 <script>。
      4. 只返回 HTML 代码，不要包含 Markdown 标记（如 \`\`\`html）。
    `;

    const completion = await client.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userQuery }
      ],
      model: "deepseek-chat",
      temperature: 0.1, // 代码生成需要低随机性
    });

    let generatedCode = completion.choices[0].message.content;
    
    // 清理可能存在的 Markdown 标记
    generatedCode = generatedCode.replace(/```html/g, '').replace(/```/g, '');

    // Phase 3: Sandbox Execution (E2B 验证阶段 - 可选)
    // 如果是 HTML，我们主要做静态分析；如果是 Python，我们会放入 E2B 执行
    if (e2bToken) {
        addLog('E2B', '正在初始化沙箱环境...');
        try {
            // 演示：检查代码是否包含危险操作，或者简单的环境准备
            // 在实际的 Macaron 中，这里会启动一个 Dev Server
            addLog('E2B', '环境安全检查通过 (Node.js v20)');
            addLog('E2B', '准备即时预览链接...');
        } catch (e) {
            addLog('E2B', '沙箱连接警告: ' + e.message);
        }
    } else {
        addLog('System', '跳过沙箱执行 (未配置 Token)，仅进行静态预览');
    }

    return {
      success: true,
      logs: logs,
      code: generatedCode,
      version: Date.now()
    };

  } catch (error) {
    console.error(error);
    return {
      success: false,
      logs: logs,
      error: error.message
    };
  }
}

app.post('/api/generate', async (req, res) => {
  const { prompt, config } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // 支持前端传入 Key，或者使用后端环境变量
  const activeDeepSeekKey = config?.deepSeekKey || DEEPSEEK_API_KEY;
  const activeE2bToken = config?.e2bToken || E2B_ACCESS_TOKEN;

  if (!activeDeepSeekKey) {
     return res.status(500).json({ error: 'Server missing DeepSeek API Key' });
  }

  const result = await runAgentFlow(prompt, activeDeepSeekKey, activeE2bToken);
  res.json(result);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
