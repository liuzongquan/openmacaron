import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Bot, User, Box, Cpu, Terminal, 
  Layers, Loader2, Settings, Sparkles, Maximize2, X, 
  Play, RefreshCw, Eye, FileCode, AlertCircle
} from 'lucide-react';

// --- 配置常量 ---
// 默认连接本地后端，部署时请修改为生产环境 URL
const API_URL = 'http://39.105.149.49:3001/api/generate';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'thinking' | 'completed' | 'error';
}

interface Artifact {
  code: string;
  version: number;
  timestamp: number;
}

interface AppSettings {
  deepSeekKey: string;
  e2bToken: string;
}

// --- 组件: 代码编辑器 ---
const SimpleEditor = ({ code, onChange }: { code: string, onChange: (val: string) => void }) => (
  <textarea
    value={code}
    onChange={(e) => onChange(e.target.value)}
    className="w-full h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm p-4 resize-none outline-none leading-relaxed"
    spellCheck={false}
  />
);

// --- 组件: 预览沙箱 ---
const PreviewFrame = ({ code, version }: { code: string, version: number }) => {
  return (
    <div className="w-full h-full bg-white rounded-lg overflow-hidden border border-gray-200 shadow-inner relative">
       <iframe
        key={version} // Key 变化强制重载 iframe
        srcDoc={code}
        title="preview"
        className="w-full h-full border-none"
        sandbox="allow-scripts allow-modals allow-forms allow-same-origin"
      />
    </div>
  );
};

// --- 组件: 设置模态框 ---
const SettingsModal = ({ isOpen, onClose, settings, onSave }: any) => {
  if (!isOpen) return null;
  const [localSettings, setLocalSettings] = useState(settings);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold text-gray-800">系统设置</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        
        <div className="space-y-4">
          <div className="p-3 bg-blue-50 text-blue-700 text-xs rounded-lg">
             如果后端 `.env` 已配置 Key，此处可留空。在此处填写将覆盖后端配置。
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">DeepSeek API Key</label>
            <input 
              type="password" 
              value={localSettings.deepSeekKey}
              onChange={e => setLocalSettings({...localSettings, deepSeekKey: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="sk-..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E2B Access Token (Optional)</label>
            <input 
              type="password" 
              value={localSettings.e2bToken}
              onChange={e => setLocalSettings({...localSettings, e2bToken: e.target.value})}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="e2b_..."
            />
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">取消</button>
          <button 
            onClick={() => { onSave(localSettings); onClose(); }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  // State
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '我是 OpenMacaron (Live版)。请输入你的需求，我将通过 DeepSeek V3 为你生成代码。',
      timestamp: Date.now(),
      status: 'completed'
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'logs'>('preview');
  const [showSettings, setShowSettings] = useState(false);
  const [agentLogs, setAgentLogs] = useState<string[]>([]);
  const [currentArtifact, setCurrentArtifact] = useState<Artifact | null>(null);
  const [settings, setSettings] = useState<AppSettings>({ deepSeekKey: '', e2bToken: '' });
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentLogs]);

  const handleSend = async () => {
    if (!input.trim()) return;

    // 1. 设置 UI 状态
    const userMsg: Message = { id: 'u-' + Date.now(), role: 'user', content: input, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setAgentLogs([]);
    setActiveTab('logs');

    // 2. 创建 AI 思考中消息
    const aiMsgId = 'ai-' + Date.now();
    setMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', content: '', timestamp: Date.now(), status: 'thinking' }]);

    try {
        // 3. 发送请求到后端
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: userMsg.content,
                config: settings
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Unknown error');
        }

        // 4. 更新状态
        setAgentLogs(data.logs || []);
        
        if (data.code) {
            setCurrentArtifact({
                code: data.code,
                version: data.version,
                timestamp: Date.now()
            });
            setActiveTab('preview');
        }

        setMessages(prev => prev.map(m => m.id === aiMsgId ? { 
            ...m, 
            status: 'completed', 
            content: '生成成功！请在右侧预览。' 
        } : m));

    } catch (err: any) {
        console.error(err);
        setAgentLogs(prev => [...prev, `[Error] ${err.message}`]);
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { 
            ...m, 
            status: 'error', 
            content: `生成失败: ${err.message}. 请检查 API Key 或后端服务。` 
        } : m));
    } finally {
        setIsLoading(false);
    }
  };

  const handleCodeUpdate = (newCode: string) => {
      if (currentArtifact) {
          // 这里我们只是更新 React 状态，没有回写到后端历史，实际应用中可以做
          setCurrentArtifact({ ...currentArtifact, code: newCode });
      }
  };

  const handleRunManually = () => {
      if (currentArtifact) {
           // 强制增加版本号以刷新 iframe
           setCurrentArtifact({ ...currentArtifact, version: currentArtifact.version + 1 });
           setActiveTab('preview');
      }
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans overflow-hidden">
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} settings={settings} onSave={setSettings} />

      {/* Sidebar */}
      <div className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-4 z-10 hidden sm:flex">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg">
          <Bot size={24} />
        </div>
        <div className="flex-1" />
        <button onClick={() => setShowSettings(true)} className="p-2 text-gray-400 hover:text-indigo-600 rounded-lg">
          <Settings size={20} />
        </button>
      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <header className="h-14 border-b border-gray-100 flex items-center px-4 justify-between bg-white/80 backdrop-blur">
          <span className="font-bold text-gray-800">OpenMacaron</span>
          <div className="text-xs text-gray-400 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></span>
            {isLoading ? 'Processing...' : 'Ready'}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} gap-3`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' : 'bg-green-100 text-green-600'}`}>
                  {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white border border-gray-100 text-gray-700 rounded-bl-none'}`}>
                   {msg.status === 'thinking' ? (
                       <div className="flex items-center gap-2"><Loader2 size={14} className="animate-spin"/> 正在规划与生成...</div>
                   ) : msg.status === 'error' ? (
                       <div className="text-red-500 flex items-center gap-2"><AlertCircle size={14}/> {msg.content}</div>
                   ) : (
                       <div>{msg.content}</div>
                   )}
                </div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-gray-100">
          <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-xl p-2 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="描述应用 (例如: 一个极简的待办事项列表)"
              className="flex-1 max-h-32 bg-transparent border-none outline-none resize-none py-2 text-sm"
              rows={1}
            />
            <button onClick={handleSend} disabled={!input.trim() || isLoading} className="p-2 bg-indigo-600 text-white rounded-lg disabled:bg-gray-300">
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Artifact Panel */}
      <div className={`w-[45%] bg-gray-50 border-l border-gray-200 flex flex-col transition-transform ${currentArtifact ? 'translate-x-0' : 'translate-x-full hidden lg:flex'}`}>
        <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-3">
            <div className="flex bg-gray-100 p-1 rounded-lg">
              {['preview', 'code', 'logs'].map(tab => (
                  <button 
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold capitalize ${activeTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                  >
                    {tab}
                  </button>
              ))}
            </div>
            {activeTab === 'code' && (
                <button onClick={handleRunManually} className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700">
                    <Play size={12}/> Run
                </button>
            )}
        </div>

        <div className="flex-1 overflow-hidden relative bg-gray-100">
            {!currentArtifact && !isLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                    <div className="text-center"><Layers size={48} className="mx-auto mb-2 opacity-20"/>无内容</div>
                </div>
            )}
            
            <div className={`w-full h-full ${activeTab === 'preview' && currentArtifact ? 'block' : 'hidden'}`}>
                {currentArtifact && <PreviewFrame code={currentArtifact.code} version={currentArtifact.version} />}
            </div>
            
            <div className={`w-full h-full ${activeTab === 'code' && currentArtifact ? 'block' : 'hidden'}`}>
                {currentArtifact && <SimpleEditor code={currentArtifact.code} onChange={handleCodeUpdate} />}
            </div>

            <div className={`w-full h-full bg-[#111] p-4 font-mono text-xs overflow-y-auto ${activeTab === 'logs' ? 'block' : 'hidden'}`}>
                {agentLogs.map((log, i) => (
                    <div key={i} className={`mb-1 ${log.includes('Error') ? 'text-red-400' : 'text-gray-300'}`}>{log}</div>
                ))}
            </div>
        </div>
      </div>
    </div>
  );
}
