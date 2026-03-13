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
  const captureModeRadios = document.getElementsByName('capture-mode');
  const textFormatRadios = document.getElementsByName('text-format');
  const saveBtn = document.getElementById('save-btn');
  const statusSpan = document.getElementById('status');

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
    captureMode: 'visible',
    textFormat: 'html',
    customAiList: DEFAULT_AI_LIST
  }, (items) => {
    customAiListTextarea.value = items.customAiList;
    const aiList = parseAiList(items.customAiList);
    populateAiSelect(aiList, items.aiService);

    for (const radio of captureModeRadios) {
      if (radio.value === items.captureMode) {
        radio.checked = true;
      }
    }
    for (const radio of textFormatRadios) {
      if (radio.value === items.textFormat) {
        radio.checked = true;
      }
    }
  });

  // Reset AI list
  resetAiBtn.addEventListener('click', () => {
    if (confirm('AIリストをデフォルトの状態に戻しますか？')) {
      customAiListTextarea.value = DEFAULT_AI_LIST;
      const aiList = parseAiList(DEFAULT_AI_LIST);
      populateAiSelect(aiList);
    }
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
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
      captureMode: selectedMode,
      textFormat: selectedFormat,
      customAiList: aiListText
    }, () => {
      // Refresh select box in case names changed
      const aiList = parseAiList(aiListText);
      populateAiSelect(aiList, aiService);

      // Show saved status
      statusSpan.classList.add('show');
      setTimeout(() => {
        statusSpan.classList.remove('show');
      }, 2000);
      
      // Request side panel reload for changes to take effect immediately
      chrome.runtime.sendMessage({ action: 'SETTINGS_UPDATED', aiService });
    });
  });
});
