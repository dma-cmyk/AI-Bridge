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
  const aiServiceSelect = document.getElementById('ai-service');
  const customAiListTextarea = document.getElementById('custom-ai-list');
  const resetAiBtn = document.getElementById('reset-ai-btn');
  const extensionThemeRadios = document.getElementsByName('extension-theme');
  const captureModeRadios = document.getElementsByName('capture-mode');
  const textFormatRadios = document.getElementsByName('text-format');
  const saveBtn = document.getElementById('save-btn');
  const statusSpan = document.getElementById('status');

  function applyExtensionTheme(theme) {
    document.body.classList.remove('light-mode', 'dark-mode');
    if (theme === 'light') {
        document.body.classList.add('light-mode');
    } else if (theme === 'dark') {
        document.body.classList.add('dark-mode');
    }
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

  function populateAiSelect(aiList, selectedValue) {
    const currentSelection = selectedValue || aiServiceSelect.value;
    aiServiceSelect.innerHTML = '';
    aiList.forEach(ai => {
      const option = document.createElement('option');
      option.value = ai.name;
      option.textContent = ai.name;
      aiServiceSelect.appendChild(option);
    });
    if (currentSelection) {
      aiServiceSelect.value = currentSelection;
    }
  }

  // Load existing settings
  chrome.storage.sync.get({
    aiService: 'Google Gemini',
    extensionTheme: 'auto',
    captureMode: 'visible',
    textFormat: 'html',
    customAiList: DEFAULT_AI_LIST
  }, (items) => {
    customAiListTextarea.value = items.customAiList;
    const aiList = parseAiList(items.customAiList);
    populateAiSelect(aiList, items.aiService);

    applyExtensionTheme(items.extensionTheme);
    for (const radio of extensionThemeRadios) {
      if (radio.value === items.extensionTheme) {
        radio.checked = true;
        radio.closest('.radio-card').classList.add('active');
      }
    }

    for (const radio of captureModeRadios) {
      if (radio.value === items.captureMode) {
        radio.checked = true;
        radio.closest('.radio-card').classList.add('active');
      }
    }
    for (const radio of textFormatRadios) {
      if (radio.value === items.textFormat) {
        radio.checked = true;
        radio.closest('.radio-card').classList.add('active');
      }
    }
  });

  // Auto-save logic for select
  aiServiceSelect.addEventListener('change', () => {
    saveSettings(false);
  });

  // Radio card selection logic
  const allRadioCards = document.querySelectorAll('.radio-card');
  allRadioCards.forEach(card => {
    card.addEventListener('click', () => {
      const input = card.querySelector('input');
      const siblings = card.parentElement.querySelectorAll('.radio-card');
      
      if (input.checked && card.classList.contains('active')) return;

      siblings.forEach(s => s.classList.remove('active'));
      card.classList.add('active');
      input.checked = true;

      // テーマ選択の場合は即座に反映してプレビュー
      if (input.name === 'extension-theme') {
          applyExtensionTheme(input.value);
      }
      
      saveSettings(false);
    });
  });

  // Reset AI list
  resetAiBtn.addEventListener('click', () => {
    if (confirm('AIリストをデフォルトの状態に戻しますか？')) {
      customAiListTextarea.value = DEFAULT_AI_LIST;
      saveSettings(true);
    }
  });

  // Manual save for AI list
  const saveAiListBtn = document.getElementById('save-ai-list-btn');
  saveAiListBtn.addEventListener('click', () => {
    saveSettings(true);
  });

  function saveSettings(isAiListUpdate = false) {
    let selectedTheme = 'auto';
    for (const radio of extensionThemeRadios) {
      if (radio.checked) {
        selectedTheme = radio.value;
        break;
      }
    }

    let selectedMode = 'visible';
    for (const radio of captureModeRadios) {
      if (radio.checked) {
        selectedMode = radio.value;
        break;
      }
    }
    
    let selectedFormat = 'html';
    for (const radio of textFormatRadios) {
      if (radio.checked) {
        selectedFormat = radio.value;
        break;
      }
    }

    const aiListText = customAiListTextarea.value;
    const aiService = aiServiceSelect.value;

    chrome.storage.sync.set({
      aiService: aiService,
      extensionTheme: selectedTheme,
      captureMode: selectedMode,
      textFormat: selectedFormat,
      customAiList: aiListText
    }, () => {
      if (isAiListUpdate) {
        const aiList = parseAiList(aiListText);
        populateAiSelect(aiList, aiService);
      }
      
      applyExtensionTheme(selectedTheme);

      // Show saved status
      statusSpan.classList.add('show');
      setTimeout(() => {
        statusSpan.classList.remove('show');
      }, 1500);
      
      // Request side panel reload for changes to take effect immediately
      chrome.runtime.sendMessage({ action: 'SETTINGS_UPDATED', aiService, extensionTheme: selectedTheme });
    });
  }

  // --- プライバシーと権限 ---
  const openChromeSettingsBtn = document.getElementById('open-chrome-settings-btn');

  openChromeSettingsBtn.addEventListener('click', () => {
    const url = `chrome://settings/content/siteDetails?site=${encodeURIComponent('chrome-extension://' + chrome.runtime.id)}`;
    chrome.tabs.create({ url: url });
  });

  // ハッシュ（#privacy）がある場合は該当セクションへジャンプ
  if (window.location.hash === '#privacy') {
    const privacySection = document.getElementById('privacy');
    if (privacySection) {
      setTimeout(() => {
        privacySection.scrollIntoView({ behavior: 'smooth' });
        // 視覚的に目立たせる
        privacySection.style.boxShadow = '0 0 0 2px var(--primary)';
        setTimeout(() => { privacySection.style.boxShadow = ''; }, 2000);
      }, 500);
    }
  }
});
