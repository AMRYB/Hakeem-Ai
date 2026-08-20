(() => {
  const TOKEN_KEY = "ddi_token";
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SILENCE_MS = 2000;
  const VOICE_THRESHOLD = 0.032;

  const voice = {
    open: false,
    generation: 0,
    micEnabled: true,
    processing: false,
    speaking: false,
    recognition: null,
    recognitionBase: "",
    stream: null,
    audioContext: null,
    analyser: null,
    analyserData: null,
    sourceNode: null,
    animationFrame: 0,
    restartTimer: 0,
    lastVoiceAt: 0,
    transcript: "",
    audio: null,
    audioUrl: null,
    ttsController: null,
  };

  const icons = {
    x: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    mic: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg>`,
    micOff: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 2 20 20M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6M17.3 16.3A7 7 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 11.12 5.65M12 19v3"/></svg>`,
  };

  function ensureUi() {
    let overlay = document.getElementById("hakeemVoiceMode");
    if (overlay) return overlay;

    overlay = document.createElement("section");
    overlay.id = "hakeemVoiceMode";
    overlay.className = "hakeem-voice-mode";
    overlay.hidden = true;
    overlay.dataset.state = "listening";
    overlay.innerHTML = `
      <div class="hakeem-voice-stage" role="dialog" aria-modal="true" aria-label="Voice conversation">
        <div class="hakeem-voice-copy">
          <div class="hakeem-voice-status" id="hakeemVoiceStatus">Listening</div>
          <div class="hakeem-voice-hint" id="hakeemVoiceHint">Ask your medication question naturally</div>
        </div>

        <div class="hakeem-voice-visual" id="hakeemVoiceVisual" aria-hidden="true">
          <span class="hakeem-voice-ring hakeem-voice-ring--one"></span>
          <span class="hakeem-voice-ring hakeem-voice-ring--two"></span>
          <span class="hakeem-voice-ring hakeem-voice-ring--three"></span>
          <div class="hakeem-voice-orb">
            <div class="hakeem-voice-waveform">
              <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            </div>
          </div>
        </div>

        <p class="hakeem-voice-transcript" id="hakeemVoiceTranscript" aria-live="polite"></p>
        <p class="hakeem-voice-silence-note">Pause for 2 seconds to send</p>

        <div class="hakeem-voice-controls">
          <button type="button" class="hakeem-voice-control hakeem-voice-control--close" id="hakeemVoiceClose" aria-label="Exit voice mode" title="Exit voice mode">${icons.x}</button>
          <button type="button" class="hakeem-voice-control hakeem-voice-control--mic" id="hakeemVoiceMic" aria-label="Mute microphone" title="Mute microphone">${icons.mic}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector("#hakeemVoiceClose")?.addEventListener("click", closeVoiceMode);
    overlay.querySelector("#hakeemVoiceMic")?.addEventListener("click", toggleMicrophone);
    return overlay;
  }

  function overlayElement() {
    return document.getElementById("hakeemVoiceMode");
  }

  function statusElement() {
    return document.getElementById("hakeemVoiceStatus");
  }

  function hintElement() {
    return document.getElementById("hakeemVoiceHint");
  }

  function transcriptElement() {
    return document.getElementById("hakeemVoiceTranscript");
  }

  function micButton() {
    return document.getElementById("hakeemVoiceMic");
  }

  function setVisualState(state, status, hint) {
    const overlay = overlayElement();
    if (!overlay) return;
    if (overlay.dataset.state !== state) overlay.dataset.state = state;
    if (status && statusElement()?.textContent !== status) statusElement().textContent = status;
    if (hint && hintElement()?.textContent !== hint) hintElement().textContent = hint;
  }

  function setTranscript(text) {
    const element = transcriptElement();
    if (element) element.textContent = String(text || "").trim();
  }

  function setMicButtonState() {
    const button = micButton();
    if (!button) return;
    button.innerHTML = voice.micEnabled ? icons.mic : icons.micOff;
    button.classList.toggle("is-muted", !voice.micEnabled);
    const label = voice.micEnabled ? "Mute microphone" : "Turn microphone on";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }

  function clearRestartTimer() {
    if (voice.restartTimer) window.clearTimeout(voice.restartTimer);
    voice.restartTimer = 0;
  }

  function stopRecognition() {
    clearRestartTimer();
    const recognition = voice.recognition;
    voice.recognition = null;
    if (!recognition) return;
    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;
    try {
      recognition.stop();
    } catch {
      try { recognition.abort(); } catch {}
    }
  }

  function scheduleRecognitionRestart(delay = 250) {
    clearRestartTimer();
    if (!voice.open || !voice.micEnabled || voice.processing || voice.speaking) return;
    voice.restartTimer = window.setTimeout(() => {
      voice.restartTimer = 0;
      startRecognition();
    }, delay);
  }

  function startRecognition() {
    if (!Recognition || !voice.open || !voice.micEnabled || voice.processing || voice.speaking || voice.recognition) return;

    const recognition = new Recognition();
    voice.recognition = recognition;
    voice.recognitionBase = voice.transcript.trim();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (!voice.processing && !voice.speaking) {
        setVisualState("listening", "Listening", "Ask your medication question naturally");
      }
    };

    recognition.onresult = (event) => {
      let sessionText = "";
      for (let i = 0; i < event.results.length; i += 1) {
        sessionText += `${event.results[i][0]?.transcript || ""} `;
      }
      voice.transcript = [voice.recognitionBase, sessionText.trim()].filter(Boolean).join(" ").trim();
      voice.lastVoiceAt = performance.now();
      setTranscript(voice.transcript);
    };

    recognition.onerror = (event) => {
      if (!voice.open) return;
      if (!["aborted", "no-speech"].includes(event.error)) {
        setVisualState("error", "Microphone issue", "Check microphone permission and try again");
      }
    };

    recognition.onend = () => {
      if (voice.recognition === recognition) voice.recognition = null;
      scheduleRecognitionRestart(eventuallyRestartDelay());
    };

    try {
      recognition.start();
    } catch {
      voice.recognition = null;
      scheduleRecognitionRestart(500);
    }
  }

  function eventuallyRestartDelay() {
    return voice.transcript.trim() ? 120 : 350;
  }

  async function startMicrophoneCapture() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not supported in this browser");
    }

    if (!voice.stream) {
      voice.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    }

    voice.stream.getAudioTracks().forEach((track) => { track.enabled = true; });

    if (!voice.audioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        voice.audioContext = new AudioContext();
        if (voice.audioContext.state === "suspended") await voice.audioContext.resume();
        voice.analyser = voice.audioContext.createAnalyser();
        voice.analyser.fftSize = 512;
        voice.analyser.smoothingTimeConstant = 0.72;
        voice.analyserData = new Uint8Array(voice.analyser.fftSize);
        voice.sourceNode = voice.audioContext.createMediaStreamSource(voice.stream);
        voice.sourceNode.connect(voice.analyser);
      }
    }

    if (!voice.animationFrame) meterLoop();
  }

  function meterLoop() {
    voice.animationFrame = requestAnimationFrame(meterLoop);
    if (!voice.open) return;

    let level = 0;
    if (voice.micEnabled && voice.analyser && voice.analyserData) {
      voice.analyser.getByteTimeDomainData(voice.analyserData);
      let sum = 0;
      for (let i = 0; i < voice.analyserData.length; i += 1) {
        const sample = (voice.analyserData[i] - 128) / 128;
        sum += sample * sample;
      }
      level = Math.sqrt(sum / voice.analyserData.length);
    }

    const normalized = Math.max(0, Math.min(1, (level - 0.012) * 9));
    const visual = document.getElementById("hakeemVoiceVisual");
    if (visual) visual.style.setProperty("--voice-scale", String(1 + normalized * 0.085));

    if (!voice.micEnabled || voice.processing || voice.speaking) return;

    if (level > VOICE_THRESHOLD) {
      voice.lastVoiceAt = performance.now();
      setVisualState("hearing", "Listening", "I can hear you");
    } else {
      setVisualState("listening", "Listening", voice.transcript.trim() ? "Pause for 2 seconds to send" : "Ask your medication question naturally");
    }

    if (
      voice.transcript.trim() &&
      voice.lastVoiceAt > 0 &&
      performance.now() - voice.lastVoiceAt >= SILENCE_MS
    ) {
      submitVoiceQuestion(voice.transcript.trim());
    }
  }

  async function enableMicrophone() {
    voice.micEnabled = true;
    setMicButtonState();
    try {
      await startMicrophoneCapture();
      if (!Recognition) {
        setVisualState("error", "Voice recognition unavailable", "Try Chrome or another browser with speech recognition support");
        return;
      }
      if (!voice.processing && !voice.speaking) startRecognition();
    } catch (error) {
      voice.micEnabled = false;
      setMicButtonState();
      setVisualState("error", "Microphone unavailable", error?.message || "Allow microphone access and try again");
    }
  }

  function disableMicrophone() {
    voice.micEnabled = false;
    stopRecognition();
    voice.stream?.getAudioTracks().forEach((track) => { track.enabled = false; });
    setMicButtonState();
    if (!voice.processing && !voice.speaking) {
      setVisualState("muted", "Microphone muted", "Turn the microphone on when you are ready");
    }
  }

  function toggleMicrophone() {
    if (voice.micEnabled) disableMicrophone();
    else enableMicrophone();
  }

  function latestAssistantAnswer() {
    try {
      if (typeof currentChat === "function") {
        const chat = currentChat();
        const answer = [...(chat?.messages || [])]
          .reverse()
          .find((message) => message.role === "assistant" && !message.isTyping && String(message.content || "").trim());
        if (answer?.content) return String(answer.content).trim();
      }
    } catch {}

    const articles = Array.from(document.querySelectorAll(".message--assistant[data-message-id]"));
    const latest = articles.at(-1);
    const bubble = latest?.querySelector(".bubble, .message__bubble, .message-content, .hakeem-markdown");
    return String(bubble?.textContent || "").trim();
  }

  async function requestSpeech(text, generation) {
    if (!voice.open || generation !== voice.generation) return;

    voice.speaking = true;
    setVisualState("speaking", "Hakeem is speaking", "The microphone will resume when the answer finishes");

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) throw new Error("Please sign in again");

    voice.ttsController?.abort();
    voice.ttsController = new AbortController();
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: voice.ttsController.signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `Voice generation failed (${response.status})`);
    }

    const blob = await response.blob();
    if (!voice.open || generation !== voice.generation) return;

    cleanupAudio();
    voice.audioUrl = URL.createObjectURL(blob);
    voice.audio = new Audio(voice.audioUrl);

    await new Promise((resolve, reject) => {
      const audio = voice.audio;
      audio.onended = resolve;
      audio.onerror = () => reject(new Error("Could not play the generated voice"));
      audio.play().catch(reject);
    });
  }

  function cleanupAudio() {
    if (voice.audio) {
      voice.audio.pause();
      voice.audio.src = "";
      voice.audio = null;
    }
    if (voice.audioUrl) {
      URL.revokeObjectURL(voice.audioUrl);
      voice.audioUrl = null;
    }
  }

  function prepareNextTurn(generation) {
    if (!voice.open || generation !== voice.generation) return;
    voice.processing = false;
    voice.speaking = false;
    voice.transcript = "";
    voice.recognitionBase = "";
    voice.lastVoiceAt = 0;
    setTranscript("");

    if (voice.micEnabled) {
      setVisualState("listening", "Listening", "Ask your next medication question");
      startRecognition();
    } else {
      setVisualState("muted", "Microphone muted", "Turn the microphone on when you are ready");
    }
  }

  async function submitVoiceQuestion(question) {
    if (!question || voice.processing || voice.speaking || !voice.open) return;
    const generation = voice.generation;
    voice.processing = true;
    stopRecognition();
    setTranscript(question);
    setVisualState("thinking", "Thinking", "Checking the medication evidence");

    try {
      if (typeof submitPrompt !== "function") throw new Error("Chat is not ready yet");
      await submitPrompt(question);
      if (!voice.open || generation !== voice.generation) return;

      const answer = latestAssistantAnswer();
      if (!answer) throw new Error("No answer was returned");
      await requestSpeech(answer, generation);
      cleanupAudio();
      prepareNextTurn(generation);
    } catch (error) {
      if (!voice.open || generation !== voice.generation) return;
      if (error?.name === "AbortError") return;
      cleanupAudio();
      voice.processing = false;
      voice.speaking = false;
      setVisualState("error", "Voice response unavailable", error?.message || "Please try again");
      if (voice.micEnabled) scheduleRecognitionRestart(1200);
    }
  }

  async function openVoiceMode() {
    ensureUi();
    if (voice.open) return;

    voice.open = true;
    voice.generation += 1;
    voice.processing = false;
    voice.speaking = false;
    voice.transcript = "";
    voice.recognitionBase = "";
    voice.lastVoiceAt = 0;
    voice.micEnabled = true;

    const overlay = overlayElement();
    overlay.hidden = false;
    document.body.classList.add("hakeem-voice-open");
    setTranscript("");
    setMicButtonState();
    setVisualState("listening", "Listening", "Ask your medication question naturally");
    await enableMicrophone();
  }

  function closeVoiceMode() {
    if (!voice.open) return;
    voice.open = false;
    voice.generation += 1;
    voice.processing = false;
    voice.speaking = false;
    voice.ttsController?.abort();
    voice.ttsController = null;
    stopRecognition();
    cleanupAudio();

    if (voice.animationFrame) cancelAnimationFrame(voice.animationFrame);
    voice.animationFrame = 0;

    voice.stream?.getTracks().forEach((track) => track.stop());
    voice.stream = null;
    voice.sourceNode?.disconnect?.();
    voice.sourceNode = null;
    voice.analyser = null;
    voice.analyserData = null;

    if (voice.audioContext) {
      voice.audioContext.close().catch(() => {});
      voice.audioContext = null;
    }

    const overlay = overlayElement();
    if (overlay) overlay.hidden = true;
    document.body.classList.remove("hakeem-voice-open");
  }

  function installSendButtonTrigger() {
    const button = document.getElementById("sendButton");
    const input = document.getElementById("promptInput");
    if (!button || !input || button.dataset.hakeemVoiceInstalled === "true") return;
    button.dataset.hakeemVoiceInstalled = "true";

    button.addEventListener(
      "click",
      (event) => {
        const isVoiceButton = button.dataset.icon === "audio-lines" || !String(input.value || "").trim();
        if (!isVoiceButton) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        openVoiceMode();
      },
      true,
    );
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && voice.open) closeVoiceMode();
  });

  ensureUi();
  installSendButtonTrigger();

  const buttonObserver = new MutationObserver(installSendButtonTrigger);
  const composer = document.getElementById("composer") || document.body;
  buttonObserver.observe(composer, { childList: true, subtree: true });
})();
