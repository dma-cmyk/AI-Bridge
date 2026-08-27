const AI_FRAME_DOMAINS = [
  'gemini.google.com',
  'chatgpt.com',
  'claude.ai',
  'grok.com',
  'chat.deepseek.com',
  'chat.qwen.ai',
  'venice.ai',
  'chat.webllm.ai',
  'copilot.microsoft.com',
  'duck.ai',
  'duckduckgo.com',
  'huggingface.co',
  'tongyi.aliyun.com'
];

const AI_FRAME_RULE_ID = 1;
const CAPTURE_INTERVAL_MS = 550;

function createAiFrameRule(extensionId) {
  return {
    id: AI_FRAME_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'X-Frame-Options', operation: 'remove' },
        { header: 'Content-Security-Policy', operation: 'remove' },
        { header: 'Cross-Origin-Opener-Policy', operation: 'remove' },
        { header: 'Cross-Origin-Embedder-Policy', operation: 'remove' },
        { header: 'Cross-Origin-Resource-Policy', operation: 'remove' },
        { header: 'Permissions-Policy', operation: 'remove' }
      ]
    },
    condition: {
      initiatorDomains: [extensionId],
      requestDomains: AI_FRAME_DOMAINS,
      resourceTypes: ['sub_frame']
    }
  };
}

function configureAiFrameRule() {
  return chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [AI_FRAME_RULE_ID],
    addRules: [createAiFrameRule(chrome.runtime.id)]
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'send-to-gemini',
    title: 'AIにこのページ情報をコピーして開く',
    contexts: ['page', 'selection', 'action']
  });

  configureAiFrameRule().catch(error => {
    console.error('Failed to configure AI frame rule:', error);
  });
});

// アイコンクリック時の挙動 (setPanelBehaviorを外したためここで発火する)
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  // アイコンクリック（左クリック）時はサイドパネルを開くだけ
});

// 右クリック時の挙動
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'send-to-gemini') {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    void performExtraction(tab, info.selectionText);
  }
});

async function performExtraction(tab, selectionText) {
  try {
    chrome.runtime.sendMessage({ action: 'SHOW_LOADING' }).catch(() => {});

    const { captureMode, textFormat } = await chrome.storage.sync.get({ captureMode: 'visible', textFormat: 'html' });

    let dataUrl = null;

    if (captureMode === 'fullpage') {
      const markerName = `data-ai-bridge-${crypto.randomUUID()}`;
      let setup = null;
      let captureFailed = false;

      try {
        const [{result}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (marker) => {
             const html = document.documentElement;
             const body = document.body;
             const opacityMarker = `${marker}-opacity`;
             const width = window.innerWidth;
             const height = Math.max(html.scrollHeight, body.scrollHeight);
             const originalOverflow = html.style.overflow;
             const scrollX = window.scrollX;
             const scrollY = window.scrollY;

             try {
               html.setAttribute(marker, 'active');
               html.style.overflow = 'hidden';

               // Hide sticky/fixed elements temporarily to avoid duplicates.
               const treeWalker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
               let currentNode = treeWalker.currentNode;
               while(currentNode) {
                  const pos = window.getComputedStyle(currentNode).position;
                  if (pos === 'fixed' || pos === 'sticky') {
                     currentNode.setAttribute(opacityMarker, currentNode.style.opacity);
                     currentNode.style.opacity = '0';
                  }
                  currentNode = treeWalker.nextNode();
                }

               return {
                 width, height,
                 windowHeight: window.innerHeight,
                 dpr: window.devicePixelRatio,
                 originalOverflow,
                 scrollX,
                 scrollY
               };
             } catch (error) {
               document.querySelectorAll(`[${opacityMarker}]`).forEach(element => {
                 element.style.opacity = element.getAttribute(opacityMarker) || '';
                 element.removeAttribute(opacityMarker);
               });
               html.style.overflow = originalOverflow;
               html.removeAttribute(marker);
               throw error;
             }
          },
          args: [markerName]
        });

        setup = result;
        const { width, height, windowHeight, dpr } = setup;
        const canvas = new OffscreenCanvas(width * dpr, height * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create a 2D canvas context');

        let y = 0;
        while (y < height) {
          const [{result: actualY}] = await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            func: (scrollY) => {
              window.scrollTo(0, scrollY);
              return window.scrollY;
            },
            args: [y]
          });

          await new Promise(resolve => setTimeout(resolve, CAPTURE_INTERVAL_MS));

          const chunkDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'});
          const res = await fetch(chunkDataUrl);
          const blob = await res.blob();
          const bitmap = await createImageBitmap(blob);
          try {
            ctx.drawImage(bitmap, 0, actualY * dpr);
          } finally {
            bitmap.close();
          }

          y += windowHeight;
          if (actualY + windowHeight >= height) break;
        }

        const blob = await canvas.convertToBlob({type: 'image/png'});
        const reader = new FileReader();
        dataUrl = await new Promise(resolve => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });

      } catch (err) {
        console.warn('Fullpage capture failed, falling back to visible', err);
        captureFailed = true;
      } finally {
        if (setup) {
          await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            func: (marker, originalOverflow, scrollX, scrollY) => {
              const html = document.documentElement;
              if (!html.hasAttribute(marker)) return;

              const opacityMarker = `${marker}-opacity`;
              document.querySelectorAll(`[${opacityMarker}]`).forEach(element => {
                element.style.opacity = element.getAttribute(opacityMarker) || '';
                element.removeAttribute(opacityMarker);
              });
              html.style.overflow = originalOverflow;
              html.removeAttribute(marker);
              window.scrollTo(scrollX, scrollY);
            },
            args: [markerName, setup.originalOverflow, setup.scrollX, setup.scrollY]
          }).catch(error => {
            console.warn('Failed to restore the page after capture:', error);
          });
        }
      }

      if (captureFailed) {
        await new Promise(resolve => setTimeout(resolve, CAPTURE_INTERVAL_MS));
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }).catch(() => null);
      }
    } else {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }).catch(err => {
        console.warn('Screenshot capture failed:', err);
        return null;
      });
    }

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (format) => {
        const title = document.title;
        const url = window.location.href;
        const selection = window.getSelection().toString();

        if (format === 'markdown') {
          // 簡易的なMarkdown化処理（タグ除去と構造の維持）
          const body = document.body.cloneNode(true);

          // 不要な要素の削除
          const scripts = body.querySelectorAll('script, style, nav, footer, iframe, noscript');
          scripts.forEach(s => s.remove());

          let text = "";
          const walk = (node) => {
            if (node.nodeType === 3) { // Text node
              text += node.nodeValue.replace(/\s+/g, ' ');
            } else if (node.nodeType === 1) { // Element node
              const tag = node.tagName.toLowerCase();
              if (tag === 'h1' || tag === 'h2' || tag === 'h3') text += "\n\n# " ;
              if (tag === 'p' || tag === 'div' || tag === 'br') text += "\n";
              if (tag === 'li') text += "\n* ";
              
              for (let i = 0; i < node.childNodes.length; i++) {
                walk(node.childNodes[i]);
              }
              
              if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'p' || tag === 'div') text += "\n";
            }
          };
          walk(body);
          // 余分な空行を整理
          const markdown = text.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
          
          return { title, url, html: markdown, selection };
        } else if (format === 'main') {
          // 本文抽出モード (Smart Extraction)
          const findMainContent = () => {
             // 1. 確実そうなタグを探す
             const mainTags = document.querySelectorAll('article, main, [role="main"]');
             if (mainTags.length > 0) {
                // 複数の場合は最も文字数が多いものを返す
                let longest = mainTags[0];
                mainTags.forEach(t => { if(t.innerText.length > longest.innerText.length) longest = t; });
                return longest.cloneNode(true);
             }
             
             // 2. なければ、巨大な div/section から推定
             const containers = document.querySelectorAll('div, section');
             let bestNode = document.body;
             let maxScore = 0;
             containers.forEach(node => {
                const textLen = node.innerText.trim().length;
                if (textLen > maxScore) {
                   maxScore = textLen;
                   bestNode = node;
                }
             });
             return bestNode.cloneNode(true);
          };

          const content = findMainContent();
          // 不要な要素を徹底除去
          const junk = content.querySelectorAll('script, style, nav, footer, header, aside, iframe, noscript, .ads, .comment, .sidebar');
          junk.forEach(j => j.remove());
          
          const rawText = content.innerText || content.textContent;
          const compressed = rawText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
          
          return { title, url, html: compressed, selection };
        } else {
          // 従来のHTMLソース
          return {
            title, url,
            html: document.documentElement.outerHTML.substring(0, 50000),
            selection
          };
        }
      },
      args: [textFormat]
    }).catch(err => {
      console.warn('Script execution failed:', err);
      return null;
    });

    let payload = null;
    if (injectionResults && injectionResults[0] && injectionResults[0].result) {
      payload = injectionResults[0].result;
      if (selectionText) payload.selection = selectionText;
    } else {
       payload = {
        title: tab.title || 'Unknown Title',
        url: tab.url || 'Unknown URL',
        html: '【エラー】ブラウザのセキュリティ制限により、拡張機能から情報を抽出できませんでした。',
        selection: selectionText || ''
      };
    }
        
    chrome.runtime.sendMessage({ action: 'SHOW_INJECTING' }).catch(() => {});

    // アクティブタブのスクリプト環境を借りてクリップボードに書き込む
    const [{ result: clipboardResult }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (imgDataUrl, extractedData, format) => {
        try {
          if (format === 'image') {
            if (!imgDataUrl) throw new Error('Image data is missing');

            const response = await fetch(imgDataUrl);
            const blob = await response.blob();
            await navigator.clipboard.write([
              new ClipboardItem({ [blob.type]: blob })
            ]);
            return { ok: true };
          }

          let markdownText = `以下のページについて質問/指示があります。\n\n`;
          markdownText += `**Title:** ${extractedData.title}\n**URL:** ${extractedData.url}\n\n`;

          if (extractedData.selection) {
             markdownText += `**選択されたテキスト:**\n\`\`\`\n${extractedData.selection}\n\`\`\`\n\n`;
          } else {
             let label = 'HTMLソースコード';
             let codeLang = 'html';
             if (format === 'markdown') {
               label = '抽出されたテキスト (Markdown形式)';
               codeLang = '';
             } else if (format === 'main') {
               label = '抽出されたテキスト (本文のみ抽出)';
               codeLang = '';
             }
             markdownText += `**${label}:**\n\`\`\`${codeLang}\n${extractedData.html}\n\`\`\`\n`;
          }

          const clipboardItems = {
            'text/plain': new Blob([markdownText], { type: 'text/plain' })
          };

          if (imgDataUrl) {
            const response = await fetch(imgDataUrl);
            const blob = await response.blob();
            clipboardItems[blob.type] = blob;
          }

          await navigator.clipboard.write([new ClipboardItem(clipboardItems)]);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
      args: [dataUrl, payload, textFormat]
    });

    if (!clipboardResult?.ok) {
      throw new Error(clipboardResult?.error || 'Clipboard write failed');
    }

    console.log('Extraction and clipboard copy complete.');
  } catch (error) {
    console.error('Extraction handling error:', error);
    chrome.runtime.sendMessage({ action: 'SHOW_ERROR' }).catch(() => {});
  }
}
