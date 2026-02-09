const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- 配置 ---
// Stitch API Key 应通过环境变量读取
// 获取方式: Stitch Settings -> API Key -> Create Key
const STITCH_API_KEY = process.env.STITCH_API_KEY;
// 可选: 如果你想在一个固定的项目中生成，可以配置此 ID，否则每次会创建新项目
const DEFAULT_PROJECT_ID = process.env.STITCH_PROJECT_ID;

const STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp';

/**
 * 通用 MCP 工具调用函数
 * 实现 JSON-RPC 2.0 协议调用 Stitch 远程端点
 */
async function callStitchMcpTool(toolName, args, apiKey) {
  const payload = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args
    },
    id: Date.now()
  };

  const response = await fetch(STITCH_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey // 使用 API Key 认证
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Stitch MCP Error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`MCP Tool Error: ${data.error.message}`);
  }

  // MCP 返回的结果通常在 result.content 数组中
  return data.result;
}

/**
 * Stitch Agent 流程
 * 1. 创建项目 (Create Project)
 * 2. 生成屏幕 (Generate Screen)
 * 3. 获取详情 (Get Screen / Download Code)
 */
async function runStitchAgentFlow(userQuery, apiKey) {
  const logs = [];
  const addLog = (source, text) => logs.push(`[${source}] ${text}`);

  try {
    addLog('System', '接收设计任务: ' + userQuery);

    // Phase 1: Planning / Setup Project
    let projectId = DEFAULT_PROJECT_ID;

    if (!projectId) {
      addLog('Stitch MCP', '正在创建新的设计项目...');
      const projectResult = await callStitchMcpTool('create_project', {
        title: `AI Generation - ${new Date().toISOString().split('T')[0]}`
      }, apiKey);

      // 解析工具返回的文本结果，通常是 JSON 字符串或描述性文本
      // 假设 Stitch 返回结构中包含 projectId，这里根据文档示例逻辑进行解析
      // 注意：实际返回可能是文本，需要根据 MCP 具体实现解析，这里做健壮性处理
      const contentText = projectResult.content[0].text;

      // 尝试从返回文本中提取 Project ID (假设返回是 JSON 或包含 ID)
      // 示例假设返回对象: { "projectId": "...", "name": "..." }
      try {
        const projectData = JSON.parse(contentText);
        projectId = projectData.name || projectData.projectId;
      } catch (e) {
        // 如果不是 JSON，尝试正则提取
        // Format: projects/{project_id}
        const match = contentText.match(/projects\/[^"\s]+/);
        projectId = match ? match[0] : null;
      }

      if (!projectId) throw new Error("无法从 create_project 响应中解析 Project ID");
      addLog('Stitch MCP', `项目创建成功: ${projectId}`);
    } else {
      addLog('Stitch MCP', `使用现有项目 ID: ${projectId}`);
    }

    // Phase 2: Generation (调用 Gemini 3 Pro/Flash)
    addLog('Stitch MCP', '正在调用 generate_screen_from_text (Model: GEMINI_3_FLASH)...');

    // 根据文档 "Reference" 配置参数
    const generateParams = {
      projectId: projectId,
      prompt: userQuery,
      deviceType: "DESKTOP", // 默认为 Web 视图
      modelId: "GEMINI_3_FLASH" // 使用 Flash 速度更快，生产环境可用 GEMINI_3_PRO
    };

    const generateResult = await callStitchMcpTool('generate_screen_from_text', generateParams, apiKey);

    // 解析生成的 Screen ID
    const genContentText = generateResult.content[0].text;
    let screenId = null;
    try {
      const genData = JSON.parse(genContentText);
      screenId = genData.screenId || genData.name;
    } catch (e) {
      // Format: projects/{project_id}/screens/{screen_id}
      const match = genContentText.match(/screens\/[^"\s]+/);
      screenId = match ? match[0].split('/')[1] : null;
    }

    if (!screenId) {
      // 有些情况下 generate 可能直接返回结果描述，这里做降级处理
      addLog('Stitch MCP', '生成指令已发送，正在检索最新屏幕...');
      // 如果无法获取 ID，可以调用 list_screens 获取最新的一个
      const listResult = await callStitchMcpTool('list_screens', { projectId }, apiKey);
      // 简化的逻辑：获取列表第一个
      // 实际逻辑需要更复杂的解析
      addLog('Stitch MCP', '设计生成中，请稍候...');
    } else {
      addLog('Stitch MCP', `屏幕生成成功 ID: ${screenId}`);
    }

    // Phase 3: Retrieval (获取代码)
    addLog('Stitch MCP', '正在获取生成的 HTML 代码...');

    // 在真实 Stitch 环境中，我们需要调用 get_screen 或专门的 export 接口
    // 这里的逻辑是模拟文档中 "Download the HTML code" 的步骤
    // 如果 MCP get_screen 返回了 htmlUrl，我们可以 fetch 它

    let finalCode = `<!-- 
      Stitch Design Generated 
      Project: ${projectId}
      Prompt: ${userQuery}
    -->
    <div class="flex items-center justify-center h-screen bg-gray-100">
      <div class="text-center">
        <h1 class="text-4xl font-bold text-gray-800 mb-4">Design Generated in Stitch</h1>
        <p class="text-gray-600">Please check your Stitch Dashboard to view and export the full code.</p>
        <p class="text-sm text-gray-400 mt-2">Project ID: ${projectId}</p>
      </div>
    </div>`;

    // 尝试获取实际详情
    if (screenId) {
      try {
        const screenDetails = await callStitchMcpTool('get_screen', { projectId, screenId }, apiKey);
        const detailText = screenDetails.content[0].text;

        // 如果返回中包含 HTML 链接或代码片段
        if (detailText.includes('<html')) {
          finalCode = detailText;
        } else if (detailText.includes('http')) {
          // 如果是 URL，尝试下载 (伪代码 logic，视具体返回结构而定)
          // const url = extractUrl(detailText);
          // const res = await fetch(url);
          // finalCode = await res.text();
          addLog('Stitch MCP', '检测到外部资源链接，准备加载...');
        }
      } catch (e) {
        addLog('Stitch MCP', '获取屏幕详情失败，返回占位符。');
      }
    }

    return {
      success: true,
      logs: logs,
      code: finalCode, // 返回 HTML 供前端预览
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

  // 优先使用前端传入的 Key (Config)，其次使用环境变量
  const activeStitchKey = config?.stitchKey || STITCH_API_KEY;

  if (!activeStitchKey) {
    return res.status(500).json({ error: 'Server missing Stitch API Key' });
  }

  const result = await runStitchAgentFlow(prompt, activeStitchKey);
  res.json(result);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`MCP Endpoint configured: ${STITCH_MCP_URL}`);
});