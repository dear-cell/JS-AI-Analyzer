document.addEventListener('DOMContentLoaded', async function() {
    // 获取所有DOM元素
    const elements = {
        // 标签页元素
        tabs: document.querySelectorAll('.tab'),
        tabContents: document.querySelectorAll('.tab-content'),
        
        // 聊天相关元素
        sendButton: document.getElementById('sendButton'),
        messageInput: document.getElementById('messageInput'),
        chatHistory: document.getElementById('chatHistory'),
        clearChat: document.getElementById('clearChat'),
        currentModel: document.getElementById('currentModel'),
        
        // 设置相关元素
        apiType: document.getElementById('apiType'),
        localSettings: document.getElementById('localSettings'),
        remoteSettings: document.getElementById('remoteSettings'),
        fetchModels: document.getElementById('fetchModels'),
        remoteModelSelect: document.getElementById('remoteModelName'),
        testConnection: document.getElementById('testConnection'),
        saveSettings: document.getElementById('saveSettings'),
        
        // 分析相关元素
        startAnalysis: document.getElementById('startAnalysis'),
        stopAnalysis: document.getElementById('stopAnalysis'),
        routesList: document.getElementById('routesList'),
        vulnList: document.getElementById('vulnList')
    };

    // 标签页切换功能
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');
            
            // 更新标签页状态
            elements.tabs.forEach(t => t.classList.remove('active'));
            elements.tabContents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // 加载设置
    async function loadSettings() {
        const settings = await chrome.storage.local.get('settings');
        if (settings.settings) {
            elements.apiType.value = settings.settings.apiType || 'local';
            if (settings.settings.apiType === 'local') {
                document.getElementById('localApiUrl').value = settings.settings.apiUrl || 'http://127.0.0.1:11434/api/generate';
                document.getElementById('localModelName').value = settings.settings.modelName || 'deepseek-r1:8b';
            } else {
                document.getElementById('remoteApiUrl').value = settings.settings.apiUrl || '';
                document.getElementById('apiKey').value = settings.settings.apiKey || '';
                document.getElementById('apiSecret').value = settings.settings.apiSecret || '';
                if (settings.settings.modelName) {
                    const option = new Option(settings.settings.modelName, settings.settings.modelName);
                    elements.remoteModelSelect.add(option);
                    elements.remoteModelSelect.value = settings.settings.modelName;
                }
            }
            updateApiSettingsVisibility(settings.settings.apiType);
            updateCurrentModelDisplay();
        }
    }

    // 更新API设置可见性
    function updateApiSettingsVisibility(apiType) {
        if (apiType === 'local') {
            elements.localSettings.style.display = 'block';
            elements.remoteSettings.style.display = 'none';
        } else {
            elements.localSettings.style.display = 'none';
            elements.remoteSettings.style.display = 'block';
        }
    }

    // 更新当前模型显示
    function updateCurrentModelDisplay() {
        const apiTypeValue = elements.apiType.value;
        const modelName = apiTypeValue === 'local' ?
            document.getElementById('localModelName').value :
            elements.remoteModelSelect.value;
        const modelType = apiTypeValue === 'local' ? '本地模型' : '远程模型';
        elements.currentModel.textContent = `当前模型: ${modelType} - ${modelName || '未设置'}`;
    }

    // 添加消息到聊天历史
    function appendMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        messageDiv.textContent = content;
        elements.chatHistory.appendChild(messageDiv);
        elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
        // 保存消息历史
        saveChatHistory();
    }

    // 修改发送消息函数
    async function sendMessage(message) {
        const settings = await chrome.storage.local.get('settings');
        if (!settings.settings) {
            throw new Error('请先配置API设置');
        }

        const currentApiType = settings.settings.apiType;
        
        if (currentApiType === 'local') {
            // 本地模型请求
            const response = await fetch(settings.settings.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: settings.settings.modelName,
                    prompt: message,
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error('API请求失败');
            }

            const data = await response.json();
            return data.response;
        } else {
            // 远程API请求
            if (!settings.settings.apiKey) {
                throw new Error('请配置API Key');
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
    }

    // 事件监听器设置
    // API类型切换
    elements.apiType.addEventListener('change', function() {
        updateApiSettingsVisibility(this.value);
        updateCurrentModelDisplay();
    });

    // 修改发送按钮点击事件处理
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

    // 回车发送
    elements.messageInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            elements.sendButton.click();
        }
    });

    // 清除聊天历史
    elements.clearChat.addEventListener('click', async function() {
        elements.chatHistory.innerHTML = '';
        // 清除存储的消息历史
        await chrome.storage.local.remove('chatHistory');
    });

    // 获取可用模型
    elements.fetchModels.addEventListener('click', async function() {
        const apiUrl = document.getElementById('remoteApiUrl').value.trim();
        const apiKey = document.getElementById('apiKey').value.trim();
        
        if (!apiUrl || !apiKey) {
            alert('请填写API地址和API Key');
            return;
        }

        try {
            this.disabled = true;
            this.textContent = '获取中...';

            const baseUrl = apiUrl.split('/v1/')[0];
            const modelsUrl = `${baseUrl}/v1/models`;

            const response = await fetch(modelsUrl, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error('获取模型列表失败');

            const data = await response.json();
            elements.remoteModelSelect.innerHTML = '<option value="">选择模型...</option>';
            
            if (data.data && Array.isArray(data.data)) {
                data.data.forEach(model => {
                    const option = new Option(model.id, model.id);
                    elements.remoteModelSelect.add(option);
                });
            }
        } catch (error) {
            alert('获取模型列表失败: ' + error.message);
        } finally {
            this.disabled = false;
            this.textContent = '获取可用模型';
        }
    });

    // 分析相关功能
    let analysisInProgress = false;
    const allRoutes = new Set();
    const allVulnerabilities = new Set();
    
    // 开始分析
    elements.startAnalysis.addEventListener('click', async function() {
        try {
            // 检查设置
            const settings = await chrome.storage.local.get('settings');
            if (!settings.settings || !settings.settings.apiKey) {
                throw new Error('请先配置API设置');
            }

            // 更新UI状态
            analysisInProgress = true;
            elements.startAnalysis.style.display = 'none';
            elements.stopAnalysis.style.display = 'block';
            elements.routesList.innerHTML = '';
            elements.vulnList.innerHTML = '';
            allRoutes.clear();
            allVulnerabilities.clear();

            // 获取当前标签页
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                throw new Error('无法获取当前标签页');
            }

            // 发送消息给background脚本开始分析
            chrome.runtime.sendMessage({
                action: 'startAnalysis',
                tabId: tab.id
            });

        } catch (error) {
            alert('启动分析失败: ' + error.message);
            resetAnalysisState();
        }
    });

    // 停止分析
    elements.stopAnalysis.addEventListener('click', function() {
        chrome.runtime.sendMessage({ action: 'stopAnalysis' });
        resetAnalysisState();
    });

    // 重置分析状态
    function resetAnalysisState() {
        analysisInProgress = false;
        elements.startAnalysis.style.display = 'block';
        elements.stopAnalysis.style.display = 'none';
    }

    // 更新分析结果
    function updateResults(results) {
        if (results.routes) {
            elements.routesList.innerHTML = '';
            results.routes.forEach(route => {
                const li = document.createElement('li');
                li.textContent = route;
                elements.routesList.appendChild(li);
            });
        }
        if (results.vulnerabilities) {
            elements.vulnList.innerHTML = '';
            results.vulnerabilities.forEach(vuln => {
                const li = document.createElement('li');
                li.textContent = vuln;
                elements.vulnList.appendChild(li);
            });
        }
    }

    // 监听来自background的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'updateResults') {
            updateResults(message.results);
        }
    });

    // 生成分析提示
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

    // 保存分析状态
    async function saveState() {
        await chrome.storage.local.set({
            analysisState: {
                inProgress: analysisInProgress,
                routes: Array.from(allRoutes),
                vulnerabilities: Array.from(allVulnerabilities)
            }
        });
    }

    // 加载分析状态
    async function loadState() {
        const state = await chrome.storage.local.get('analysisState');
        if (state.analysisState) {
            analysisInProgress = state.analysisState.inProgress;
            if (state.analysisState.routes) {
                state.analysisState.routes.forEach(route => allRoutes.add(route));
            }
            if (state.analysisState.vulnerabilities) {
                state.analysisState.vulnerabilities.forEach(vuln => allVulnerabilities.add(vuln));
            }
            updateResults({
                routes: Array.from(allRoutes),
                vulnerabilities: Array.from(allVulnerabilities)
            });
            if (analysisInProgress) {
                elements.startAnalysis.style.display = 'none';
                elements.stopAnalysis.style.display = 'block';
            }
        }
    }

    // 修改保存设置功能
    elements.saveSettings.addEventListener('click', async function() {
        try {
            const currentApiType = elements.apiType.value;
            const settings = {
                apiType: currentApiType
            };

            if (currentApiType === 'local') {
                settings.apiUrl = document.getElementById('localApiUrl').value.trim();
                settings.modelName = document.getElementById('localModelName').value.trim();
            } else {
                settings.apiUrl = document.getElementById('remoteApiUrl').value.trim();
                settings.apiKey = document.getElementById('apiKey').value.trim();
                settings.apiSecret = document.getElementById('apiSecret').value.trim();
                settings.modelName = elements.remoteModelSelect.value;
            }

            // 验证必填字段
            if (!settings.apiUrl) {
                throw new Error('请填写API地址');
            }
            if (currentApiType === 'remote' && !settings.apiKey) {
                throw new Error('请填写API Key');
            }
            if (currentApiType === 'remote' && !settings.modelName) {
                throw new Error('请选择模型');
            }

            // 保存设置
            await chrome.storage.local.set({ settings });
            updateCurrentModelDisplay();
            alert('设置已保存');
        } catch (error) {
            alert('保存设置失败: ' + error.message);
        }
    });

    // 修改测试连接功能
    elements.testConnection.addEventListener('click', async function() {
        try {
            const currentApiType = elements.apiType.value;
            let apiUrl, apiKey, modelName;

            if (currentApiType === 'local') {
                apiUrl = document.getElementById('localApiUrl').value.trim();
                modelName = document.getElementById('localModelName').value.trim();
                
                if (!apiUrl || !modelName) {
                    throw new Error('请填写完整的本地API信息');
                }

                this.disabled = true;
                this.textContent = '测试中...';

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: modelName,
                        prompt: "测试连接",
                        stream: false
                    })
                });

                if (!response.ok) throw new Error('本地API连接失败');
                await response.json();
                alert('本地API连接成功！');
            } else {
                apiUrl = document.getElementById('remoteApiUrl').value.trim();
                apiKey = document.getElementById('apiKey').value.trim();
                modelName = elements.remoteModelSelect.value;

                if (!apiUrl || !apiKey || !modelName) {
                    throw new Error('请填写完整的远程API信息并选择模型');
                }

                this.disabled = true;
                this.textContent = '测试中...';

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
                                content: "测试连接"
                            }
                        ],
                        stream: false
                    })
                });

                if (!response.ok) throw new Error('远程API连接失败');
                await response.json();
                alert('远程API连接成功！');
            }
        } catch (error) {
            alert('连接测试失败: ' + error.message);
        } finally {
            this.disabled = false;
            this.textContent = '测试连接';
        }
    });

    // 添加消息历史存储相关函数
    async function saveChatHistory() {
        const messages = Array.from(elements.chatHistory.children).map(div => ({
            role: div.classList.contains('user') ? 'user' : 
                  div.classList.contains('assistant') ? 'assistant' : 'error',
            content: div.textContent
        }));
        await chrome.storage.local.set({ chatHistory: messages });
    }

    async function loadChatHistory() {
        const data = await chrome.storage.local.get('chatHistory');
        if (data.chatHistory) {
            elements.chatHistory.innerHTML = ''; // 清空当前历史
            data.chatHistory.forEach(msg => {
                appendMessage(msg.role, msg.content);
            });
        }
    }

    // 初始化
    await loadSettings();
    await loadState();
    await loadChatHistory();

    // 添加窗口焦点事件处理
    window.addEventListener('focus', async function() {
        await loadChatHistory();
    });
});