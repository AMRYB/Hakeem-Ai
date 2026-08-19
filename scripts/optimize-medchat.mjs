import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const adapterPath = resolve(process.cwd(), "public/medchat/adapter.js");
let source = readFileSync(adapterPath, "utf8");

const optimizedMarker = "const translationObserver = new MutationObserver";

if (!source.includes(optimizedMarker)) {
  const startMarker = "  const uiObserver = new MutationObserver((mutations) => {";
  const endMarker = "  translateTree(document.body);\n  enhanceRenderedMessages();";

  const start = source.indexOf(startMarker);
  const endStart = source.indexOf(endMarker, start);

  if (start === -1 || endStart === -1) {
    throw new Error("Could not find the MedChat observer block to optimize.");
  }

  const end = endStart + endMarker.length;

  const optimizedBlock = `  let translationFrame = 0;
  const pendingTranslationRoots = new Set();

  function scheduleTranslations() {
    if (translationFrame) return;
    translationFrame = requestAnimationFrame(() => {
      translationFrame = 0;
      const roots = Array.from(pendingTranslationRoots);
      pendingTranslationRoots.clear();
      roots.forEach((root) => translateTree(root));
    });
  }

  const translationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const next = translateValue(node.nodeValue || "");
          if (next !== node.nodeValue) node.nodeValue = next;
          return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.tagName?.toLowerCase();
        if (tag === "svg" || tag === "path") return;
        pendingTranslationRoots.add(node);
      });
    }
    if (pendingTranslationRoots.size) scheduleTranslations();
  });

  translationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  let messageEnhanceFrame = 0;
  const messageObserver = new MutationObserver(() => {
    if (messageEnhanceFrame) return;
    messageEnhanceFrame = requestAnimationFrame(() => {
      messageEnhanceFrame = 0;
      enhanceRenderedMessages();
    });
  });

  messageObserver.observe(els.messages, {
    childList: true,
  });

  translateTree(document.body);
  enhanceRenderedMessages();`;

  source = `${source.slice(0, start)}${optimizedBlock}${source.slice(end)}`;
  writeFileSync(adapterPath, source, "utf8");
  console.log("Optimized MedChat DOM observers.");
} else {
  console.log("MedChat DOM observers are already optimized.");
}
