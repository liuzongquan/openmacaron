const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- 配置 ---
const STITCH_API_KEY = process.env.STITCH_API_KEY;
const DEFAULT_PROJECT_ID = process.env.STITCH_PROJECT_ID;
const STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp';

/**
 * 使用官方 SDK 调用 Stitch MCP 工具
 * 解决 ESM 模块无法被 CommonJS require 的问题
 */
async function callStitchToolWithSdk(toolName, args, apiKey) {
  // 动态导入 ESM 模块
  const { McpClient, SSEClientTransport } = await import('@modelcontextprotocol/sdk');

  // 1. 创建远程传输层 (Remote MCP 使用 SSE)
  const transport = new SSEClientTransport(new URL(STITCH_MCP_URL), {
    headers: {
      'X-Goog-Api-Key': apiKey
    }
  });

  // 2. 创建并启动客户端
  const client = await McpClient.create(transport);

  try {
    // 3. 调用工具
    const result = await client.callTool(toolName, args);
    return result;
  } finally {
    // 4. 必须关闭连接以释放资源
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

      const text = projectResult.content[0].text;
      // 尝试从返回中解析 projectId (格式通常为 projects/xxx)
      const idMatch = text.match(/projects\/[^\s"']+/);
      projectId = idMatch ? idMatch[0] : null;

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

    // 解析 Screen ID (格式通常为 screens/xxx 或包含在路径中)
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
      if (detailText.includes('<html')) {
        finalCode = detailText;
      } else {
        finalCode = `<!-- Stitch Output -->\n<div class="p-8 text-center bg-gray-50 border border-dashed rounded-lg">\n  <h3 class="text-lg font-semibold">设计已在 Stitch 生成</h3>\n  <p class="text-sm text-gray-500">项目: ${projectId}</p>\n  <p class="text-sm text-gray-500">屏幕: ${screenId}</p>\n  <p class="mt-4 text-xs">请在 Stitch 控制台预览或导出完整代码。</p>\n</div>`;
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