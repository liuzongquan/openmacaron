const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- 配置 ---
// 注意：使用 OAuth 时，此变量应存储 Access Token
const STITCH_ACCESS_TOKEN = process.env.STITCH_ACCESS_TOKEN;
const DEFAULT_PROJECT_ID = process.env.STITCH_PROJECT_ID;
const STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp';

/**
 * 使用官方 SDK 调用 Stitch MCP 工具
 * 采用 OAuth (Bearer Token) 方式验证，并增加详细日志
 */
async function callStitchToolWithSdk(toolName, args, token) {
  console.log(`[MCP Debug] 准备调用工具: ${toolName}`);
  console.log(`[MCP Debug] 参数详情:`, JSON.stringify(args));

  try {
    // 动态导入 ESM 模块
    console.log(`[MCP Debug] 正在加载 @modelcontextprotocol/sdk...`);
    const { McpClient, SSEClientTransport } = await import('@modelcontextprotocol/sdk');

    // 1. 创建远程传输层 (使用 OAuth Bearer Token)
    console.log(`[MCP Debug] 初始化 SSE 传输层，终点: ${STITCH_MCP_URL}`);
    const transport = new SSEClientTransport(new URL(STITCH_MCP_URL), {
      headers: {
        'Authorization': `Bearer ${token}` // 切换为 OAuth 方式
      }
    });

    // 2. 创建并启动客户端
    console.log(`[MCP Debug] 正在连接 MCP 客户端...`);
    const client = await McpClient.create(transport);
    console.log(`[MCP Debug] 客户端连接成功。`);

    try {
      // 3. 执行工具调用
      console.log(`[MCP Debug] 正在执行 ${toolName}...`);
      const result = await client.callTool(toolName, args);
      console.log(`[MCP Debug] ${toolName} 调用完成，结果已返回。`);
      return result;
    } catch (toolError) {
      console.error(`[MCP Error] 工具执行失败 (${toolName}):`, toolError.message);
      throw toolError;
    } finally {
      // 4. 关闭连接
      console.log(`[MCP Debug] 正在关闭连接...`);
      await client.close();
    }
  } catch (initError) {
    console.error(`[MCP Error] 客户端初始化或网络故障:`, initError.message);
    throw initError;
  }
}

/**
 * 核心业务流程: Stitch 设计 Agent
 */
async function runStitchAgentFlow(userQuery, token) {
  const logs = [];
  const addLog = (source, text) => {
    const logMsg = `[${source}] ${text}`;
    console.log(logMsg); // 同步输出到服务器控制台
    logs.push(logMsg);   // 存储到返回给前端的日志数组
  };

  try {
    addLog('System', '接收设计任务: ' + userQuery);

    // --- Step 1: 获取或创建项目 ---
    let projectId = DEFAULT_PROJECT_ID;
    if (!projectId) {
      addLog('Stitch SDK', '正在创建项目容器 (create_project)...');
      const projectResult = await callStitchToolWithSdk('create_project', {
        title: `Stitch Gen - ${new Date().toLocaleTimeString('zh-CN')}`
      }, token);

      const text = projectResult.content[0].text;
      const idMatch = text.match(/projects\/[^\s"']+/);
      projectId = idMatch ? idMatch[0] : null;

      if (!projectId) {
        addLog('Error', '未能从响应中提取 Project ID。原始返回: ' + text);
        throw new Error("无法解析创建的项目 ID");
      }
      addLog('Stitch SDK', `项目就绪: ${projectId}`);
    }

    // --- Step 2: 生成设计 ---
    addLog('Stitch SDK', `正在调用生成工具 (Model: GEMINI_3_FLASH)...`);
    const genResult = await callStitchToolWithSdk('generate_screen_from_text', {
      projectId: projectId,
      prompt: userQuery,
      deviceType: "DESKTOP",
      modelId: "GEMINI_3_FLASH"
    }, token);

    const genText = genResult.content[0].text;
    addLog('Stitch SDK', '设计生成成功，正在解析 Screen ID...');

    const screenMatch = genText.match(/screens\/([^"\s/]+)/);
    const screenId = screenMatch ? screenMatch[1] : null;

    // --- Step 3: 获取 HTML 代码 ---
    let finalCode = "";
    if (screenId) {
      addLog('Stitch SDK', `正在检索屏幕详情 (get_screen): ${screenId}`);
      const screenDetails = await callStitchToolWithSdk('get_screen', {
        projectId,
        screenId
      }, token);

      const detailText = screenDetails.content[0].text;
      if (detailText.includes('<html')) {
        addLog('Stitch SDK', '代码获取成功。');
        finalCode = detailText;
      } else {
        addLog('Stitch SDK', '未获得直接代码，生成占位预览。');
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
    addLog('Error', error.message);
    return {
      success: false,
      logs: logs,
      error: error.message
    };
  }
}

app.post('/api/generate', async (req, res) => {
  const { prompt, config } = req.body;
  // 优先从前端配置获取 token，如果没有则回退到环境变量
  const token = config?.stitchKey || STITCH_ACCESS_TOKEN;

  if (!token) {
    console.error('[Server] 未检测到有效的 Access Token');
    return res.status(401).json({ error: 'Missing Stitch OAuth Token' });
  }

  const result = await runStitchAgentFlow(prompt, token);
  res.json(result);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('====================================');
  console.log(`Stitch MCP Server (OAuth版) 运行中`);
  console.log(`端口: ${PORT}`);
  console.log(`端点: ${STITCH_MCP_URL}`);
  console.log('====================================');
});