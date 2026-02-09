import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// 初始化环境变量
dotenv.config();

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
// 优先从环境变量读取，如果前端未传值，则使用此默认值
const STITCH_ACCESS_TOKEN = process.env.STITCH_ACCESS_TOKEN;
const DEFAULT_PROJECT_ID = process.env.STITCH_PROJECT_ID;
const STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp';

/**
 * 核心修复：手动实现基于 JSON-RPC 的工具调用
 * 绕过 SDK 路径解析问题，直接通过 HTTP 调用远程 MCP 服务
 */
async function callStitchToolDirect(toolName, args, token) {
  console.log(`[Stitch Debug] 正在调用工具: ${toolName}`);

  // 生成标准的 JSON-RPC 2.0 请求
  const payload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args
    }
  };
  console.log("[Stitch Debug]接收请求参数：%j",payload);
  try {
    const response = await fetch(STITCH_MCP_URL, {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();

    if (!response.ok) {
      // 针对 401 错误提供特殊说明
      if (response.status === 401) {
        throw new Error(`身份验证失败 (401): 请检查您的 Stitch Access Token 是否正确或已过期。原文: ${responseText}`);
      }
      throw new Error(`HTTP Error ${response.status}: ${responseText}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`无法解析响应 JSON: ${responseText}`);
    }

    if (data.error) {
      throw new Error(`MCP 逻辑错误: ${data.error.message || JSON.stringify(data.error)}`);
    }

    // Stitch 的响应结构通常在 result.content 中
    if (data.result && data.result.isError) {
      throw new Error(`工具执行返回错误: ${data.result.content?.[0]?.text || '未知错误'}`);
    }

    console.log(`[Stitch Debug] ${toolName} 响应成功`);
    return data.result;
  } catch (error) {
    console.error(`[Stitch Connection Error]`, error.message);
    throw error;
  }
}

/**
 * Stitch 设计 Agent 流程 (核心业务逻辑)
 */
async function runStitchAgentFlow(userQuery, token) {
  const logs = [];
  const addLog = (source, text) => {
    const logMsg = `[${source}] ${text}`;
    console.log(logMsg);
    logs.push(logMsg);
  };

  try {
    addLog('System', '接收设计任务: ' + userQuery);

    // --- Step 1: 项目检查/创建 ---
    let projectId = DEFAULT_PROJECT_ID;
    if (!projectId) {
      addLog('Stitch', '未检测到项目ID，正在尝试创建新项目...');
      const projectResult = await callStitchToolDirect('create_project', {
        title: `AI Gen - ${new Date().toLocaleTimeString('zh-CN')}`
      }, token);

      const text = projectResult.content[0].text;
      const idMatch = text.match(/projects\/([^\s"']+)/);
      projectId = idMatch ? idMatch[1] : null;

      if (!projectId) throw new Error("项目创建失败或无法解析 ID");
      addLog('Stitch', `项目就绪: ${projectId}`);
    }

    // --- Step 2: 生成 UI 设计 (Gemini 3 Flash) ---
    addLog('Stitch', '发送设计需求至 Gemini 3 Flash...');
    const genResult = await callStitchToolDirect('generate_screen_from_text', {
      projectId: projectId,
      prompt: userQuery,
      deviceType: "DESKTOP",
      modelId: "GEMINI_3_FLASH"
    }, token);
    console.log("[Stitch Debug] genResult: %j", genResult);
    const genText = genResult.content[0].text;
    console.log("[Stitch Debug] genText:", genText);
    const screenResult = await callStitchToolDirect('get_screen', {
      projectId: projectId,
    }, token)
    console.log("[Stitch Debug] screenResult: %j", screenResult);

    const screenMatch = genText.match(/screens\/([^"\s/]+)/);
    const screenId = screenMatch ? screenMatch[1] : null;

    if (!screenId) {
      addLog('Stitch', '设计已入库，但未直接返回预览 ID。');
    } else {
      addLog('Stitch', `生成成功，Screen ID: ${screenId}`);
    }

    // --- Step 3: 提取 HTML 代码 ---
    let finalCode = "";
    if (screenId) {
      addLog('Stitch', '正在导出 HTML 源代码...');
      const screenDetails = await callStitchToolDirect('get_screen', { projectId, screenId }, token);
      const detailText = screenDetails.content[0].text;

      if (detailText.includes('<html')) {
        finalCode = detailText;
        addLog('Stitch', '代码提取完成。');
      } else {
        addLog('Stitch', '返回内容非 HTML 源码，生成预览占位。');
        finalCode = `<!-- Stitch Preview -->\n<div class="p-12 text-center bg-gray-50 border-2 border-dashed rounded-xl">\n  <h2 class="text-xl font-bold mb-2">Stitch 设计已完成</h2>\n  <p class="text-gray-600">项目: ${projectId}</p>\n  <p class="text-gray-600">屏幕: ${screenId}</p>\n  <p class="mt-4 text-sm text-blue-600 underline">请在控制台查看或手动导出代码</p>\n</div>`;
      }
    }

    return { success: true, logs, code: finalCode, version: Date.now() };

  } catch (error) {
    addLog('Error', error.message);
    return { success: false, logs, error: error.message };
  }
}

// API 路由
app.post('/api/generate', async (req, res) => {
  console.log('[API] 收到请求，Payload:', JSON.stringify(req.body));

  const { prompt, config } = req.body;

  // 逻辑：优先使用前端 Settings 里的 Key，如果没有，再找环境变量
  const token = config?.deepSeekKey || STITCH_ACCESS_TOKEN;

  if (!token || token.trim() === "") {
    console.error('[API] 拒绝请求: 未提供有效的 Auth Token (Stitch OAuth Access Token)');
    return res.status(401).json({
      error: '未提供验证凭据。请在前端设置中的 "DeepSeek Key" 处填入您的 Stitch OAuth Access Token。'
    });
  }

  console.log(`[API] 使用 Token: ${token.substring(0, 10)}...`);

  try {
    const result = await runStitchAgentFlow(prompt, token);
    res.json(result);
  } catch (e) {
    console.error('[API] 处理异常:', e);
    res.status(500).json({ error: e.message });
  }
});

// 全局错误捕获
app.use((err, req, res, next) => {
  console.error('[Server Fatal]', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log('====================================');
  console.log(`Stitch Native ESM Server 运行中`);
  console.log(`监听地址: http://0.0.0.0:${PORT}`);
  console.log('====================================');
});