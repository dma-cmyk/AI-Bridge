chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'send-to-gemini',
    title: 'AIにこのページ情報をコピーして開く',
    contexts: ['page', 'selection', 'action']
  });
});

// アイコンクリック時の挙動 (setPanelBehaviorを外したためここで発火する)
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  performExtraction(tab, '');
});

// 右クリック時の挙動
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'send-to-gemini') {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    performExtraction(tab, info.selectionText);
  }
});

async function performExtraction(tab, selectionText) {
  try {
    const { captureMode, textFormat } = await chrome.storage.sync.get({ captureMode: 'visible', textFormat: 'html' });

    let dataUrl = null;

    if (captureMode === 'fullpage') {
      try {
        const [{result: setup}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
             const html = document.documentElement;
             const body = document.body;
             const width = Math.max(html.scrollWidth, body.scrollWidth);
             const height = Math.max(html.scrollHeight, body.scrollHeight);
             
             document.documentElement.style.overflow = 'hidden';
             
             // Hide sticky/fixed elements temporarily to avoid duplicates
             const hiddenElements = [];
             const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
             let currentNode = treeWalker.currentNode;
             while(currentNode) {
                const pos = window.getComputedStyle(currentNode).position;
                if (pos === 'fixed' || pos === 'sticky') {
                   hiddenElements.push(currentNode);
                   currentNode.dataset.gbOriginalOpacity = currentNode.style.opacity;
                   currentNode.style.opacity = '0';
                }
                currentNode = treeWalker.nextNode();
             }

             return {
               width, height,
               windowHeight: window.innerHeight,
               dpr: window.devicePixelRatio
             };
          }
        });

        const { width, height, windowHeight, dpr } = setup;
        const canvas = new OffscreenCanvas(width * dpr, height * dpr);
        const ctx = canvas.getContext('2d');

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

          await new Promise(r => setTimeout(r, 300));

          const chunkDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'}).catch(() => null);
          if (chunkDataUrl) {
            const res = await fetch(chunkDataUrl);
            const blob = await res.blob();
            const bitmap = await createImageBitmap(blob);
            // Draw image at the actual scroll position scaled by DPR
            // Use windowHeight * dpr for source block instead? createImageBitmap makes it full raw size.
            // We draw at destination y = actualY * dpr.
            ctx.drawImage(bitmap, 0, actualY * dpr);
          }

          y += windowHeight;
          if (actualY + windowHeight >= height) break;
        }

        // Restore
        await chrome.scripting.executeScript({
          target: {tabId: tab.id},
          func: () => {
             document.documentElement.style.overflow = '';
             window.scrollTo(0, 0);
             const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
             let currentNode = treeWalker.currentNode;
             while(currentNode) {
                if (currentNode.dataset.gbOriginalOpacity !== undefined) {
                   currentNode.style.opacity = currentNode.dataset.gbOriginalOpacity;
                   delete currentNode.dataset.gbOriginalOpacity;
                }
                currentNode = treeWalker.nextNode();
             }
          }
        });

        const blob = await canvas.convertToBlob({type: 'image/png'});
        const reader = new FileReader();
        dataUrl = await new Promise(resolve => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });

      } catch (err) {
        console.warn('Fullpage capture failed, falling back to visible', err);
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }).catch(() => null);
      }
    } else {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }).catch(err => {
        console.warn('Screenshot capture failed:', err);
        return null;
      });
    }

    const executePromise = chrome.scripting.executeScript({
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

    const [injectionResults] = await Promise.all([executePromise]);
    // Note: capture is already done sequentially before this if fullpage, but that's fine.

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
        
    // アクティブタブのスクリプト環境を借りてクリップボードに書き込む
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (imgDataUrl, extractedData, format) => {
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

        const clipboardItems = {};
        clipboardItems['text/plain'] = new Blob([markdownText], { type: 'text/plain' });

        if (imgDataUrl) {
          fetch(imgDataUrl)
            .then(res => res.blob())
            .then(blob => {
              clipboardItems[blob.type] = blob;
              // Web APIの ClipboardItem は複数タイプのデータを同時格納できる
              return navigator.clipboard.write([new ClipboardItem(clipboardItems)]);
            })
            .then(() => console.log('[AI-Bridge] Text and Image copied to clipboard'))
            .catch(e => console.warn('[AI-Bridge] Clipboard write failed (usually expected on blur)', e));
        } else {
          try {
            navigator.clipboard.write([new ClipboardItem(clipboardItems)])
              .then(() => console.log('[AI-Bridge] Text copied to clipboard (No image)'));
          } catch (err) {
            console.error('Clipboard write failed:', err);
          }
        }
      },
      args: [dataUrl, payload, textFormat]
    });

    console.log('Extraction and clipboard copy complete.');
  } catch (error) {
    console.error('Extraction handling error:', error);
  }
}
