import { mkdir, writeFile } from "node:fs/promises";

const SOURCE_COMMIT = "b336b4c4d1e6edf045986a97ccaeb161bb7ead0b";
const SOURCE_ROOT = `https://raw.githubusercontent.com/AMRYB/MedChat/${SOURCE_COMMIT}/gui`;
const OUTPUT_DIR = new URL("../public/medchat/", import.meta.url);

async function fetchText(name) {
  const response = await fetch(`${SOURCE_ROOT}/${name}`);
  if (!response.ok) throw new Error(`Could not fetch MedChat ${name}: ${response.status}`);
  return response.text();
}

function replaceAllPairs(text, pairs) {
  let result = text;
  for (const [from, to] of pairs) result = result.split(from).join(to);
  return result;
}

function translateHtml(html) {
  const pairs = [
    ['<html lang="ar" dir="rtl">', '<html lang="en" dir="ltr">'],
    ['<title>medchat</title>', '<title>Hakeem AI</title>'],
    ['Cairo:wght@400;500;600;700&family=Inter', 'Inter'],
    ['الشريط الجانبي للمحادثات', 'Conversation sidebar'],
    ['فتح المنيو', 'Open menu'],
    ['إظهار أو إخفاء الشريط الجانبي', 'Show or hide sidebar'],
    ['medchat', 'Hakeem AI'],
    ['محادثة جديدة', 'New chat'],
    ['بحث في المحادثات', 'Search conversations'],
    ['اختصارات', 'Shortcuts'],
    ['المثبتة', 'Pinned'],
    ['الشات', 'Chat'],
    ['افتح الشريط الجانبي', 'Open sidebar'],
    ['محادثة مؤقتة', 'Temporary chat'],
    ['مشاركة المحادثة', 'Share conversation'],
    ['مشاركة', 'Share'],
    ['خيارات المحادثة', 'Conversation options'],
    ['إيه اللي حاسس بيه؟', 'How are you feeling today?'],
    ['عندي برد وكحة ورشح، أعمل إيه؟', 'I have a cold, cough, and runny nose. What should I do?'],
    ['عندي برد', 'I have a cold'],
    ['بطني وجعاني ومش مرتاح، ممكن أعرف أتعامل إزاي؟', 'My stomach hurts and I feel uncomfortable. What should I do?'],
    ['بطني وجعاني', 'My stomach hurts'],
    ['عندي صداع شديد ومش عارف سببه، أعمل إيه؟', 'I have a severe headache and I do not know why. What should I do?'],
    ['صداع شديد', 'Severe headache'],
    ['حرارتي عالية وحاسس بتعب، أتصرف إزاي؟', 'I have a fever and feel fatigued. What should I do?'],
    ['حرارة وتعب', 'Fever and fatigue'],
    ['الأدوات', 'Tools'],
    ['قائمة الأدوات', 'Tools menu'],
    ['إضافة صور وملفات', 'Add photos and files'],
    ['الملفات الأخيرة', 'Recent files'],
    ['اكتب اللي حاسس بيه', 'Message Hakeem AI'],
    ['اختيار التفكير', 'Choose reasoning mode'],
    ['عادي', 'Normal'],
    ['التفكير العادي', 'Standard reasoning'],
    ['التفكير المتقدم', 'Advanced reasoning'],
    ['متقدم', 'Advanced'],
    ['إدخال صوتي', 'Voice input'],
    ['بدء محادثة جماعية', 'Start group chat'],
    ['إعادة التسمية', 'Rename'],
    ['تثبيت المحادثة', 'Pin conversation'],
    ['أرشفة', 'Archive'],
    ['حذف', 'Delete'],
    ['خيارات الشات', 'Chat options'],
    ['عرض الملفات في الشات', 'View chat files'],
    ['إغلاق', 'Close'],
    ['اكتب اسم المحادثة', 'Search by conversation name'],
    ['مساحة العمل', 'Workspace'],
    ['تغيير الأكونت', 'Switch account'],
    ['تصدير المحادثات', 'Export conversations'],
    ['مسح كل المحادثات', 'Clear all conversations'],
    ['تغيير الثيم', 'Change theme'],
    ['اسم ثنائي', 'Full name'],
    ['مثال: عمرو ياسر', 'Example: Alex Morgan'],
    ['حفظ وتبديل', 'Save and switch'],
    ['الإعدادات', 'Settings'],
    ['رسائل مضغوطة', 'Compact messages'],
    ['تقليل المسافات في المحادثات الطويلة.', 'Reduce spacing in long conversations.'],
    ['تسمية المحادثات تلقائيًا', 'Auto-name conversations'],
    ['استخدام أول رسالة كعنوان للمحادثة.', 'Use the first message as the conversation title.'],
    ['أسلوب الرد', 'Response style'],
    ['يتحكم في نبرة مساعد الديمو المحلي.', 'Controls the assistant response style.'],
    ['متوازن', 'Balanced'],
    ['مختصر', 'Concise'],
    ['مفصل', 'Detailed'],
  ];
  return replaceAllPairs(html, pairs);
}

function translateScript(script) {
  const pairs = [
    ['label: "عادي"', 'label: "Normal"'],
    ['menuLabel: "التفكير العادي"', 'menuLabel: "Standard reasoning"'],
    ['toast: "تم اختيار التفكير العادي"', 'toast: "Standard reasoning selected"'],
    ['label: "متقدم"', 'label: "Advanced"'],
    ['menuLabel: "التفكير المتقدم"', 'menuLabel: "Advanced reasoning"'],
    ['toast: "تم اختيار التفكير المتقدم"', 'toast: "Advanced reasoning selected"'],
    ['title: "ترتيب الأعراض"', 'title: "Review symptoms"'],
    ['"أقدر أساعدك ترتب الأعراض، تلاحظ علامات الخطورة، وتعرف إمتى تحتاج تستشير دكتور."', '"I can help you organize your symptoms, recognize warning signs, and understand when to seek medical care."'],
    ['title: "متابعة حرارة وتعب"', 'title: "Fever and fatigue follow-up"'],
    ['"اكتبلي درجة الحرارة، مدة التعب، وأي أعراض مصاحبة، وأنا أساعدك ترتب الصورة بشكل أوضح."', '"Tell me your temperature, how long the fatigue has lasted, and any other symptoms."'],
    ['"محادثة جديدة"', '"New chat"'],
    ['"هذه محادثة مؤقتة"', '"This is a temporary chat"'],
    ['"محادثة مؤقتة"', '"Temporary chat"'],
    ['"تم تفعيل المحادثة المؤقتة"', '"Temporary chat enabled"'],
    ['"مثبتة"', '"Pinned"'],
    ['"اليوم"', '"Today"'],
    ['"السابق"', '"Earlier"'],
    ['"لا توجد نتائج"', '"No results"'],
    ['aria-label="تعديل اسم المحادثة"', 'aria-label="Rename conversation"'],
    ['aria-label="خيارات المحادثة"', 'aria-label="Conversation options"'],
    ['title="خيارات المحادثة"', 'title="Conversation options"'],
    ['" رسائل · "', '" messages · "'],
    ['"مفتوح"', '"On"'],
    ['"مغلق"', '"Off"'],
    ['toLocaleUpperCase("ar-EG")', 'toLocaleUpperCase("en-US")'],
    ['"اكتب اسمك الأول واسم العائلة."', '"Enter your first and last name."'],
    ['"الاسم لازم يكون من كلمتين بالضبط."', '"Please enter exactly two names."'],
    ['"تم حفظ الأكونت والتبديل له"', '"Account saved and switched"'],
    ['<h3>الأكونتات المحفوظة</h3>', '<h3>Saved accounts</h3>'],
    ['"الأكونت الحالي"', '"Current account"'],
    ['"اضغط للتبديل"', '"Click to switch"'],
    ['"تم التبديل للأكونت"', '"Account switched"'],
    ['"إلغاء التثبيت"', '"Unpin conversation"'],
    ['"تثبيت المحادثة"', '"Pin conversation"'],
    ['isEmpty ? "اكتب اللي حاسس بيه" : "كمل..."', 'isEmpty ? "Message Hakeem AI" : "Continue..."'],
    ['"إرسال الرسالة"', '"Send message"'],
    ['"إدخال صوتي"', '"Voice input"'],
    ['"المشاركة قريبًا"', '"Sharing is coming soon"'],
    ['"محادثة جماعية قريبًا"', '"Group chat is coming soon"'],
    ['"الأرشفة غير مفعلة في النسخة المحلية"', '"Archiving is not enabled yet"'],
    ['"تم حذف المحادثة"', '"Conversation deleted"'],
    ['"الأرشفة قريبًا"', '"Archiving is coming soon"'],
    ['"عرض الملفات قريبًا"', '"File view is coming soon"'],
    ['new Intl.DateTimeFormat("ar-EG"', 'new Intl.DateTimeFormat("en-US"'],
    ['"تم النسخ"', '"Copied"'],
    ['"جار تجهيز الصوت..."', '"Preparing audio..."'],
    ['"تعذر تجهيز الصوت"', '"Could not prepare audio"'],
    ['"تشغيل الصوت"', '"Playing audio"'],
    ['"تعذر تشغيل الصوت"', '"Could not play audio"'],
    ['"تم تجهيز التصدير"', '"Export ready"'],
    ['"لا توجد محادثات مثبتة"', '"No pinned conversations"'],
    ['recent: "الملفات الأخيرة قريبًا"', 'recent: "Recent files are coming soon"'],
    ['"قريبًا"', '"Coming soon"'],
    ['"تم إرفاق الملفات"', '"Files attached"'],
    ['"تم تغيير الثيم"', '"Theme changed"'],
    ['"تم مسح المحادثات"', '"Conversations cleared"'],
    ['"الإدخال الصوتي جاهز كمكان مخصص"', '"Voice input is reserved for a future update"'],
    ['"المشاركة غير متاحة للمحادثات المؤقتة"', '"Sharing is unavailable for temporary chats"'],
    ['"تم نسخ بيانات المحادثة"', '"Conversation data copied"'],
    ['aria-label="المساعد يكتب الآن"', 'aria-label="Assistant is typing"'],
    ['aria-label="نسخ"', 'aria-label="Copy"'],
    ['title="نسخ"', 'title="Copy"'],
    ['aria-label="تعديل"', 'aria-label="Edit"'],
    ['title="تعديل"', 'title="Edit"'],
  ];
  let result = replaceAllPairs(script, pairs);

  const start = result.indexOf("function simulateAssistant(prompt) {");
  const end = result.indexOf("\nfunction submitPrompt", start);
  if (start === -1 || end === -1) throw new Error("Could not locate simulateAssistant in MedChat script");

  const replacement = `async function simulateAssistant(prompt) {
  const chat = currentChat();
  if (!chat) return;

  const token = localStorage.getItem("ddi_token");
  if (!token) {
    window.top.location.href = "/login";
    return;
  }

  const thinkingMode = getThinkingModeKey();
  const typingMessage = addMessage("assistant", "", { isTyping: true, model: "Hakeem AI", thinkingMode });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: \`Bearer \${token}\`,
      },
      body: JSON.stringify({
        message: prompt,
        session_id: chat.serverSessionId || null,
      }),
    });

    if (response.status === 401) {
      localStorage.removeItem("ddi_token");
      window.top.location.href = "/login";
      return;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || \`Request failed (\${response.status})\`);

    const targetChat = state.chats.find((item) => item.messages.some((msg) => msg.id === typingMessage.id));
    if (!targetChat) return;
    const message = targetChat.messages.find((msg) => msg.id === typingMessage.id);
    if (!message) return;

    targetChat.serverSessionId = payload.session_id;
    message.isTyping = false;
    message.content = payload.answer || "No answer was returned.";
    message.model = "Hakeem AI";
    message.thinkingMode = thinkingMode;
    message.citations = Array.isArray(payload.citations) ? payload.citations : [];
    targetChat.updatedAt = Date.now();
    saveState();
    renderMessages();
    renderSidebar();
    scrollToBottom();
  } catch (error) {
    const targetChat = state.chats.find((item) => item.messages.some((msg) => msg.id === typingMessage.id));
    const message = targetChat?.messages.find((msg) => msg.id === typingMessage.id);
    if (message) {
      message.isTyping = false;
      message.content = error instanceof Error ? error.message : "Could not contact Hakeem AI.";
    }
    if (targetChat) targetChat.updatedAt = Date.now();
    saveState();
    renderMessages();
    renderSidebar();
    scrollToBottom();
  }
}
`;

  result = result.slice(0, start) + replacement + result.slice(end);

  result += `

async function hydrateHakeemProfile() {
  const token = localStorage.getItem("ddi_token");
  if (!token) {
    window.top.location.href = "/login";
    return;
  }
  try {
    const response = await fetch("/api/profile", { headers: { Authorization: \`Bearer \${token}\` } });
    if (response.status === 401) {
      localStorage.removeItem("ddi_token");
      window.top.location.href = "/login";
      return;
    }
    if (!response.ok) return;
    const profile = await response.json();
    if (profile?.name) {
      state.settings.userName = profile.name;
      ensureAccounts();
      saveState();
      renderProfile();
    }
  } catch (error) {
    console.warn("Could not load Hakeem profile", error);
  }
}

hydrateHakeemProfile();
`;

  return result;
}

function adaptCss(css) {
  return `${css}\n\n/* Hakeem AI adaptations: original MedChat layout preserved */\nhtml, body { direction: ltr; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\nbody { direction: ltr; }\n.sidebar { direction: ltr; background: linear-gradient(180deg, #0b5ed7 0%, #0a53be 62%, #084298 100%); color: #ffffff; border-left: 1px solid rgba(255,255,255,.16); }\n.main-panel { direction: ltr; }\n.sidebar .project-title,\n.sidebar .compose-button,\n.sidebar .sidebar-search-button,\n.sidebar .conversation-item,\n.sidebar .conversation-button,\n.sidebar .profile-button,\n.sidebar .rail-action { color: #ffffff; text-align: left; }\n.sidebar .compose-button { background: rgba(255,255,255,.14); }\n.sidebar .project-title:hover,\n.sidebar .compose-button:hover,\n.sidebar .sidebar-search-button:hover,\n.sidebar .conversation-item:hover,\n.sidebar .conversation-item.is-active,\n.sidebar .profile-button:hover,\n.sidebar .rail-action:hover { background: rgba(255,255,255,.14); color: #ffffff; }\n.sidebar .conversation-group h3,\n.sidebar .profile-copy small { color: rgba(255,255,255,.68); text-align: left; }\n.sidebar .conversation-button { padding: 0 10px 0 4px; }\n.sidebar .conversation-actions { padding-left: 0; padding-right: 5px; }\n.sidebar .conversation-action { color: rgba(255,255,255,.78); }\n.sidebar__bottom { border-top-color: rgba(255,255,255,.18); }\n.sidebar .avatar { background: #ffffff; color: #0b5ed7; }\n.conversation-menu, .sheet, .dropdown, .composer-plus-menu { direction: ltr; text-align: left; }\n.conversation-menu button, .sheet-row, .sidebar-search-button, .quick-link { text-align: left; }\n.message, .message__content, .message__bubble, .search-dialog, .account-form, .settings-list { direction: ltr; text-align: left; }\n.composer textarea, .conversation-rename-input, .search-dialog input, .account-field input { direction: ltr; text-align: left; }\n`;
}

await mkdir(OUTPUT_DIR, { recursive: true });

const [rawHtml, rawCss, rawScript] = await Promise.all([
  fetchText("index.html"),
  fetchText("styles.css"),
  fetchText("script.js"),
]);

await Promise.all([
  writeFile(new URL("index.html", OUTPUT_DIR), translateHtml(rawHtml), "utf8"),
  writeFile(new URL("styles.css", OUTPUT_DIR), adaptCss(rawCss), "utf8"),
  writeFile(new URL("script.js", OUTPUT_DIR), translateScript(rawScript), "utf8"),
]);

console.log(`Synced MedChat GUI from ${SOURCE_COMMIT} into public/medchat`);
