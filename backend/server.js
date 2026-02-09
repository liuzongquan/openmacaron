const express = require('express');
const cors = require('cors');
require('dotenv').config();

// 引入 MCP 官方 SDK 依赖
// 注意：需要先运行 npm install @modelcontextprotocol/sdk
const { McpClient, SSEClientTransport } = require('@modelcontextprotocol/sdk');

const app = express();
app.use(cors());
app.use(express.json());

// --- 配置 ---
const STITCH_API_KEY = process.env.STITCH_API_KEY;
const DEFAULT_PROJECT_ID = process.env.STITCH_PROJECT_ID;
const STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp';

/**
 * 使用官方 SDK 调用 Stitch MCP 工具
 */
async function callStitchToolWithSdk(toolName, args, apiKey) {
  // 1. 创建远程传输层 (Remote MCP 使用 SSE)
  const transport = new SSEClientTransport(new URL(STITCH_MCP_URL), {
    headers: {
      'X-Goog-Api-Key': apiKey
    }
  });

  // 2. 创建并启动客户端
  const client = await McpClient.create(transport);

  try {
    // 3. (可选) 检查可用工具确认连接正常
    // const tools = await client.listTools();

    // 4. 调用工具
    // SDK 的 callTool 会处理 JSON-RPC 封装
    const result = await client.callTool(toolName, args);

    // MCP 返回的结果通常在 content 数组中
    return result;
  } finally {
    // 5. 必须关闭连接以释放资源
    await client.close();
  }
}

/**
 * 核心业务流程: Stitch 设计 Agent
 */
async function runStitchAgentFlow(userQuery, apiKey) {
  const logs = [];
  const addLog = (source, text) => logs.push(`[${source}] ${text}`);

  try {
    addLog('System', '接收设计任务: ' + userQuery);

    // --- Step 1: 获取或创建项目 ---
    let projectId = DEFAULT_PROJECT_ID;
    if (!projectId) {
      addLog('Stitch SDK', '正在创建项目容器...');
      const projectResult = await callStitchToolWithSdk('create_project', {
        title: `SDK Gen - ${new Date().toLocaleTimeString()}`
      }, apiKey);

      // 解析返回结果 (SDK result 对象结构取决于服务器返回)
      const text = projectResult.content[0].text;
      // 简单解析 ID
      projectId = text.match(/projects\/[^"\s]+/) ? text.match(/projects\/[^"\s]+/)[0] : null;

      if (!projectId) throw new Error("无法解析创建的项目 ID");
      addLog('Stitch SDK', `项目就绪: ${projectId}`);
    }

    // --- Step 2: 生成设计 (Gemini 3) ---
    addLog('Stitch SDK', '调用生成工具 (GEMINI_3_FLASH)...');
    const genResult = await callStitchToolWithSdk('generate_screen_from_text', {
      projectId: projectId,
      prompt: userQuery,
      deviceType: "DESKTOP",
      modelId: "GEMINI_3_FLASH"
    }, apiKey);

    const genText = genResult.content[0].text;
    addLog('Stitch SDK', '生成结果已返回');

    // 解析 Screen ID
    const screenMatch = genText.match(/screens\/([^"\s/]+)/);
    const screenId = screenMatch ? screenMatch[1] : null;

    // --- Step 3: 获取 HTML 代码 ---
    let finalCode = "";
    if (screenId) {
      addLog('Stitch SDK', `正在检索屏幕详情: ${screenId}`);
      const screenDetails = await callStitchToolWithSdk('get_screen', {
        projectId,
        screenId
      }, apiKey);

      const detailText = screenDetails.content[0].text;
      // 简单处理：如果是 HTML 标签则提取，否则返回链接/描述
      if (detailText.includes('<html')) {
        finalCode = detailText;
      } else {
        finalCode = `<!-- Stitch Output -->\n<div class="p-8 text-center">设计已在项目 ${projectId} 中生成，屏幕 ID: ${screenId}。请前往控制台查看完整代码。</div>`;
      }
    }

    return {
      success: true,
      logs: logs,
      code: finalCode || "<!-- 无代码返回 -->",
      version: Date.now()
    };

  } catch (error) {
    console.error('Agent Flow Error:', error);
    return {
      success: false,
      logs: logs,
      error: error.message
    };
  }
}

app.post('/api/generate', async (req, res) => {
  const { prompt, config } = req.body;
  const apiKey = config?.stitchKey || STITCH_API_KEY;

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing Stitch API Key' });
  }

  const result = await runStitchAgentFlow(prompt, apiKey);
  res.json(result);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Stitch MCP Server (SDK) 正在运行在端口 ${PORT}`);
});