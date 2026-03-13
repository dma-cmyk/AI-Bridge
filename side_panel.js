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

  function parseAiList(text) {
    return text.split('\n')
      .map(line => line.trim())
      .filter(line => line.includes(','))
      .map(line => {
        const [name, ...urlParts] = line.split(',');
        return { name: name.trim(), url: urlParts.join(',').trim() };
      });
  }

  function loadAi(service) {
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
      }
    });
  }

  // Load selected AI on startup
  chrome.storage.sync.get({ aiService: 'Google Gemini' }, (items) => {
    loadAi(items.aiService);
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
