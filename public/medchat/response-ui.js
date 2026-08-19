(() => {
  if (!document.querySelector('link[data-hakeem-response-css]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/medchat/response-ui.css";
    link.dataset.hakeemResponseCss = "true";
    document.head.appendChild(link);
  }

  function escapeText(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInline(value) {
    let text = escapeText(value);
    const code = [];
    text = text.replace(/`([^`]+)`/g, (_, content) => {
      const token = `@@CODE_${code.length}@@`;
      code.push(`<code>${content}</code>`);
      return token;
    });
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    text = text.replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, "$1<em>$2</em>");
    code.forEach((html, index) => {
      text = text.replace(`@@CODE_${index}@@`, html);
    });
    return text;
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").replace(/\r/g, "").split("\n");
    const out = [];
    let paragraph = [];
    let list = null;
    let code = false;
    let codeLines = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      out.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!list) return;
      out.push(`</${list}>`);
      list = null;
    };
    const flushAll = () => {
      flushParagraph();
      closeList();
    };

    lines.forEach((line) => {
      const trimmed = line.trim();

      if (/^```/.test(trimmed)) {
        flushAll();
        if (!code) {
          code = true;
          codeLines = [];
        } else {
          out.push(`<pre><code>${escapeText(codeLines.join("\n"))}</code></pre>`);
          code = false;
          codeLines = [];
        }
        return;
      }

      if (code) {
        codeLines.push(line);
        return;
      }

      if (!trimmed) {
        flushAll();
        return;
      }

      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushAll();
        const level = heading[1].length;
        out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        return;
      }

      if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
        flushAll();
        out.push("<hr>");
        return;
      }

      const bullet = trimmed.match(/^[-+*]\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        if (list !== "ul") {
          closeList();
          list = "ul";
          out.push("<ul>");
        }
        out.push(`<li>${renderInline(bullet[1])}</li>`);
        return;
      }

      const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (numbered) {
        flushParagraph();
        if (list !== "ol") {
          closeList();
          list = "ol";
          out.push("<ol>");
        }
        out.push(`<li>${renderInline(numbered[1])}</li>`);
        return;
      }

      if (/^>\s?/.test(trimmed)) {
        flushAll();
        out.push(`<blockquote>${renderInline(trimmed.replace(/^>\s?/, ""))}</blockquote>`);
        return;
      }

      closeList();
      paragraph.push(trimmed);
    });

    if (code) out.push(`<pre><code>${escapeText(codeLines.join("\n"))}</code></pre>`);
    flushAll();
    return out.join("");
  }

  function citationTitle(citation, index) {
    return citation?.source_title || citation?.source_type || `Source ${index + 1}`;
  }

  function stripEmbeddedSourceSection(markdown, citations) {
    const text = String(markdown || "");
    if (!Array.isArray(citations) || !citations.length) return text;
    const lines = text.replace(/\r/g, "").split("\n");
    const sourceHeading = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*sources?\s*:?[\s]*(?:\*\*|__)?$/i;
    const index = lines.findIndex((line) => sourceHeading.test(line.trim()));
    if (index === -1) return text;
    return lines.slice(0, index).join("\n").trimEnd();
  }

  function selectedEvidenceHtml(citation, index) {
    const details = [citation?.source_type, citation?.section, citation?.source_locator].filter(Boolean).join(" · ");
    return `
      <article class="evidence-card evidence-card--selected">
        <div class="evidence-card__top">
          <span class="evidence-index">${index + 1}</span>
          <div>
            <strong>${escapeText(citationTitle(citation, index))}</strong>
            <small>${escapeText(details)}</small>
          </div>
        </div>
        <p>${escapeText(citation?.snippet || "No snippet available.")}</p>
      </article>`;
  }

  function openSelectedEvidence(article, citation, index, total) {
    const evidenceButton = article.querySelector('[data-hakeem-action="evidence"]');
    if (!evidenceButton) return;
    evidenceButton.click();
    requestAnimationFrame(() => {
      const content = document.getElementById("evidenceContent");
      const title = document.getElementById("evidenceTitle");
      if (title) title.textContent = total > 1 ? `Source ${index + 1} of ${total}` : "Source";
      if (content) content.innerHTML = selectedEvidenceHtml(citation, index);
    });
  }

  function renderSourceCarousel(row, article, citations, requestedIndex = 0) {
    if (!citations.length) {
      row.remove();
      return;
    }

    const index = Math.max(0, Math.min(citations.length - 1, requestedIndex));
    row.dataset.sourceIndex = String(index);
    row.innerHTML = "";

    if (citations.length > 1) {
      const previous = document.createElement("button");
      previous.type = "button";
      previous.className = "hakeem-source-nav hakeem-source-nav--previous";
      previous.setAttribute("aria-label", "Previous source");
      previous.title = "Previous source";
      previous.textContent = "‹";
      previous.addEventListener("click", () => {
        const nextIndex = (index - 1 + citations.length) % citations.length;
        renderSourceCarousel(row, article, citations, nextIndex);
      });
      row.appendChild(previous);
    }

    const citation = citations[index];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hakeem-source-chip";
    button.innerHTML = `<span class="hakeem-source-index">${index + 1}</span><span class="hakeem-source-label">${escapeText(citationTitle(citation, index))}</span>`;
    button.title = citation?.snippet || citationTitle(citation, index);
    button.addEventListener("click", () => openSelectedEvidence(article, citation, index, citations.length));
    row.appendChild(button);

    if (citations.length > 1) {
      const counter = document.createElement("span");
      counter.className = "hakeem-source-counter";
      counter.textContent = `${index + 1}/${citations.length}`;
      row.appendChild(counter);

      const next = document.createElement("button");
      next.type = "button";
      next.className = "hakeem-source-nav hakeem-source-nav--next";
      next.setAttribute("aria-label", "Next source");
      next.title = "Next source";
      next.textContent = "›";
      next.addEventListener("click", () => {
        const nextIndex = (index + 1) % citations.length;
        renderSourceCarousel(row, article, citations, nextIndex);
      });
      row.appendChild(next);
    }
  }

  function enhanceResponses() {
    if (typeof currentChat !== "function" || typeof els === "undefined") return;
    const chat = currentChat();
    if (!chat || !els.messages) return;

    els.messages.querySelectorAll(".message--assistant[data-message-id]").forEach((article) => {
      const message = chat.messages?.find((item) => String(item.id) === String(article.dataset.messageId));
      if (!message || message.isTyping) return;

      const citations = Array.isArray(message.citations) ? message.citations : [];
      const bubble = article.querySelector(".bubble");
      if (bubble) {
        const fingerprint = String(message.content || "");
        if (bubble.dataset.markdownSource !== fingerprint) {
          bubble.innerHTML = markdownToHtml(stripEmbeddedSourceSection(fingerprint, citations));
          bubble.dataset.markdownSource = fingerprint;
          bubble.classList.add("hakeem-markdown");
        }
      }

      const content = article.querySelector(".message__content");
      if (!citations.length || !content) {
        content?.querySelector(".hakeem-source-row")?.remove();
        return;
      }

      let row = content.querySelector(".hakeem-source-row");
      if (!row) {
        row = document.createElement("div");
        row.className = "hakeem-source-row";
        const actions = content.querySelector(".message-actions");
        if (actions) content.insertBefore(row, actions);
        else content.appendChild(row);
      }

      const sourceKey = citations.map((item, index) => `${citationTitle(item, index)}|${item?.source_locator || ""}`).join(";");
      if (row.dataset.sourceKey === sourceKey) return;
      row.dataset.sourceKey = sourceKey;
      renderSourceCarousel(row, article, citations, 0);
    });
  }

  let pending = false;
  function scheduleEnhance() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      enhanceResponses();
    });
  }

  scheduleEnhance();
  const messages = document.getElementById("messages");
  if (messages) new MutationObserver(scheduleEnhance).observe(messages, { childList: true });
})();
