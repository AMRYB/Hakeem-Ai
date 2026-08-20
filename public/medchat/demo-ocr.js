(() => {
  if (window.__HAKEEM_DEMO_OCR__) return;
  window.__HAKEEM_DEMO_OCR__ = true;

  const ACCEPT = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ].join(",");

  const PDFJS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const TESSERACT_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const MAMMOTH_SRC = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js";
  const MAX_PDF_PAGES = 12;
  const MAX_FILE_BYTES = 20 * 1024 * 1024;

  let results = [];
  let isProcessing = false;
  let ui = null;

  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find((script) => script.src === src);
      if (existing) {
        const timer = window.setInterval(() => {
          if (ready()) {
            window.clearInterval(timer);
            resolve();
          }
        }, 60);
        window.setTimeout(() => {
          window.clearInterval(timer);
          if (ready()) resolve();
          else reject(new Error("Library failed to load"));
        }, 15000);
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }

  function icon(name) {
    const paths = {
      plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
      x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
      scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><path d="M7 8h10"></path><path d="M7 12h10"></path><path d="M7 16h6"></path>',
      upload: '<path d="M12 3v12"></path><path d="m7 8 5-5 5 5"></path><path d="M5 21h14a2 2 0 0 0 2-2v-4"></path><path d="M3 15v4a2 2 0 0 0 2 2"></path>',
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
  }

  function createUi() {
    if (ui) return ui;

    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = `${ACCEPT},.md,.csv,.json,.docx`;
    input.hidden = true;
    input.id = "demoOcrFileInput";
    document.body.appendChild(input);

    const backdrop = document.createElement("div");
    backdrop.className = "demo-ocr-backdrop";
    backdrop.id = "demoOcrBackdrop";
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <section class="demo-ocr-panel" role="dialog" aria-modal="true" aria-labelledby="demoOcrTitle">
        <header class="demo-ocr-header">
          <div>
            <span class="demo-ocr-eyebrow">${icon("scan")} Smart document reader</span>
            <h2 id="demoOcrTitle">Extract text from files</h2>
            <p>Images use OCR. Digital PDFs and documents use direct text extraction when possible.</p>
          </div>
          <button type="button" class="demo-ocr-close" data-demo-close aria-label="Close" title="Close">${icon("x")}</button>
        </header>
        <button type="button" class="demo-ocr-drop" data-demo-drop>
          <span>
            ${icon("upload")}
            <strong>Drop files here or choose files</strong>
            <small>PNG, JPG, WEBP, PDF, DOCX, TXT, MD, CSV, JSON · up to 20 MB each</small>
          </span>
        </button>
        <div class="demo-ocr-progress-wrap" data-demo-progress-wrap hidden>
          <div class="demo-ocr-progress-top"><span data-demo-status>Preparing…</span><span data-demo-percent>0%</span></div>
          <div class="demo-ocr-progress"><span data-demo-progress></span></div>
        </div>
        <div class="demo-ocr-results" data-demo-results>
          <div class="demo-ocr-empty">Choose a file to extract its text.</div>
        </div>
        <footer class="demo-ocr-footer">
          <div class="demo-ocr-privacy">Processed in your browser for this demo. OCR does not require an API key.</div>
          <div class="demo-ocr-actions">
            <button type="button" class="demo-ocr-secondary" data-demo-clear>Clear</button>
            <button type="button" class="demo-ocr-primary" data-demo-add disabled>Add to message</button>
          </div>
        </footer>
      </section>`;
    document.body.appendChild(backdrop);

    const drop = backdrop.querySelector("[data-demo-drop]");
    const close = backdrop.querySelector("[data-demo-close]");
    const clear = backdrop.querySelector("[data-demo-clear]");
    const add = backdrop.querySelector("[data-demo-add]");

    input.addEventListener("change", () => {
      if (input.files?.length) processFiles(Array.from(input.files));
      input.value = "";
    });
    drop.addEventListener("click", () => input.click());
    close.addEventListener("click", closeModal);
    clear.addEventListener("click", clearResults);
    add.addEventListener("click", addToMessage);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop && !isProcessing) closeModal();
    });

    ["dragenter", "dragover"].forEach((type) => {
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.remove("is-dragging");
      });
    });
    drop.addEventListener("drop", (event) => {
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) processFiles(files);
    });

    ui = {
      input,
      backdrop,
      results: backdrop.querySelector("[data-demo-results]"),
      progressWrap: backdrop.querySelector("[data-demo-progress-wrap]"),
      progress: backdrop.querySelector("[data-demo-progress]"),
      status: backdrop.querySelector("[data-demo-status]"),
      percent: backdrop.querySelector("[data-demo-percent]"),
      add,
    };
    return ui;
  }

  function openModal() {
    createUi().backdrop.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!ui || isProcessing) return;
    ui.backdrop.hidden = true;
    document.body.style.overflow = "";
  }

  function clearResults() {
    if (isProcessing) return;
    results = [];
    renderResults();
    setProgress("Ready", 0, false);
  }

  function setProgress(label, percent, visible = true) {
    if (!ui) return;
    ui.progressWrap.hidden = !visible;
    const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
    ui.status.textContent = label;
    ui.percent.textContent = `${value}%`;
    ui.progress.style.width = `${value}%`;
  }

  function bytesLabel(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderResults() {
    if (!ui) return;
    if (!results.length) {
      ui.results.innerHTML = '<div class="demo-ocr-empty">Choose a file to extract its text.</div>';
      ui.add.disabled = true;
      return;
    }

    ui.results.innerHTML = results
      .map((item, index) => {
        const meta = [item.method, bytesLabel(item.size)];
        if (Number.isFinite(item.confidence)) meta.push(`${Math.round(item.confidence)}% confidence`);
        return `
          <article class="demo-ocr-file" data-demo-result="${index}">
            <div class="demo-ocr-file-head">
              <div class="demo-ocr-file-name">
                <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
                <small>${escapeHtml(meta.join(" · "))}</small>
              </div>
              <span class="demo-ocr-badge">${escapeHtml(item.badge || "Extracted")}</span>
            </div>
            <textarea class="demo-ocr-file-text" data-demo-text="${index}" spellcheck="false">${escapeHtml(item.text)}</textarea>
          </article>`;
      })
      .join("");

    ui.results.querySelectorAll("[data-demo-text]").forEach((area) => {
      area.addEventListener("input", () => {
        const index = Number(area.dataset.demoText);
        if (results[index]) results[index].text = area.value;
        ui.add.disabled = !results.some((item) => item.text.trim());
      });
    });
    ui.add.disabled = !results.some((item) => item.text.trim());
  }

  function validFile(file) {
    if (file.size > MAX_FILE_BYTES) return `“${file.name}” is larger than 20 MB.`;
    const ext = file.name.split(".").pop()?.toLowerCase();
    const acceptedExt = ["png", "jpg", "jpeg", "webp", "pdf", "txt", "md", "csv", "json", "docx"];
    if (!acceptedExt.includes(ext || "") && !ACCEPT.includes(file.type)) return `“${file.name}” is not supported yet.`;
    return null;
  }

  async function preprocessImage(source) {
    const bitmap = source instanceof HTMLCanvasElement ? null : await createImageBitmap(source);
    const width = bitmap ? bitmap.width : source.width;
    const height = bitmap ? bitmap.height : source.height;
    const maxDim = Math.max(width, height);
    const upscale = maxDim < 1500 ? Math.min(2, 1500 / Math.max(1, maxDim)) : 1;
    const downscale = maxDim > 2600 ? 2600 / maxDim : 1;
    const scale = upscale * downscale;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.filter = "grayscale(1) contrast(1.28)";
    ctx.drawImage(bitmap || source, 0, 0, canvas.width, canvas.height);
    bitmap?.close?.();
    return canvas;
  }

  async function ocrCanvas(canvas, progressBase = 0, progressSpan = 100) {
    await loadScript(TESSERACT_SRC, () => Boolean(window.Tesseract));
    const output = await window.Tesseract.recognize(canvas, "eng+ara", {
      logger(message) {
        if (message.status === "recognizing text") {
          setProgress("Reading text with OCR…", progressBase + (message.progress || 0) * progressSpan, true);
        }
      },
    });
    return {
      text: String(output?.data?.text || "").trim(),
      confidence: Number(output?.data?.confidence),
    };
  }

  async function extractImage(file) {
    setProgress(`Preparing ${file.name}…`, 5, true);
    const canvas = await preprocessImage(file);
    const out = await ocrCanvas(canvas, 8, 90);
    return { ...out, method: "Image OCR", badge: "OCR" };
  }

  async function extractPdf(file) {
    await loadScript(PDFJS_SRC, () => Boolean(window.pdfjsLib));
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const bytes = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const chunks = [];
    const confidences = [];
    let usedOcr = false;

    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const base = ((pageNumber - 1) / pages) * 100;
      setProgress(`Reading PDF page ${pageNumber} of ${pages}…`, base + 3, true);
      const textContent = await page.getTextContent();
      const direct = textContent.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();

      if (direct.length >= 35) {
        chunks.push(`--- Page ${pageNumber} ---\n${direct}`);
        setProgress(`Read PDF page ${pageNumber} of ${pages}`, base + 90 / pages, true);
        continue;
      }

      usedOcr = true;
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      await page.render({ canvasContext: ctx, viewport }).promise;
      const prepared = await preprocessImage(canvas);
      const out = await ocrCanvas(prepared, base, 100 / pages);
      if (out.text) chunks.push(`--- Page ${pageNumber} ---\n${out.text}`);
      if (Number.isFinite(out.confidence)) confidences.push(out.confidence);
    }

    if (pdf.numPages > pages) chunks.push(`\n[Demo processed the first ${pages} of ${pdf.numPages} pages.]`);
    return {
      text: chunks.join("\n\n").trim(),
      confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : NaN,
      method: usedOcr ? "PDF text + OCR" : "PDF text extraction",
      badge: usedOcr ? "Hybrid" : "PDF",
    };
  }

  async function extractDocx(file) {
    await loadScript(MAMMOTH_SRC, () => Boolean(window.mammoth));
    setProgress(`Reading ${file.name}…`, 35, true);
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    return { text: String(result.value || "").trim(), confidence: NaN, method: "DOCX text extraction", badge: "DOCX" };
  }

  async function extractTextFile(file) {
    setProgress(`Reading ${file.name}…`, 45, true);
    return { text: (await file.text()).trim(), confidence: NaN, method: "Direct text extraction", badge: "Text" };
  }

  async function extractFile(file) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(ext || "")) return extractImage(file);
    if (file.type === "application/pdf" || ext === "pdf") return extractPdf(file);
    if (ext === "docx" || file.type.includes("wordprocessingml")) return extractDocx(file);
    return extractTextFile(file);
  }

  async function processFiles(files) {
    createUi();
    openModal();
    if (isProcessing) return;

    const errors = files.map(validFile).filter(Boolean);
    if (errors.length) {
      if (typeof showToast === "function") showToast(errors[0]);
      files = files.filter((file) => !validFile(file));
    }
    if (!files.length) return;

    isProcessing = true;
    ui.add.disabled = true;
    const nextResults = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        setProgress(`Processing ${file.name} · ${i + 1}/${files.length}`, 2, true);
        try {
          const extracted = await extractFile(file);
          nextResults.push({
            name: file.name,
            size: file.size,
            text: extracted.text || "No readable text was found.",
            confidence: extracted.confidence,
            method: extracted.method,
            badge: extracted.badge,
          });
        } catch (error) {
          nextResults.push({
            name: file.name,
            size: file.size,
            text: `Could not extract text: ${error?.message || "Unknown error"}`,
            confidence: NaN,
            method: "Extraction error",
            badge: "Error",
          });
        }
        results = [...results, ...nextResults.splice(0)];
        renderResults();
      }
      setProgress("Extraction complete", 100, true);
    } finally {
      isProcessing = false;
      ui.add.disabled = !results.some((item) => item.text.trim());
    }
  }

  function addToMessage() {
    const prompt = document.getElementById("promptInput");
    if (!prompt) return;
    const usable = results.filter((item) => item.text.trim());
    if (!usable.length) return;

    const documentContext = usable
      .map((item) => `[Extracted from ${item.name}]\n${item.text.trim()}`)
      .join("\n\n");
    const prefix = prompt.value.trim();
    prompt.value = `${prefix}${prefix ? "\n\n" : ""}${documentContext}`;
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof syncPromptInput === "function") syncPromptInput();
    closeModal();
    prompt.focus();
    if (typeof showToast === "function") showToast("Extracted text added to your message");
  }

  function installButton() {
    const composerBox = document.querySelector(".composer__box");
    const prompt = document.getElementById("promptInput");
    if (!composerBox || !prompt) return false;
    if (document.getElementById("demoOcrUploadButton")) return true;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "demoOcrUploadButton";
    button.className = "demo-upload-button";
    button.setAttribute("aria-label", "Upload document or image");
    button.setAttribute("title", "Upload document or image");
    button.innerHTML = icon("plus");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openModal();
    });
    composerBox.insertBefore(button, prompt);
    return true;
  }

  function boot() {
    createUi();
    if (installButton()) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (installButton() || attempts > 80) window.clearInterval(timer);
    }, 100);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
