let analysisInProgress = false;
let currentState = {
  currentTab: 'analysis',
  analysisState: null,
  chatHistory: '',
  analysisResults: {
    routes: [],
    vulnerabilities: []
  }
};

// 添加连接管理
let connections = {};

// 添加已分析文件的跟踪
let analyzedFiles = new Set();

chrome.runtime.onConnect.addListener(function(port) {
    if (port.name !== "devtools-panel") {
        return;
    }

    // 添加新连接
    port.onMessage.addListener(function(message) {
        if (message.action === 'init') {
            connections[message.tabId] = port;
            port.onDisconnect.addListener(function() {
                delete connections[message.tabId];
            });
        }
    });
});

// 修改消息发送函数
function sendToDevTools(tabId, message) {
    if (connections[tabId]) {
        connections[tabId].postMessage(message);
    }
}

// 保持状态的函数
function saveState() {
  chrome.storage.local.set({ persistentState: currentState });
}

// 初始化时加载状态
chrome.storage.local.get('persistentState', (data) => {
  if (data.persistentState) {
    currentState = data.persistentState;
  }
});

// 重置分析状态
function resetAnalysis() {
    analysisInProgress = false;
    analyzedFiles.clear();
    currentState.analysisState = null;
    currentState.analysisResults = {
        routes: [],
        vulnerabilities: []
    };
    saveState();
}

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('收到消息:', request);
    
    if (request.action === 'getState') {
        sendResponse(currentState);
    }
    else if (request.action === 'setState') {
        currentState = { ...currentState, ...request.state };
        saveState();
        sendResponse({ success: true });
    }
    else if (request.action === 'startAnalysis') {
        console.log('开始分析被触发, tabId:', request.tabId);
        // 确保重置之前的状态
        resetAnalysis();
        analysisInProgress = true;
        
        // 立即发送响应
        sendResponse({ success: true });
        
        // 使用传入的 tabId 启动分析
        startJSAnalysis(request.tabId).catch(error => {
            console.error('分析过程出错:', error);
        });
        
        return true;
    }
    else if (request.action === 'stopAnalysis') {
        console.log('停止分析被触发');
        analysisInProgress = false;
        resetAnalysis();
        sendResponse({ success: true });
        return true;
    }
    else if (request.action === 'clearResults') {
        resetAnalysis();
        sendResponse({ success: true });
    }
    
    // 返回 true 表示会异步发送响应
    return true;
});

async function startJSAnalysis(tabId) {
    console.log('开始分析函数被调用，状态:', analysisInProgress);
    
    if (!analysisInProgress) {
        console.log('分析未开始，退出函数');
        return;
    }

    try {
        // 使用传入的 tabId
        if (!tabId) {
            const tabs = await chrome.tabs.query({active: true, currentWindow: true});
            console.log('获取到活动标签页:', tabs);
            
            if (!tabs || !tabs[0]) {
                console.error('没有找到活动标签页');
                return;
            }
            tabId = tabs[0].id;
        }

        console.log('执行脚本获取JS文件');
        const scripts = await chrome.scripting.executeScript({
            target: {tabId: tabId},
            function: getAllScripts,
        });

        // 使用Set去重
        const scriptFiles = [...new Set(scripts[0].result)];
        console.log('找到的总JS文件数量:', scriptFiles.length);
        const totalFiles = scriptFiles.length;

        if (totalFiles === 0) {
            console.log('没有找到JS文件');
            return;
        }
        
        let allRoutes = new Set();
        let allVulnerabilities = new Set();

        // 获取设置
        const data = await chrome.storage.local.get('settings');
        const settings = data.settings;

        let completedFiles = 0;

        for (let i = 0; i < scriptFiles.length; i++) {
            if (!analysisInProgress) {
                console.log('分析被中止');
                break;
            }

            const script = scriptFiles[i];
            console.log(`开始处理文件 ${i + 1}/${totalFiles}: ${script}`);
            
            // 检查文件是否已经分析过
            const fileKey = typeof script === 'string' ? 
                (script.startsWith('http') ? new URL(script).href : script) : 
                script;
                
            if (analyzedFiles.has(fileKey)) {
                console.log(`跳过已分析的文件: ${fileKey}`);
                continue;
            }

            let scriptContent = script;
            let retryCount = 0;
            const maxRetries = 3;
            let success = false;

            // 获取文件内容
            while (retryCount < maxRetries && !success && analysisInProgress) {
                try {
                    if (typeof script === 'string' && (script.startsWith('http') || script.startsWith('//'))) {
                        const content = await fetchJsContent(script);
                        if (content && content.length > 0) {
                            scriptContent = content;
                            success = true;
                        } else {
                            throw new Error('Failed to fetch content');
                        }
                    } else {
                        scriptContent = script;
                        success = true;
                    }
                } catch (error) {
                    retryCount++;
                    console.log(`获取文件失败，第 ${retryCount} 次重试...`);
                    if (retryCount === maxRetries) {
                        console.error(`无法获取文件 ${script} 的内容，跳过此文件`);
                        continue;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }

            const fileName = typeof script === 'string' ? 
                (script.startsWith('http') ? new URL(script).pathname.split('/').pop() : '内联脚本') : 
                '内联脚本';

            completedFiles++;
            const progress = Math.round((completedFiles / totalFiles) * 100);
            
            // 更新进度
            sendToDevTools(tabId, {
                action: 'updateProgress',
                progress: progress,
                currentFile: fileName,
                totalFiles: totalFiles,
                currentFileIndex: completedFiles
            });

            // AI分析部分
            if (analysisInProgress) {
                try {
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
                        throw new Error(`API请求失败: ${response.status}`);
                    }

                    const result = await response.json();
                    console.log('AI分析结果:', result);
                    
                    try {
                        // 从API响应中提取内容
                        const analysisResult = JSON.parse(result.choices[0].message.content);
                        
                        if (analysisResult.routes) {
                            analysisResult.routes.forEach(route => allRoutes.add(route));
                        }
                        if (analysisResult.vulnerabilities) {
                            analysisResult.vulnerabilities.forEach(vuln => allVulnerabilities.add(vuln));
                        }

                        // 标记文件为已分析
                        analyzedFiles.add(fileKey);
                        
                        // 更新结果
                        currentState.analysisResults = {
                            routes: Array.from(allRoutes),
                            vulnerabilities: Array.from(allVulnerabilities)
                        };
                        
                        sendToDevTools(tabId, {
                            action: 'updateResults',
                            results: currentState.analysisResults
                        });
                        
                        saveState();
                    } catch (error) {
                        console.error('解析AI响应时出错:', error);
                    }
                } catch (error) {
                    console.error(`分析文件失败:`, error);
                }
            }

            // 添加延迟避免请求过快
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (analysisInProgress) {
            console.log('分析完成');
            sendToDevTools(tabId, { 
                action: 'analysisComplete',
                results: currentState.analysisResults
            });
        }
    } catch (error) {
        console.error('Analysis error:', error);
        // 使用传入的 tabId 发送错误
        sendToDevTools(tabId, {
            action: 'analysisError',
            error: error.message
        });
    } finally {
        console.log('分析结束，重置状态');
        resetAnalysis();
    }
}

// 添加超时控制的fetch函数
async function fetchWithTimeout(url, options, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// 添加超时控制的JS文件获取函数
async function fetchJsContentWithTimeout(url, timeout = 10000) {
    try {
        const response = await fetchWithTimeout(url, {}, timeout);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.text();
    } catch (error) {
        console.error(`获取JS文件失败: ${url}`, error);
        return null;
    }
}

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

function getAllScripts() {
    const scripts = new Set();

    // 1. 获取所有script标签的src
    document.querySelectorAll('script').forEach(script => {
        if (script.src) {
            scripts.add(script.src);
        } else if (script.textContent.trim()) {
            scripts.add(script.textContent);
        }
    });

    // 2. 获取所有link标签中的js文件
    document.querySelectorAll('link').forEach(link => {
        if (link.href && link.href.endsWith('.js')) {
            scripts.add(link.href);
        }
    });

    // 3. 查找页面中所有可能的js引用
    const htmlContent = document.documentElement.innerHTML;
    const jsPattern = /(?:src|href)=["'](.*?\.js)["']/g;
    let match;
    while ((match = jsPattern.exec(htmlContent)) !== null) {
        const jsUrl = new URL(match[1], window.location.href).href;
        scripts.add(jsUrl);
    }

    // 4. 检查动态加载的js文件
    const allElements = document.getElementsByTagName('*');
    for (const element of allElements) {
        const computedStyle = window.getComputedStyle(element);
        const backgroundImage = computedStyle.getPropertyValue('background-image');
        if (backgroundImage.includes('.js')) {
            const jsUrl = backgroundImage.replace(/^url\(['"](.+)['"]\)$/, '$1');
            scripts.add(jsUrl);
        }
    }

    // 5. 检查sourceMappingURL注释
    document.querySelectorAll('script').forEach(script => {
        if (script.textContent) {
            const sourceMapPattern = /\/\/[#@]\s*sourceMappingURL=(.+?\.js)/g;
            let sourceMapMatch;
            while ((sourceMapMatch = sourceMapPattern.exec(script.textContent)) !== null) {
                const jsUrl = new URL(sourceMapMatch[1], window.location.href).href;
                scripts.add(jsUrl);
            }
        }
    });

    // 6. 尝试获取webpack或其他打包工具生成的chunk文件
    const chunkPattern = /(?:chunk|bundle|vendor|app)[^"']*\.js/g;
    let chunkMatch;
    while ((chunkMatch = chunkPattern.exec(htmlContent)) !== null) {
        const jsUrl = new URL(chunkMatch[0], window.location.href).href;
        scripts.add(jsUrl);
    }

    // 7. 转换为数组并过滤掉无效的URL
    const validScripts = Array.from(scripts).filter(script => {
        if (typeof script === 'string') {
            if (script.startsWith('http') || script.startsWith('//')) {
                try {
                    new URL(script);
                    return true;
                } catch {
                    return false;
                }
            }
            return true; // 保留内联脚本
        }
        return false;
    });

    console.log('找到的JS文件:', validScripts);
    return validScripts;
}

// 修改获取JS文件内容的函数
async function fetchJsContent(url) {
    try {
        // 1. 首先尝试在页面上下文中获取内容
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        const result = await chrome.scripting.executeScript({
            target: {tabId: tabs[0].id},
            func: async (scriptUrl) => {
                try {
                    // 使用fetch，它会继承页面的证书信任状态
                    const response = await fetch(scriptUrl);
                    if (response.ok) {
                        return await response.text();
                    }
                    throw new Error('Fetch failed');
                } catch (e) {
                    // 如果fetch失败，尝试XMLHttpRequest
                    return new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.onload = () => {
                            if (xhr.status >= 200 && xhr.status < 300) {
                                resolve(xhr.responseText);
                            } else {
                                reject(new Error(`HTTP ${xhr.status}`));
                            }
                        };
                        xhr.onerror = () => reject(new Error('XHR Error'));
                        xhr.open('GET', scriptUrl);
                        xhr.send();
                    });
                }
            },
            args: [url]
        });

        if (result && result[0] && result[0].result) {
            return result[0].result;
        }

        // 2. 如果页面上下文获取失败，尝试从script标签获取
        const scriptResult = await chrome.scripting.executeScript({
            target: {tabId: tabs[0].id},
            func: (scriptUrl) => {
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    if (script.src === scriptUrl && script.textContent) {
                        return script.textContent;
                    }
                }
                // 尝试获取内联script的内容
                for (const script of scripts) {
                    if (!script.src && script.textContent.includes(scriptUrl)) {
                        return script.textContent;
                    }
                }
                return null;
            },
            args: [url]
        });

        if (scriptResult && scriptResult[0] && scriptResult[0].result) {
            return scriptResult[0].result;
        }

        // 3. 尝试通过background直接获取
        try {
            const response = await fetch(url, {
                method: 'GET',
                mode: 'no-cors'
            });
            if (response.ok) {
                return await response.text();
            }
        } catch (e) {
            console.log('Background fetch failed:', e);
        }

        // 4. 尝试HTTP替代HTTPS
        if (url.startsWith('https://')) {
            try {
                const httpUrl = url.replace('https://', 'http://');
                const response = await fetch(httpUrl, {
                    method: 'GET',
                    mode: 'no-cors'
                });
                if (response.ok) {
                    return await response.text();
                }
            } catch (e) {
                console.log('HTTP fallback failed:', e);
            }
        }

        throw new Error('所有获取方法都失败');
    } catch (error) {
        console.error(`获取JS文件失败: ${url}`, error);
        return '';
    }
} 