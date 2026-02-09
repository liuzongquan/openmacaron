const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// 增强 CORS 配置
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// 全局请求日志
app.use((req, res, next) => {
  console.log(`[Incoming Request] ${req.method} ${req.url} - ${new Date().toISOString()}`);
  next();
});

// --- 配置 ---
const STITCH_ACCESS_TOKEN = process.env.STITCH_ACCESS_TOKEN;
const DEFAULT_PROJECT_ID = process.env.STITCH_PROJECT_ID;
const STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp';

/**
 * 使用官方 SDK 调用 Stitch MCP 工具
 */
async function callStitchToolWithSdk(toolName, args, token) {
  console.log(`[MCP Debug] 启动工具调用: ${toolName}`);

  try {
    // 动态导入 ESM 模块
    // 修复：直接导入模块名，由 Node.js 根据 package.json 的 exports 自动寻找路径
    console.log(`[MCP Debug] 正在加载 @modelcontextprotocol/sdk...`);
    const mcpSdk = await import('@modelcontextprotocol/sdk');
    const { McpClient, SSEClientTransport } = mcpSdk;

    // 1. 创建远程传输层 (使用 OAuth Bearer Token)
    console.log(`[MCP Debug] 建立 SSE 连接: ${STITCH_MCP_URL}`);

    // 注意：SSEClientTransport 在 Node 环境下可能需要显式传递 fetch
    const transport = new SSEClientTransport(new URL(STITCH_MCP_URL), {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    // 2. 创建客户端
    const client = await McpClient.create(transport);
    console.log(`[MCP Debug] 客户端连接已建立`);

    try {
      // 3. 执行
      console.log(`[MCP Debug] 执行中...`);
      const result = await client.callTool(toolName, args);
      console.log(`[MCP Debug] 调用成功`);
      return result;
    } catch (toolError) {
      console.error(`[MCP Tool Error] ${toolName} 失败:`, toolError);
      throw toolError;
    } finally {
      await client.close();
      console.log(`[MCP Debug] 连接已关闭`);
    }
  } catch (initError) {
    console.error(`[MCP Connection Error] 初始化或网络失败:`, initError);
    // 如果仍然提示路径找不到，说明是 node_modules 安装不完整或结构异常
    throw initError;
  }
}

/**
 * Stitch 设计 Agent 流程
 */
async function runStitchAgentFlow(userQuery, token) {
  const logs = [];
  const addLog = (source, text) => {
    const logMsg = `[${source}] ${text}`;
    console.log(logMsg);
    logs.push(logMsg);
  };

  try {
    addLog('System', '任务开始: ' + userQuery);

    // --- Step 1: 项目检查 ---
    let projectId = DEFAULT_PROJECT_ID;
    if (!projectId) {
      addLog('Stitch SDK', '正在创建临时项目...');
      const projectResult = await callStitchToolWithSdk('create_project', {
        title: `Auto Gen ${new Date().getTime()}`
      }, token);

      const text = projectResult.content[0].text;
      const idMatch = text.match(/projects\/[^\s"']+/);
      projectId = idMatch ? idMatch[0] : null;

      if (!projectId) throw new Error("无法获取项目 ID，请检查 Token 权限");
      addLog('Stitch SDK', `项目 ID: ${projectId}`);
    }

    // --- Step 2: 生成设计 ---
    addLog('Stitch SDK', '正在利用 Gemini 3 生成 UI...');
    const genResult = await callStitchToolWithSdk('generate_screen_from_text', {
      projectId: projectId,
      prompt: userQuery,
      deviceType: "DESKTOP",
      modelId: "GEMINI_3_FLASH"
    }, token);

    const genText = genResult.content[0].text;
    const screenMatch = genText.match(/screens\/([^"\s/]+)/);
    const screenId = screenMatch ? screenMatch[1] : null;

    if (!screenId) {
      addLog('Stitch SDK', '设计生成排队中或未直接返回 ScreenID');
    } else {
      addLog('Stitch SDK', `屏幕生成成功: ${screenId}`);
    }

    // --- Step 3: 获取代码 ---
    let finalCode = "";
    if (screenId) {
      addLog('Stitch SDK', '正在导出 HTML...');
      const screenDetails = await callStitchToolWithSdk('get_screen', { projectId, screenId }, token);
      const detailText = screenDetails.content[0].text;

      if (detailText.includes('<html')) {
        finalCode = detailText;
        addLog('Stitch SDK', '代码导出成功');
      } else {
        addLog('Stitch SDK', '返回为描述信息，非直接源码');
        finalCode = `<!-- Stitch Preview -->\n<div class="p-10 text-center"><h3>设计完成</h3><p>项目: ${projectId}</p></div>`;
      }
    }

    return { success: true, logs, code: finalCode, version: Date.now() };

  } catch (error) {
    addLog('Error', error.message);
    return { success: false, logs, error: error.message };
  }
}

app.post('/api/generate', async (req, res) => {
  console.log('[API] 收到生成请求，Payload:', JSON.stringify(req.body));

  const { prompt, config } = req.body;
  // 兼容前端传入的 key (App.tsx 中的字段名是 deepSeekKey)
  const token = config?.stitchKey || config?.deepSeekKey || STITCH_ACCESS_TOKEN;

  if (!token) {
    console.error('[API] 错误: 未提供 Auth Token');
    return res.status(401).json({ error: 'Auth Token Required' });
  }

  try {
    const result = await runStitchAgentFlow(prompt, token);
    res.json(result);
  } catch (e) {
    console.error('[API] 内部错误:', e);
    res.status(500).json({ error: e.message });
  }
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('[Fatal Error]', err);
  res.status(500).send('Server Error');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log('====================================');
  console.log(`后端服务已就绪 (SDK 修复版)`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log('====================================');
});