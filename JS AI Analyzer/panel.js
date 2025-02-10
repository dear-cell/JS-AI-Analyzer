let backgroundPageConnection;

// 建立与background的连接
function connectToBackground() {
    backgroundPageConnection = chrome.runtime.connect({
        name: "devtools-panel"
    });

    backgroundPageConnection.onMessage.addListener(function(message) {
        if (message.action === 'updateProgress') {
            document.getElementById('analysisProgress').style.width = `${message.progress}%`;
            document.getElementById('progressText').textContent = 
                `${message.progress}% (${message.currentFileIndex}/${message.totalFiles})`;
            document.getElementById('currentFile').textContent = `当前文件：${message.currentFile}`;
        }
        else if (message.action === 'updateResults') {
            updateResults(message.results);
        }
        else if (message.action === 'foundFiles') {
            updateFileList(message.files);
        }
    });

    // 发送初始化消息
    backgroundPageConnection.postMessage({
        tabId: chrome.devtools.inspectedWindow.tabId,
        action: 'init'
    });
}

// 初始化连接
connectToBackground();

// 定期检查连接并重新连接
setInterval(() => {
    if (!backgroundPageConnection || backgroundPageConnection.disconnected) {
        connectToBackground();
    }
}, 5000);

// 初始化UI元素
document.addEventListener('DOMContentLoaded', async function() {
    // 首先检查所有必需的DOM元素
    const elements = {
        sendButton: document.getElementById('sendButton'),
        messageInput: document.getElementById('messageInput'),
        chatHistory: document.getElementById('chatHistory'),
        clearChat: document.getElementById('clearChat'),
        currentModel: document.getElementById('currentModel')
    };

    // 验证所有必需的元素都存在
    for (const [name, element] of Object.entries(elements)) {
        if (!element) {
            console.error(`找不到元素: ${name}`);
            return; // 如果缺少任何必需的元素，就不继续执行
        }
    }

    // 获取当前检查的标签页ID
    const tabId = chrome.devtools.inspectedWindow.tabId;
    console.log('当前检查的标签页ID:', tabId);

    // 标签切换功能
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            
            // 更新按钮状态
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // 更新内容显示
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
        });
    });

    // 获取DOM元素
    const apiType = document.getElementById('apiType');
    const localSettings = document.getElementById('localSettings');
    const remoteSettings = document.getElementById('remoteSettings');
    const fetchModelsButton = document.getElementById('fetchModels');
    const remoteModelSelect = document.getElementById('remoteModelName');
    const testConnectionButton = document.getElementById('testConnection');
    const saveSettingsButton = document.getElementById('saveSettings');

    // 获取当前模型显示元素
    const currentModelSpan = document.getElementById('currentModel');

    // 初始化设置
    await loadSettings();

    // API类型切换处理
    apiType.addEventListener('change', function() {
        if (this.value === 'local') {
            localSettings.style.display = 'block';
            remoteSettings.style.display = 'none';
        } else {
            localSettings.style.display = 'none';
            remoteSettings.style.display = 'block';
        }
    });

    // 获取可用模型按钮点击事件
    fetchModelsButton.addEventListener('click', async function() {
        const apiUrl = document.getElementById('remoteApiUrl').value.trim();
        const apiKey = document.getElementById('apiKey').value.trim();
        
        if (!apiUrl || !apiKey) {
            alert('请填写API地址和API Key');
            return;
        }

        try {
            this.disabled = true;
            this.textContent = '获取中...';

            // 从API地址中提取基础URL
            const baseUrl = apiUrl.split('/v1/')[0];
            const modelsUrl = `${baseUrl}/v1/models`;

            const response = await fetch(modelsUrl, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
                }
            });
            
            if (!response.ok) throw new Error('获取模型列表失败');

            const data = await response.json();
            remoteModelSelect.innerHTML = '<option value="">选择模型...</option>';
            
            // 处理返回的模型数据
            if (data.data && Array.isArray(data.data)) {
                data.data.forEach(model => {
                    const option = new Option(model.id, model.id);
                    remoteModelSelect.add(option);
                });
            }
        } catch (error) {
            alert('获取模型列表失败: ' + error.message);
        } finally {
            this.disabled = false;
            this.textContent = '获取可用模型';
        }
    });

    // 更新当前模型显示
    function updateCurrentModelDisplay() {
        const apiTypeValue = apiType.value;
        const modelName = apiTypeValue === 'local' ?
            document.getElementById('localModelName').value :
            remoteModelSelect.value;
        const modelType = apiTypeValue === 'local' ? '本地模型' : '远程模型';
        currentModelSpan.textContent = `当前模型: ${modelType} - ${modelName || '未设置'}`;
    }

    // 在模型选择变化时更新显示
    document.getElementById('localModelName').addEventListener('change', updateCurrentModelDisplay);
    remoteModelSelect.addEventListener('change', updateCurrentModelDisplay);
    apiType.addEventListener('change', updateCurrentModelDisplay);

    // 修复保存设置功能
    saveSettingsButton.addEventListener('click', async function() {
        const currentApiType = apiType.value;
        const settings = {
            apiType: currentApiType,
            apiUrl: currentApiType === 'local' ?
                document.getElementById('localApiUrl').value :
                document.getElementById('remoteApiUrl').value,
            modelName: currentApiType === 'local' ?
                document.getElementById('localModelName').value :
                remoteModelSelect.value
        };

        if (currentApiType === 'remote') {
            settings.apiKey = document.getElementById('apiKey').value;
            settings.apiSecret = document.getElementById('apiSecret').value;
        }

        if (!settings.apiUrl || (currentApiType === 'remote' && !settings.apiKey)) {
            alert('请填写必要的API信息');
            return;
        }

        try {
            await chrome.storage.local.set({ settings });
            updateCurrentModelDisplay(); // 更新模型显示
            alert('设置已保存');
        } catch (error) {
            alert('保存设置失败: ' + error.message);
        }
    });

    // 修改测试连接功能
    testConnectionButton.addEventListener('click', async function() {
        const currentApiType = apiType.value;
        if (currentApiType === 'remote') {
            const apiUrl = document.getElementById('remoteApiUrl').value;
            const apiKey = document.getElementById('apiKey').value;
            const modelName = remoteModelSelect.value;
            
            if (!apiKey || !modelName) {
                alert('请填写API Key和选择模型');
                return;
            }

            this.disabled = true;
            this.textContent = '测试中...';

            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: modelName,
                        messages: [
                            {
                                role: "user",
                                content: "你好"
                            }
                        ],
                        stream: false
                    })
                });

                if (!response.ok) throw new Error('连接测试失败');
                const data = await response.json();
                alert('连接测试成功！');
            } catch (error) {
                alert('连接测试失败: ' + error.message);
            } finally {
                this.disabled = false;
                this.textContent = '测试连接';
            }
        } else {
            // 本地模型测试
            const apiUrl = document.getElementById('localApiUrl').value;
            const modelName = document.getElementById('localModelName').value;
            
            this.disabled = true;
            this.textContent = '测试中...';

            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: modelName,
                        prompt: "测试连接",
                        stream: false
                    })
                });

                if (!response.ok) throw new Error('连接测试失败');
                const data = await response.json();
                alert('连接测试成功！');
            } catch (error) {
                alert('连接测试失败: ' + error.message);
            } finally {
                this.disabled = false;
                this.textContent = '测试连接';
            }
        }
    });

    // 初始化时更新当前模型显示
    updateCurrentModelDisplay();

    // 分析功能
    const startButton = document.getElementById('startAnalysis');
    const stopButton = document.getElementById('stopAnalysis');
    const clearButton = document.getElementById('clearAnalysis');

    startButton.addEventListener('click', async function() {
        console.log('点击开始分析按钮');
        try {
            // 传递 tabId 到 background
            const response = await chrome.runtime.sendMessage({
                action: 'startAnalysis',
                tabId: tabId  // 使用获取到的 tabId
            });
            
            console.log('开始分析响应:', response);
            
            // 重置UI状态
            document.getElementById('analysisProgress').style.width = '0%';
            document.getElementById('progressText').textContent = '0%';
            document.getElementById('currentFile').textContent = '开始分析...';
            
            // 禁用开始按钮，启用停止按钮
            startButton.disabled = true;
            stopButton.disabled = false;
        } catch (error) {
            console.error('开始分析失败:', error);
        }
    });

    stopButton.addEventListener('click', async function() {
        console.log('点击停止分析按钮');
        try {
            await chrome.runtime.sendMessage({
                action: 'stopAnalysis'
            });
            
            document.getElementById('currentFile').textContent = '分析已停止';
            
            // 启用开始按钮，禁用停止按钮
            startButton.disabled = false;
            stopButton.disabled = true;
        } catch (error) {
            console.error('停止分析失败:', error);
        }
    });

    clearButton.addEventListener('click', function() {
        document.getElementById('routes').innerHTML = '';
        document.getElementById('vulnerabilities').innerHTML = '';
        document.getElementById('analysisProgress').style.width = '0%';
        document.getElementById('progressText').textContent = '0%';
        document.getElementById('currentFile').textContent = '当前文件：等待开始...';
        document.getElementById('fileList').innerHTML = '<h3>检测到的JS文件：</h3>';
    });

    // 添加消息到聊天历史的函数
    function appendMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        messageDiv.textContent = content;
        elements.chatHistory.appendChild(messageDiv);
        elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
    }

    // 发送消息的函数
    async function sendMessage(message) {
        const settings = await chrome.storage.local.get('settings');
        if (!settings.settings || !settings.settings.apiKey) {
            throw new Error('请先配置API设置');
        }

        const response = await fetch(settings.settings.apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: settings.settings.modelName,
                messages: [
                    {
                        role: "user",
                        content: message
                    }
                ],
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error('API请求失败');
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    // 发送按钮点击事件
    elements.sendButton.addEventListener('click', async function() {
        const message = elements.messageInput.value.trim();
        if (!message) return;

        try {
            this.disabled = true;
            elements.messageInput.disabled = true;

            // 显示用户消息
            appendMessage('user', message);
            elements.messageInput.value = '';

            // 发送请求并显示响应
            const response = await sendMessage(message);
            appendMessage('assistant', response);
        } catch (error) {
            console.error('发送消息失败:', error);
            appendMessage('error', '发送消息失败: ' + error.message);
        } finally {
            this.disabled = false;
            elements.messageInput.disabled = false;
            elements.messageInput.focus();
        }
    });

    // 添加回车发送功能
    elements.messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            elements.sendButton.click();
        }
    });

    // 清除聊天历史
    elements.clearChat.addEventListener('click', function() {
        elements.chatHistory.innerHTML = '';
    });
});

// 更新文件列表
function updateFileList(files) {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '<h3>检测到的JS文件：</h3>';
    files.forEach(file => {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.textContent = file;
        fileList.appendChild(div);
    });
}

// 更新分析结果
function updateResults(results) {
    const routesDiv = document.getElementById('routes');
    const vulnDiv = document.getElementById('vulnerabilities');
    
    if (results.routes && results.routes.length > 0) {
        routesDiv.innerHTML = '<ul>' + 
            results.routes.map(route => `<li>${route}</li>`).join('') + 
            '</ul>';
    }
    
    if (results.vulnerabilities && results.vulnerabilities.length > 0) {
        vulnDiv.innerHTML = '<ul>' + 
            results.vulnerabilities.map(vuln => `<li>${vuln}</li>`).join('') + 
            '</ul>';
    }
}

// 加载设置函数
async function loadSettings() {
    const settings = await chrome.storage.local.get('settings');
    const apiType = document.getElementById('apiType');
    const remoteModelSelect = document.getElementById('remoteModelName');
    const currentModelSpan = document.getElementById('currentModel');

    if (settings.settings) {
        // 设置API类型
        apiType.value = settings.settings.apiType || 'local';
        
        // 根据API类型加载对应设置
        if (settings.settings.apiType === 'local') {
            document.getElementById('localApiUrl').value = settings.settings.apiUrl || 'http://127.0.0.1:11434/api/generate';
            document.getElementById('localModelName').value = settings.settings.modelName || 'deepseek-r1:8b';
        } else {
            document.getElementById('remoteApiUrl').value = settings.settings.apiUrl || '';
            document.getElementById('apiKey').value = settings.settings.apiKey || '';
            document.getElementById('apiSecret').value = settings.settings.apiSecret || '';
            
            if (settings.settings.modelName) {
                // 清空并添加保存的模型
                remoteModelSelect.innerHTML = '<option value="">选择模型...</option>';
                const option = new Option(settings.settings.modelName, settings.settings.modelName);
                remoteModelSelect.add(option);
                remoteModelSelect.value = settings.settings.modelName;
            }
        }

        // 更新显示状态
        const localSettings = document.getElementById('localSettings');
        const remoteSettings = document.getElementById('remoteSettings');
        
        if (settings.settings.apiType === 'local') {
            localSettings.style.display = 'block';
            remoteSettings.style.display = 'none';
        } else {
            localSettings.style.display = 'none';
            remoteSettings.style.display = 'block';
        }

        // 更新当前模型显示
        const modelName = settings.settings.modelName || '未设置';
        const modelType = settings.settings.apiType === 'local' ? '本地模型' : '远程模型';
        currentModelSpan.textContent = `当前模型: ${modelType} - ${modelName}`;
    }
}

// 修改分析时的API调用
async function analyzeWithAPI(scriptContent, settings) {
    // 确保 apiKey 包含 "sk-" 前缀
    const fullApiKey = settings.apiKey.startsWith('sk-') ? settings.apiKey : `sk-${settings.apiKey}`;

    const response = await fetch(settings.apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${fullApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: settings.modelName,
            messages: [
                {
                    role: "user",
                    content: generatePrompt(scriptContent)
                }
            ],
            stream: false
        })
    });

    if (!response.ok) {
        throw new Error('API请求失败');
    }

    const result = await response.json();
    return result.choices[0].message.content;
}

// 更新 background.js 中使用的提示信息格式
function generatePrompt(scriptContent) {
    return `请分析以下JavaScript代码，找出所有可能的API路由和潜在的安全漏洞。
    对于路由，请查找所有可能的URL路径，包括但不限于：
    1. API端点
    2. 后台管理路径
    3. 文件上传路径
    4. 认证相关路径
    
    对于漏洞，请特别关注：
    1. 硬编码的敏感信息（如身份证号、手机号）
    2. API密钥（如阿里云AK/SK）
    3. 数据库连接字符串
    4. 明文密码
    5. 可能的XSS漏洞
    6. 可能的CSRF漏洞
    7. 不安全的API调用
    
    请以JSON格式返回结果：
    {
      "routes": ["完整的URL路径1", "完整的URL路径2", ...],
      "vulnerabilities": ["漏洞描述1", "漏洞描述2", ...]
    }
    
    以下是需要分析的代码：
    ${scriptContent}`;
} 