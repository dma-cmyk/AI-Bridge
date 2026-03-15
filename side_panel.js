const DEFAULT_AI_LIST = `Google Gemini,https://gemini.google.com/app
ChatGPT,https://chatgpt.com/
Claude,https://claude.ai/new
Grok,https://grok.com/
DeepSeek,https://chat.deepseek.com/
Qwen,https://chat.qwen.ai/
Venice AI,https://venice.ai/chat
WebLLM,https://chat.webllm.ai/
Microsoft Copilot,https://copilot.microsoft.com/
DuckDuckGo AI,https://duck.ai/chat
HuggingChat,https://huggingface.co/chat/`;

document.addEventListener('DOMContentLoaded', () => {
  const frame = document.getElementById('gemini-frame');
  const overlay = document.getElementById('overlay');
  const statusText = document.getElementById('status-text');
  const aiSelector = document.getElementById('ai-selector');
  const settingsBtn = document.getElementById('settings-btn');

  const THEMES = {
    'Google Gemini': { bg: '#e8f0fe', border: '#aecbfa', text: '#174ea6', selector: '#ffffff', accent: '#1a73e8' },
    'ChatGPT': { bg: '#e6f4ea', border: '#a8dab5', text: '#0d652d', selector: '#ffffff', accent: '#10a37f' },
    'Claude': { bg: '#fff4e5', border: '#ffcca3', text: '#663d00', selector: '#ffffff', accent: '#d27d2d' },
    'Grok': { bg: '#f1f3f4', border: '#dadce0', text: '#202124', selector: '#ffffff', accent: '#000000' },
    'DeepSeek': { bg: '#eef2ff', border: '#c7d2fe', text: '#312e81', selector: '#ffffff', accent: '#4f46e5' },
    'Microsoft Copilot': { bg: '#f0f4f9', border: '#d2e3fc', text: '#185abc', selector: '#ffffff', accent: '#00a4ef' },
    'DuckDuckGo AI': { bg: '#fff0f0', border: '#ffcfcf', text: '#600000', selector: '#ffffff', accent: '#de5833' },
    'default': { bg: '#ffffff', border: '#e0e0e0', text: '#3c4043', selector: '#f8f9fa', accent: '#1a73e8' }
  };

  let currentExtensionTheme = 'auto';

  function applyTheme(serviceName) {
    let theme = THEMES[serviceName] || THEMES['default'];
    
    // 拡張機能の設定またはOSの設定に基づいてダークモードを決定
    let effectiveDarkMode = false;
    if (currentExtensionTheme === 'auto') {
        effectiveDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else if (currentExtensionTheme === 'dark') {
        effectiveDarkMode = true;
    }

    if (effectiveDarkMode) {
      theme = {
        bg: '#1e1f20', 
        border: '#3c4043',
        text: '#e8eaed',
        selector: '#2d2e31',
        accent: theme.accent
      };
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }

    const root = document.documentElement;
    root.style.setProperty('--header-bg', theme.bg);
    root.style.setProperty('--header-border', theme.border);
    root.style.setProperty('--header-text', theme.text);
    root.style.setProperty('--selector-bg', theme.selector);
    root.style.setProperty('--accent-color', theme.accent);
  }

  function parseAiList(text) {
    return text.split('\n')
      .map(line => line.trim())
      .filter(line => line.includes(','))
      .map(line => {
        const [name, ...urlParts] = line.split(',');
        return { name: name.trim(), url: urlParts.join(',').trim() };
      });
  }

  function updateAiSelector(selectedService) {
    chrome.storage.sync.get({ customAiList: DEFAULT_AI_LIST }, (items) => {
      const aiList = parseAiList(items.customAiList);
      aiSelector.innerHTML = '';
      aiList.forEach(ai => {
        const option = document.createElement('option');
        option.value = ai.name;
        option.textContent = ai.name;
        aiSelector.appendChild(option);
      });
      if (selectedService) {
        aiSelector.value = selectedService;
      }
    });
  }

  function loadAi(service) {
    applyTheme(service);
    chrome.storage.sync.get({ customAiList: DEFAULT_AI_LIST }, (items) => {
      const aiList = parseAiList(items.customAiList);
      const selectedAi = aiList.find(ai => ai.name === service) || aiList[0];
      const url = selectedAi ? selectedAi.url : 'https://gemini.google.com/app';

      if (frame.src !== url) {
        frame.classList.remove('loaded');
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
        statusText.textContent = "AIを準備中...";
        frame.src = url;
        
        // セレクターの表示も同期
        if (selectedAi) {
          aiSelector.value = selectedAi.name;
        }
      }
    });
  }

  // Load selected AI and initialize selector on startup
  chrome.storage.sync.get({ aiService: 'Google Gemini', extensionTheme: 'auto' }, (items) => {
    currentExtensionTheme = items.extensionTheme;
    updateAiSelector(items.aiService);
    loadAi(items.aiService);
  });

  // Selector change event
  aiSelector.addEventListener('change', () => {
    const selectedService = aiSelector.value;
    chrome.storage.sync.set({ aiService: selectedService }, () => {
      loadAi(selectedService);
    });
  });

  // Settings button event
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // iframe内のロードが完了したらUIを表示
  frame.addEventListener('load', () => {
    if (!frame.src || frame.src === 'about:blank') return;
    frame.classList.add('loaded');
    statusText.textContent = "待機中... ページを送信してください";
    
    // すぐにオーバーレイを消さず、少し待って非表示にする
    setTimeout(() => {
       overlay.style.opacity = '0';
       setTimeout(() => overlay.style.display = 'none', 300);
    }, 1000);
  });

  // バックグラウンドからの状態更新を受信
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SETTINGS_UPDATED') {
      if (message.extensionTheme) {
        currentExtensionTheme = message.extensionTheme;
      }
      updateAiSelector(message.aiService);
      loadAi(message.aiService);
      sendResponse({ status: 'ok' });
    }

    if (message.action === 'PING_SIDE_PANEL') {
      sendResponse({ status: 'ready' });
    }
    
    if (message.action === 'SHOW_LOADING') {
      overlay.style.display = 'flex';
      overlay.style.opacity = '1';
      statusText.textContent = "ページ情報を抽出中...";
      sendResponse({ status: 'ok' });
    }

    if (message.action === 'SHOW_INJECTING') {
      overlay.style.display = 'flex';
      overlay.style.opacity = '1';
      statusText.textContent = "コンテキストを入力中...";
      
      // 数秒後にフェードアウト
      setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.style.display = 'none', 300);
      }, 2000);
      sendResponse({ status: 'ok' });
    }
    return true; 
  });
});
