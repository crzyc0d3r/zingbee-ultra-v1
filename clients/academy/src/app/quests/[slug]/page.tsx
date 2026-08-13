"use client"
import { useState, useRef, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { Card, CardContent } from "@/components/shared/ui/card"
import { Button } from "@/components/shared/ui/button"
import { Input } from "@/components/shared/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shared/ui/tooltip"
import { DashboardHeader } from "@/components/quests/dashboard-header"
import { apiClient } from "@/lib/api-client"
import {
    Send,
    Lightbulb,
    FolderOpen,
    Target,
    History,
    ChevronLeft,
    ChevronRight,
    Trash2,
    Copy,
    Save,
    Mic,
    MicOff,
    Volume2,
    VolumeX
} from "lucide-react"
import { useXAIVoice } from "@/hooks/use-xai-voice"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import { toast } from "sonner"

// Quest chat backend (/llm-chat/chat/completions/) was on the legacy
// .org service and has not been ported to api.zingbee.ai. Disable this
// entrypoint until the route exists. Typed as boolean (not literal `true`)
// so TS does not flag the existing fetch code as unreachable.
const QUEST_CHAT_DISABLED: boolean = false

// SVG icon mapping to match dashboard
const iconSvgMap: Record<string, string> = {
    Rocket: "/icons/glassmorphism/rocket.svg",
    Users: "/icons/glassmorphism/globe.svg",
    Globe: "/icons/glassmorphism/globe.svg",
    Brain: "/icons/glassmorphism/brain.svg",
    DollarSign: "/icons/glassmorphism/money-box.svg",
    Briefcase: "/icons/glassmorphism/briefcase.svg",
}

// UI translations
const uiTranslations: Record<string, Record<string, string>> = {
    workspaceTools: {
        en: "Workspace Tools",
        es: "Herramientas de Trabajo",
        zh: "工作区工具",
        hi: "कार्यक्षेत्र उपकरण",
        ar: "أدوات مساحة العمل",
        fr: "Outils d'espace de travail",
        pt: "Ferramentas de Trabalho",
        bn: "কর্মক্ষেত্র সরঞ্জাম",
        ru: "Инструменты рабочего пространства",
        de: "Arbeitsbereich-Tools",
        ur: "ورک اسپیس ٹولز",
    },
    myProjects: {
        en: "My Projects",
        es: "Mis Proyectos",
        zh: "我的项目",
        hi: "मेरी परियोजनाएं",
        ar: "مشاريعي",
        fr: "Mes Projets",
        pt: "Meus Projetos",
        bn: "আমার প্রকল্পসমূহ",
        ru: "Мои проекты",
        de: "Meine Projekte",
        ur: "میرے پروجیکٹس",
    },
    chatHistory: {
        en: "Chat History",
        es: "Historial de Chat",
        zh: "聊天记录",
        hi: "चैट इतिहास",
        ar: "سجل المحادثات",
        fr: "Historique des discussions",
        pt: "Histórico de Chat",
        bn: "চ্যাট ইতিহাস",
        ru: "История чата",
        de: "Chat-Verlauf",
        ur: "چیٹ کی تاریخ",
    },
    newChat: {
        en: "New Chat",
        es: "Nuevo Chat",
        zh: "新聊天",
        hi: "नई चैट",
        ar: "محادثة جديدة",
        fr: "Nouvelle discussion",
        pt: "Novo Chat",
        bn: "নতুন চ্যাট",
        ru: "Новый чат",
        de: "Neuer Chat",
        ur: "نئی چیٹ",
    },
    keySkills: {
        en: "Key Skills",
        es: "Habilidades Clave",
        zh: "关键技能",
        hi: "प्रमुख कौशल",
        ar: "المهارات الرئيسية",
        fr: "Compétences clés",
        pt: "Habilidades-chave",
        bn: "মূল দক্ষতা",
        ru: "Ключевые навыки",
        de: "Schlüsselkompetenzen",
        ur: "اہم مہارتیں",
    },
    mastering: {
        en: "Mastering",
        es: "Dominando",
        zh: "掌握",
        hi: "महारत हासिल करना",
        ar: "إتقان",
        fr: "Maîtriser",
        pt: "Dominando",
        bn: "দক্ষতা অর্জন",
        ru: "Освоение",
        de: "Meistern",
        ur: "مہارت حاصل کرنا",
    },
    throughAIProjects: {
        en: "through AI-guided projects",
        es: "a través de proyectos guiados por IA",
        zh: "通过AI引导的项目",
        hi: "AI-निर्देशित परियोजनाओं के माध्यम से",
        ar: "من خلال مشاريع موجهة بالذكاء الاصطناعي",
        fr: "grâce à des projets guidés par l'IA",
        pt: "através de projetos guiados por IA",
        bn: "AI-নির্দেশিত প্রকল্পের মাধ্যমে",
        ru: "через проекты с поддержкой ИИ",
        de: "durch KI-geführte Projekte",
        ur: "AI گائیڈڈ پروجیکٹس کے ذریعے",
    },
    welcomeTo: {
        en: "Welcome to",
        es: "Bienvenido a",
        zh: "欢迎来到",
        hi: "आपका स्वागत है",
        ar: "مرحباً بك في",
        fr: "Bienvenue à",
        pt: "Bem-vindo ao",
        bn: "স্বাগতম",
        ru: "Добро пожаловать в",
        de: "Willkommen bei",
        ur: "خوش آمدید",
    },
    aiAssistantIntro: {
        en: "I'm your AI assistant for this quest. How can I help you today?",
        es: "Soy tu asistente de IA para esta misión. ¿Cómo puedo ayudarte hoy?",
        zh: "我是您这次任务的AI助手。今天我能帮您什么？",
        hi: "मैं इस क्वेस्ट के लिए आपका AI सहायक हूं। आज मैं आपकी कैसे मदद कर सकता हूं?",
        ar: "أنا مساعدك الذكي لهذه المهمة. كيف يمكنني مساعدتك اليوم؟",
        fr: "Je suis votre assistant IA pour cette quête. Comment puis-je vous aider aujourd'hui?",
        pt: "Sou seu assistente de IA para esta missão. Como posso ajudá-lo hoje?",
        bn: "আমি এই কোয়েস্টের জন্য আপনার AI সহকারী। আজ আমি আপনাকে কীভাবে সাহায্য করতে পারি?",
        ru: "Я ваш AI-помощник для этого квеста. Чем могу помочь сегодня?",
        de: "Ich bin Ihr KI-Assistent für diese Quest. Wie kann ich Ihnen heute helfen?",
        ur: "میں اس کویسٹ کے لیے آپ کا AI اسسٹنٹ ہوں۔ آج میں آپ کی کیسے مدد کر سکتا ہوں؟",
    },
    typeMessage: {
        en: "Type a message...",
        es: "Escribe un mensaje...",
        zh: "输入消息...",
        hi: "संदेश लिखें...",
        ar: "اكتب رسالة...",
        fr: "Tapez un message...",
        pt: "Digite uma mensagem...",
        bn: "একটি বার্তা লিখুন...",
        ru: "Введите сообщение...",
        de: "Nachricht eingeben...",
        ur: "پیغام لکھیں...",
    },
    connecting: {
        en: "Connecting to voice server...",
        es: "Conectando al servidor de voz...",
        zh: "正在连接语音服务器...",
        hi: "वॉइस सर्वर से कनेक्ट हो रहा है...",
        ar: "جاري الاتصال بخادم الصوت...",
        fr: "Connexion au serveur vocal...",
        pt: "Conectando ao servidor de voz...",
        bn: "ভয়েস সার্ভারে সংযোগ করা হচ্ছে...",
        ru: "Подключение к голосовому серверу...",
        de: "Verbindung zum Sprachserver...",
        ur: "وائس سرور سے جڑ رہا ہے...",
    },
    listening: {
        en: "Listening... speak now",
        es: "Escuchando... habla ahora",
        zh: "正在听...请说话",
        hi: "सुन रहा है... अभी बोलें",
        ar: "أستمع... تحدث الآن",
        fr: "Écoute... parlez maintenant",
        pt: "Ouvindo... fale agora",
        bn: "শুনছি... এখন বলুন",
        ru: "Слушаю... говорите",
        de: "Höre zu... jetzt sprechen",
        ur: "سن رہا ہوں... اب بولیں",
    },
    processing: {
        en: "Processing speech...",
        es: "Procesando voz...",
        zh: "处理语音中...",
        hi: "भाषण संसाधित हो रहा है...",
        ar: "جاري معالجة الكلام...",
        fr: "Traitement de la parole...",
        pt: "Processando fala...",
        bn: "বক্তৃতা প্রক্রিয়াকরণ হচ্ছে...",
        ru: "Обработка речи...",
        de: "Verarbeite Sprache...",
        ur: "تقریر پروسیس ہو رہی ہے...",
    },
    speakingResponse: {
        en: "Speaking response...",
        es: "Hablando respuesta...",
        zh: "正在播放回复...",
        hi: "प्रतिक्रिया बोल रहा है...",
        ar: "جاري نطق الرد...",
        fr: "Réponse en cours...",
        pt: "Falando resposta...",
        bn: "প্রতিক্রিয়া বলছে...",
        ru: "Озвучивание ответа...",
        de: "Antwort wird gesprochen...",
        ur: "جواب بول رہا ہے...",
    },
    connected: {
        en: "Connected",
        es: "Conectado",
        zh: "已连接",
        hi: "कनेक्टेड",
        ar: "متصل",
        fr: "Connecté",
        pt: "Conectado",
        bn: "সংযুক্ত",
        ru: "Подключено",
        de: "Verbunden",
        ur: "جڑا ہوا",
    },
    voiceModeReady: {
        en: "Voice mode ready",
        es: "Modo de voz listo",
        zh: "语音模式就绪",
        hi: "वॉइस मोड तैयार",
        ar: "وضع الصوت جاهز",
        fr: "Mode vocal prêt",
        pt: "Modo de voz pronto",
        bn: "ভয়েস মোড প্রস্তুত",
        ru: "Голосовой режим готов",
        de: "Sprachmodus bereit",
        ur: "وائس موڈ تیار",
    },
    endVoiceChat: {
        en: "End Voice Chat",
        es: "Terminar Chat de Voz",
        zh: "结束语音聊天",
        hi: "वॉइस चैट समाप्त करें",
        ar: "إنهاء المحادثة الصوتية",
        fr: "Terminer le chat vocal",
        pt: "Encerrar Chat de Voz",
        bn: "ভয়েস চ্যাট শেষ করুন",
        ru: "Завершить голосовой чат",
        de: "Sprachchat beenden",
        ur: "وائس چیٹ ختم کریں",
    },
    voiceActive: {
        en: "Voice mode active...",
        es: "Modo de voz activo...",
        zh: "语音模式已激活...",
        hi: "वॉइस मोड सक्रिय...",
        ar: "وضع الصوت نشط...",
        fr: "Mode vocal actif...",
        pt: "Modo de voz ativo...",
        bn: "ভয়েস মোড সক্রিয়...",
        ru: "Голосовой режим активен...",
        de: "Sprachmodus aktiv...",
        ur: "وائس موڈ فعال...",
    },
    aiSpeaking: {
        en: "AI speaking...",
        es: "IA hablando...",
        zh: "AI正在说话...",
        hi: "AI बोल रहा है...",
        ar: "الذكاء الاصطناعي يتحدث...",
        fr: "IA en train de parler...",
        pt: "IA falando...",
        bn: "AI বলছে...",
        ru: "ИИ говорит...",
        de: "KI spricht...",
        ur: "AI بول رہا ہے...",
    },
    voiceInstructions: {
        en: "Speak naturally. The AI will respond automatically with voice.",
        es: "Habla naturalmente. La IA responderá automáticamente con voz.",
        zh: "自然地说话。AI会自动用语音回复。",
        hi: "स्वाभाविक रूप से बोलें। AI स्वचालित रूप से आवाज से जवाब देगा।",
        ar: "تحدث بشكل طبيعي. سيرد الذكاء الاصطناعي تلقائياً بالصوت.",
        fr: "Parlez naturellement. L'IA répondra automatiquement par la voix.",
        pt: "Fale naturalmente. A IA responderá automaticamente com voz.",
        bn: "স্বাভাবিকভাবে কথা বলুন। AI স্বয়ংক্রিয়ভাবে ভয়েসে সাড়া দেবে।",
        ru: "Говорите естественно. ИИ автоматически ответит голосом.",
        de: "Sprechen Sie natürlich. Die KI antwortet automatisch per Sprache.",
        ur: "فطری طور پر بولیں۔ AI خودکار طور پر آواز سے جواب دے گا۔",
    },
    textInstructions: {
        en: "Type a message or click the microphone for AI-powered voice conversation.",
        es: "Escribe un mensaje o haz clic en el micrófono para una conversación de voz con IA.",
        zh: "输入消息或点击麦克风进行AI语音对话。",
        hi: "AI-पावर्ड वॉइस बातचीत के लिए संदेश लिखें या माइक्रोफ़ोन पर क्लिक करें।",
        ar: "اكتب رسالة أو انقر على الميكروفون لمحادثة صوتية بالذكاء الاصطناعي.",
        fr: "Tapez un message ou cliquez sur le microphone pour une conversation vocale IA.",
        pt: "Digite uma mensagem ou clique no microfone para conversa de voz com IA.",
        bn: "একটি বার্তা লিখুন বা AI-চালিত ভয়েস কথোপকথনের জন্য মাইক্রোফোনে ক্লিক করুন।",
        ru: "Введите сообщение или нажмите на микрофон для голосового разговора с ИИ.",
        de: "Geben Sie eine Nachricht ein oder klicken Sie auf das Mikrofon für KI-Sprachkonversation.",
        ur: "پیغام ٹائپ کریں یا AI وائس گفتگو کے لیے مائیکروفون پر کلک کریں۔",
    },
    deleteChat: {
        en: "Delete chat session?",
        es: "¿Eliminar sesión de chat?",
        zh: "删除聊天会话？",
        hi: "चैट सत्र हटाएं?",
        ar: "حذف جلسة المحادثة؟",
        fr: "Supprimer la session de chat?",
        pt: "Excluir sessão de chat?",
        bn: "চ্যাট সেশন মুছে ফেলবেন?",
        ru: "Удалить сессию чата?",
        de: "Chat-Sitzung löschen?",
        ur: "چیٹ سیشن حذف کریں؟",
    },
    deleteWarning: {
        en: "This will permanently remove the chat history for this session.",
        es: "Esto eliminará permanentemente el historial de chat de esta sesión.",
        zh: "这将永久删除此会话的聊天记录。",
        hi: "यह इस सत्र के चैट इतिहास को स्थायी रूप से हटा देगा।",
        ar: "سيؤدي هذا إلى إزالة سجل المحادثات لهذه الجلسة بشكل دائم.",
        fr: "Cela supprimera définitivement l'historique de chat de cette session.",
        pt: "Isso removerá permanentemente o histórico de chat desta sessão.",
        bn: "এটি এই সেশনের চ্যাট ইতিহাস স্থায়ীভাবে মুছে ফেলবে।",
        ru: "Это навсегда удалит историю чата для этой сессии.",
        de: "Dies wird den Chat-Verlauf dieser Sitzung dauerhaft löschen.",
        ur: "یہ اس سیشن کی چیٹ ہسٹری کو مستقل طور پر ہٹا دے گا۔",
    },
    cancel: {
        en: "Cancel",
        es: "Cancelar",
        zh: "取消",
        hi: "रद्द करें",
        ar: "إلغاء",
        fr: "Annuler",
        pt: "Cancelar",
        bn: "বাতিল",
        ru: "Отмена",
        de: "Abbrechen",
        ur: "منسوخ",
    },
    delete: {
        en: "Delete",
        es: "Eliminar",
        zh: "删除",
        hi: "हटाएं",
        ar: "حذف",
        fr: "Supprimer",
        pt: "Excluir",
        bn: "মুছুন",
        ru: "Удалить",
        de: "Löschen",
        ur: "حذف کریں",
    },
    copy: {
        en: "Copy",
        es: "Copiar",
        zh: "复制",
        hi: "कॉपी",
        ar: "نسخ",
        fr: "Copier",
        pt: "Copiar",
        bn: "কপি",
        ru: "Копировать",
        de: "Kopieren",
        ur: "کاپی",
    },
    read: {
        en: "Read",
        es: "Leer",
        zh: "朗读",
        hi: "पढ़ें",
        ar: "اقرأ",
        fr: "Lire",
        pt: "Ler",
        bn: "পড়ুন",
        ru: "Читать",
        de: "Lesen",
        ur: "پڑھیں",
    },
    stop: {
        en: "Stop",
        es: "Parar",
        zh: "停止",
        hi: "रोकें",
        ar: "توقف",
        fr: "Arrêter",
        pt: "Parar",
        bn: "থামুন",
        ru: "Стоп",
        de: "Stopp",
        ur: "رکیں",
    },
    save: {
        en: "Save",
        es: "Guardar",
        zh: "保存",
        hi: "सेव करें",
        ar: "حفظ",
        fr: "Enregistrer",
        pt: "Salvar",
        bn: "সংরক্ষণ",
        ru: "Сохранить",
        de: "Speichern",
        ur: "محفوظ کریں",
    },
    loadingQuest: {
        en: "Loading Quest...",
        es: "Cargando Misión...",
        zh: "加载任务中...",
        hi: "क्वेस्ट लोड हो रहा है...",
        ar: "جاري تحميل المهمة...",
        fr: "Chargement de la quête...",
        pt: "Carregando Missão...",
        bn: "কোয়েস্ট লোড হচ্ছে...",
        ru: "Загрузка квеста...",
        de: "Quest wird geladen...",
        ur: "کویسٹ لوڈ ہو رہی ہے...",
    },
}

// Helper function to get translation
const t = (key: string, lang: string): string => {
    return uiTranslations[key]?.[lang] || uiTranslations[key]?.["en"] || key
}

type ChatSession = {
    id: string
    title: string
    timestamp: Date
    messages: Array<any>
}

type Quest = {
    id: string
    title: string
    description: string
    icon: string
    color: string
    bg_color: string
    border_color: string
    href: string
    assistant_id?: string
}

const HtmlPreview = ({ html, allowScripts }: { html: string; allowScripts?: boolean }) => {
    const sanitizedHtml = html || "<div></div>"
    const srcDoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: ui-sans-serif, system-ui; margin: 0; padding: 12px; }
    </style>
  </head>
  <body>${sanitizedHtml}</body>
</html>`

    return (
        <iframe
            className="w-full h-[200px] rounded-lg border bg-white"
            sandbox={allowScripts ? "allow-scripts" : ""}
            srcDoc={srcDoc}
            title="HTML Preview"
        />
    )
}

const JsPreview = ({ code }: { code: string }) => {
    const srcDoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: ui-sans-serif, system-ui; margin: 0; padding: 12px; }
      #app { min-height: 24px; }
      pre { background: #f1f5f9; padding: 8px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <pre id="log"></pre>
    <script>
      const logEl = document.getElementById('log');
      const log = (...args) => {
        logEl.textContent += args.map(a => String(a)).join(' ') + '\\n';
      };
      console.log = log;
      console.error = log;
    </script>
    <script>
      try { ${code} } catch (e) { console.error(e); }
    </script>
  </body>
</html>`

    return (
        <iframe
            className="w-full h-[200px] rounded-lg border bg-white"
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            title="JavaScript Preview"
        />
    )
}

const MermaidPreview = ({ code }: { code: string }) => {
    const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
    const srcDoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: ui-sans-serif, system-ui; margin: 0; padding: 12px; }
    </style>
  </head>
  <body>
    <div class="mermaid">${escaped}</div>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <script>mermaid.initialize({ startOnLoad: true });</script>
  </body>
</html>`

    return (
        <iframe
            className="w-full h-[220px] rounded-lg border bg-white"
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            title="Mermaid Chart"
        />
    )
}

const MarkdownContent = ({ content }: { content: string }) => {
    if (!content) return null

    const renderInline = (text: string) => {
        const parts = text.split(/(`[^`]+`)/)
        return parts.map((part, index) => {
            if (part.startsWith("`") && part.endsWith("`")) {
                return (
                    <code key={`code-${index}`} className="bg-slate-100 px-1.5 py-0.5 rounded text-sm font-mono">
                        {part.slice(1, -1)}
                    </code>
                )
            }
            return part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((segment, i) => {
                if (!segment) return null
                if (segment.startsWith("**") && segment.endsWith("**")) {
                    return <strong key={`bold-${index}-${i}`}>{segment.slice(2, -2)}</strong>
                }
                if (segment.startsWith("*") && segment.endsWith("*") && !segment.startsWith("**")) {
                    return <em key={`em-${index}-${i}`}>{segment.slice(1, -1)}</em>
                }
                return segment
            })
        })
    }

    const renderBlocks = (text: string, keyPrefix: string) => {
        const lines = text.split("\n")
        const nodes: React.ReactNode[] = []
        let paragraph: string[] = []
        let listItems: React.ReactNode[] = []
        let listType: "ul" | "ol" | null = null
        let listIndex = 0

        const flushParagraph = () => {
            if (paragraph.length === 0) return
            nodes.push(
                <p key={`${keyPrefix}-p-${nodes.length}`} className="mt-2 first:mt-0">
                    {renderInline(paragraph.join(" "))}
                </p>
            )
            paragraph = []
        }

        const flushList = () => {
            if (listItems.length === 0 || !listType) return
            if (listType === "ol") {
                nodes.push(
                    <ol key={`${keyPrefix}-ol-${nodes.length}`} className="list-decimal pl-5 mt-2 space-y-1">
                        {listItems}
                    </ol>
                )
            } else {
                nodes.push(
                    <ul key={`${keyPrefix}-ul-${nodes.length}`} className="list-disc pl-5 mt-2 space-y-1">
                        {listItems}
                    </ul>
                )
            }
            listItems = []
            listType = null
            listIndex = 0
        }

        const headingClasses: Record<number, string> = {
            1: "text-xl font-semibold mt-4",
            2: "text-lg font-semibold mt-4",
            3: "text-base font-semibold mt-3",
            4: "text-sm font-semibold mt-3",
            5: "text-sm font-semibold mt-2",
            6: "text-sm font-semibold mt-2",
        }

        lines.forEach((rawLine, lineIndex) => {
            const line = rawLine.replace(/\s+$/, "")
            const trimmed = line.trim()

            if (!trimmed) {
                flushParagraph()
                flushList()
                return
            }

            if (/^---+$/.test(trimmed)) {
                flushParagraph()
                flushList()
                nodes.push(<hr key={`${keyPrefix}-hr-${lineIndex}`} className="my-3 border-slate-200" />)
                return
            }

            const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
            if (headingMatch) {
                flushParagraph()
                flushList()
                const level = headingMatch[1].length
                const headingText = headingMatch[2]
                const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements
                nodes.push(
                    <HeadingTag key={`${keyPrefix}-h-${lineIndex}`} className={headingClasses[level]}>
                        {renderInline(headingText)}
                    </HeadingTag>
                )
                return
            }

            const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/)
            const orderedMatch = trimmed.match(/^\d+[.)]\s+(.*)$/)
            if (unorderedMatch || orderedMatch) {
                flushParagraph()
                const isOrdered = Boolean(orderedMatch)
                const currentType = isOrdered ? "ol" : "ul"
                if (listType && listType !== currentType) {
                    flushList()
                }
                listType = currentType
                const itemText = (unorderedMatch || orderedMatch)?.[1] || ""
                listItems.push(
                    <li key={`${keyPrefix}-li-${lineIndex}-${listIndex++}`}>
                        {renderInline(itemText)}
                    </li>
                )
                return
            }

            paragraph.push(trimmed)
        })

        flushParagraph()
        flushList()

        return nodes
    }

    const parts = content.split(/(```[\s\S]*?```)/)
    return (
        <div className="text-sm leading-relaxed">
            {parts.map((part, index) => {
                if (!part) return null
                if (part.startsWith("```")) {
                    const raw = part.slice(3, -3)
                    const lines = raw.split("\n")
                    const firstLine = lines[0]?.trim() || ""
                    const hasLanguage = lines.length > 1 && /^[a-zA-Z0-9 _-]+$/.test(firstLine)
                    const language = hasLanguage ? firstLine.toLowerCase() : ""
                    const codeContent = hasLanguage ? lines.slice(1).join("\n") : raw.trim()

                    if (language === "mermaid") {
                        return <MermaidPreview key={`mermaid-${index}`} code={codeContent} />
                    }
                    if (language === "html") {
                        return <HtmlPreview key={`html-${index}`} html={codeContent} allowScripts />
                    }
                    if (language === "javascript" || language === "js") {
                        return <JsPreview key={`js-${index}`} code={codeContent} />
                    }
                    if (language === "markdown" || language === "md" || language === "raw markdown" || language === "raw") {
                        return (
                            <div key={`md-${index}`} className="mt-2 first:mt-0">
                                {renderBlocks(codeContent, `md-${index}`)}
                            </div>
                        )
                    }

                    return (
                        <pre key={`code-${index}`} className="bg-slate-100 rounded-lg p-3 my-2 overflow-x-auto">
                            <code className="text-xs font-mono text-slate-800">{codeContent}</code>
                        </pre>
                    )
                }
                return (
                    <div key={`text-${index}`} className="mt-2 first:mt-0">
                        {renderBlocks(part, `text-${index}`)}
                    </div>
                )
            })}
        </div>
    )
}

export default function DynamicQuestPage() {
    const params = useParams()
    const slug = params.slug as string
    const [quest, setQuest] = useState<Quest | null>(null)

    const router = useRouter()
    const [inputValue, setInputValue] = useState("")
    const [userName, setUserName] = useState("Student")
    const [chatHistory, setChatHistory] = useState<Array<{ id: string, title: string, timestamp: Date }>>([])
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
    const currentSessionIdRef = useRef<string | null>(null)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
    const [historyHasScrollbar, setHistoryHasScrollbar] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement | null>(null)
    const historyListRef = useRef<HTMLDivElement | null>(null)

    // Student/Subject IDs for backend persistence
    const [studentId, setStudentId] = useState<string | null>(null)
    const [subjectId, setSubjectId] = useState<string | null>(null)

    // Manual Chat State
    const [messages, setMessages] = useState<any[]>([])
    const [status, setStatus] = useState<"ready" | "submitted" | "streaming">("ready")

    // Quest prompts for starter suggestions
    const [starterPrompts, setStarterPrompts] = useState<{ id: string; prompt_text: string }[]>([])

    // Language preference for UI translations - initialize from localStorage to avoid flash
    const [lang, setLang] = useState(() => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("preferredLanguage") || "en"
        }
        return "en"
    })

    // Listen for language changes from other tabs/header component
    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === "preferredLanguage" && e.newValue) {
                setLang(e.newValue)
            }
        }

        window.addEventListener("storage", handleStorageChange)

        return () => {
            window.removeEventListener("storage", handleStorageChange)
        }
    }, [])

    // Voice functionality - WebRTC-based voice conversation using XAI Realtime API
    // In voice mode, XAI handles everything - we just display messages, NO OpenAI calls
    const {
        isVoiceModeActive,
        startVoiceMode,
        stopVoiceMode,
        isRecording,
        isTranscribing,
        transcript,
        error: voiceError,
        isSpeaking,
        stopSpeaking,
        setOnUserTranscriptReady,
        setOnAssistantTranscriptReady,
        isConnected,
        isConnecting,
        connectionQuality,
        audioLevel,
        chatSessionId
    } = useXAIVoice()

    // Currently speaking message ID (for browser TTS read-aloud feature)
    const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)

    // Voice session ID for saving exchanges
    const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null)
    const pendingUserTranscriptRef = useRef<string | null>(null)
    const streamingAssistantIdRef = useRef<string | null>(null)

    // Stream assistant transcript in real-time as XAI speaks
    useEffect(() => {
        if (!isVoiceModeActive) return

        // When transcript starts coming in, create or update streaming message
        if (transcript && transcript.trim()) {
            if (!streamingAssistantIdRef.current) {
                // Create new streaming message
                const newId = `voice-assistant-streaming-${Date.now()}`
                streamingAssistantIdRef.current = newId
                const streamingMessage = {
                    id: newId,
                    role: "assistant",
                    content: transcript
                }
                setMessages(prev => [...prev, streamingMessage])
            } else {
                // Update existing streaming message
                setMessages(prev =>
                    prev.map(m =>
                        m.id === streamingAssistantIdRef.current
                            ? { ...m, content: transcript }
                            : m
                    )
                )
            }
        }
    }, [transcript, isVoiceModeActive])

    // Set up callbacks for voice mode messages (NO OpenAI submission - XAI handles the AI)
    useEffect(() => {
        // When user speaks and XAI transcribes it, display as user message
        setOnUserTranscriptReady((userText: string) => {
            if (userText.trim()) {
                const userMessage = {
                    id: `voice-user-${Date.now()}`,
                    role: "user",
                    content: userText.trim()
                }
                setMessages(prev => [...prev, userMessage])
                // Store for saving when assistant responds
                pendingUserTranscriptRef.current = userText.trim()
                // Reset streaming assistant ID for next response
                streamingAssistantIdRef.current = null
            }
        })

        // When XAI finishes responding, finalize the message and save exchange
        setOnAssistantTranscriptReady(async (assistantText: string) => {
            if (assistantText.trim()) {
                // Finalize the streaming message with complete text
                if (streamingAssistantIdRef.current) {
                    setMessages(prev =>
                        prev.map(m =>
                            m.id === streamingAssistantIdRef.current
                                ? { ...m, content: assistantText.trim() }
                                : m
                        )
                    )
                } else {
                    // Fallback: create new message if streaming wasn't set up
                    const assistantMessage = {
                        id: `voice-assistant-${Date.now()}`,
                        role: "assistant",
                        content: assistantText.trim()
                    }
                    setMessages(prev => [...prev, assistantMessage])
                }
                streamingAssistantIdRef.current = null

                // Save the voice exchange to database (session already exists from startVoiceMode)
                const userText = pendingUserTranscriptRef.current
                if (userText && studentId && voiceSessionId) {
                    try {
                        const result = await apiClient.voice.saveExchange({
                            student_id: studentId,
                            user_message: userText,
                            assistant_message: assistantText.trim(),
                            session_id: voiceSessionId,  // Always use real session ID
                            quest_id: quest?.id,
                        })

                        // Update session preview with summary if returned
                        if (result.session_preview) {
                            setChatHistory(prev => prev.map(h =>
                                h.id === voiceSessionId
                                    ? { ...h, title: result.session_preview || h.title }
                                    : h
                            ))
                        }
                        pendingUserTranscriptRef.current = null
                    } catch (e) {
                        console.error("Failed to save voice exchange:", e)
                    }
                }
            }
        })

        return () => {
            setOnUserTranscriptReady(null)
            setOnAssistantTranscriptReady(null)
        }
    }, [setOnUserTranscriptReady, setOnAssistantTranscriptReady, studentId, quest?.id, voiceSessionId])

    // Handle voice mode toggle
    const handleVoiceToggle = async () => {
        if (isVoiceModeActive) {
            stopVoiceMode()
        } else {
            if (!studentId) {
                return // Can't start voice without student context
            }
            // Always start a new chat when entering voice mode
            handleNewChat()
            setVoiceSessionId(null)
            streamingAssistantIdRef.current = null

            // Pass student and quest IDs - server builds full context from DB
            // Includes student profile, relevant memories, quest voice_prompt, and language
            const lang = localStorage.getItem("preferredLanguage") || "en"
            const sessionId = await startVoiceMode({
                studentId: studentId,
                questId: quest?.id,
                language: lang
            })

            // Add session to chat history with real ID from backend
            if (sessionId) {
                setVoiceSessionId(sessionId)
                setCurrentSessionId(sessionId)
                currentSessionIdRef.current = sessionId
                const newSession: ChatSession = {
                    id: sessionId,
                    title: "New conversation",
                    timestamp: new Date(),
                    messages: []
                }
                setChatHistory(prev => [newSession, ...prev])
            }
        }
    }

    // Handle text-to-speech for a message using browser speech synthesis
    const handleSpeak = (messageId: string, content: string) => {
        if (speakingMessageId === messageId) {
            // Stop speaking
            window.speechSynthesis.cancel()
            setSpeakingMessageId(null)
        } else {
            // Stop any current speech and start new
            window.speechSynthesis.cancel()
            setSpeakingMessageId(messageId)
            const utterance = new SpeechSynthesisUtterance(content)
            utterance.onend = () => setSpeakingMessageId(null)
            utterance.onerror = () => setSpeakingMessageId(null)
            window.speechSynthesis.speak(utterance)
        }
    }

    // Fetch Quest Data - depends on lang so it re-fetches when language changes
    useEffect(() => {
        const fetchQuest = async () => {
            try {
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/quests/?lang=${lang}`, {
                    credentials: 'include'
                })
                const quests: Quest[] = await res.json()
                const matchedQuest = quests.find(q => q.href.endsWith(slug) || q.href === `/quests/${slug}`)
                if (matchedQuest) {
                    setQuest(matchedQuest)
                }
            } catch (e) {
                // Quest fetch failed
            }
        }
        fetchQuest()
    }, [slug, lang])

    // Fetch starter prompts when quest loads - depends on lang so it re-fetches when language changes
    useEffect(() => {
        const fetchPrompts = async () => {
            if (!quest?.id) return
            try {
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/quests/${quest.id}/prompts?limit=4&lang=${lang}`, {
                    credentials: 'include'
                })
                if (res.ok) {
                    const prompts = await res.json()
                    setStarterPrompts(prompts)
                }
            } catch (e) {
                // Prompts fetch failed
            }
        }
        fetchPrompts()
    }, [quest?.id, lang])

    // Helper to determine if loading/processing
    const isProcessing = status === "submitted" || status === "streaming"

    // Manual Append Implementation with Database Persistence
    const append = async (message: any) => {
        if (!quest?.assistant_id || !studentId) {
            return
        }

        if (QUEST_CHAT_DISABLED) {
            toast.error("Quest chat is temporarily unavailable", {
                description: "We're rebuilding this feature on the new backend. Check back soon.",
            })
            return
        }

        const newMessages = [...messages, message]
        setMessages(newMessages)
        setStatus("submitted")

        // If this is a new conversation, add placeholder to chat history immediately
        const isNewConversation = !currentSessionId
        const tempSessionId = isNewConversation ? `temp-${Date.now()}` : null
        if (isNewConversation && tempSessionId) {
            const placeholderSession: ChatSession = {
                id: tempSessionId,
                title: "New conversation",
                timestamp: new Date(),
                messages: []
            }
            setChatHistory(prev => [placeholderSession, ...prev])
        }

        try {
            // Call the /llm-chat endpoint which handles database persistence
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/llm-chat/chat/completions/`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include", // Include httpOnly cookie for auth
                body: JSON.stringify({
                    user_message_content: message.content,
                    student_id: studentId,
                    quest_id: quest.id, // Link chat session to this quest
                    session_id: currentSessionId,
                    assistant_id: quest.assistant_id, // Pass quest's assistant ID
                    stream: true
                })
            })

            if (!response.ok) {
                throw new Error("Failed to send message")
            }

            if (!response.body) return

            setStatus("streaming")
            const reader = response.body.getReader()
            const decoder = new TextDecoder()

            // Create a placeholder for the assistant response
            const assistantMsgId = Date.now().toString()
            let assistantContent = ""

            setMessages(prev => [...prev, { id: assistantMsgId, role: "assistant", content: "" }])

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value, { stream: true })
                const lines = chunk.split("\n")

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        try {
                            const jsonStr = line.slice(6)
                            if (!jsonStr.trim()) continue

                            const data = JSON.parse(jsonStr)

                            // Capture session_id from backend for subsequent messages
                            if (data.session_id && !currentSessionId) {
                                setCurrentSessionId(data.session_id)
                                // Replace temp session with real session_id
                                if (isNewConversation && tempSessionId) {
                                    setChatHistory(prev => prev.map(h =>
                                        h.id === tempSessionId
                                            ? { ...h, id: data.session_id }
                                            : h
                                    ))
                                }
                            }

                            if (data.content) {
                                assistantContent += data.content
                                setMessages(prev => {
                                    const newMsgs = [...prev]
                                    const lastMsg = newMsgs[newMsgs.length - 1]
                                    if (lastMsg.role === "assistant" && lastMsg.id === assistantMsgId) {
                                        lastMsg.content = assistantContent
                                    }
                                    return newMsgs
                                })
                            }

                            // Update session preview with summary when done
                            if (data.done && data.session_id && data.session_preview) {
                                setChatHistory(prev => prev.map(h =>
                                    h.id === data.session_id
                                        ? { ...h, title: data.session_preview }
                                        : h
                                ))
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }
            setStatus("ready")
        } catch (error) {
            setStatus("ready")
        }
    }

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (inputValue.trim() && !isProcessing && quest?.assistant_id) {
            const userMsg = { id: Date.now().toString(), role: "user", content: inputValue }
            setInputValue("") // Clear input immediately
            append(userMsg)
        }
    }

    const handlePromptClick = (promptText: string) => {
        if (!isProcessing && quest?.assistant_id) {
            const userMsg = { id: Date.now().toString(), role: "user", content: promptText }
            append(userMsg)
        }
    }

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages])

    const handleCopyAssistantMessage = async (content: string) => {
        if (!content) return
        try {
            await navigator.clipboard.writeText(content)
        } catch (e) {
            // Copy failed
        }
    }

    const handleSaveAssistantMessage = (content: string) => {
        if (!content) return
        // Save to project not implemented yet
    }

    // Load User & Chat History from Backend
    useEffect(() => {
        const loadUserAndHistory = async () => {
            try {
                // Get authenticated user/student from backend via httpOnly cookie
                const authData = await apiClient.auth.me()

                if (authData.student) {
                    setStudentId(authData.student.id)
                    setUserName(authData.student.first_name || "Student")
                } else {
                    router.push("/login")
                }
            } catch (e) {
                // Not authenticated, redirecting to login
                try {
                    await apiClient.auth.logout()
                } catch { }
                router.push("/login")
            }
        }
        loadUserAndHistory()
    }, [slug, router])

    // Load chat history when we have both studentId and quest
    useEffect(() => {
        const loadChatHistory = async () => {
            if (!studentId || !quest) return
            try {
                // Load chat sessions for this student filtered by quest
                const sessions = await apiClient.chatSessions.list(studentId, quest.id)
                setChatHistory(
                    sessions.map((s: any) => ({
                        id: s.id,
                        title: s.session_preview || "Chat Session",
                        timestamp: new Date(s.started_at)
                    }))
                )
            } catch (e) {
                // Failed to load chat history
            }
        }
        loadChatHistory()
    }, [studentId, quest])

    useEffect(() => {
        const saved = localStorage.getItem("questChatSidebarCollapsed")
        if (saved === "true") setSidebarCollapsed(true)
    }, [])

    useEffect(() => {
        localStorage.setItem("questChatSidebarCollapsed", String(sidebarCollapsed))
    }, [sidebarCollapsed])

    useEffect(() => {
        const el = historyListRef.current
        if (!el) return

        const update = () => {
            setHistoryHasScrollbar(el.scrollHeight > el.clientHeight)
        }

        update()
        const observer = new ResizeObserver(update)
        observer.observe(el)
        window.addEventListener("resize", update)

        return () => {
            observer.disconnect()
            window.removeEventListener("resize", update)
        }
    }, [chatHistory, sidebarCollapsed])

    // Note: We no longer save to localStorage. Backend persistence happens in append()
    // The currentSessionId is set by the backend when we start chatting

    const handleLoadChat = async (sessionId: string) => {
        // Stop voice mode if active when switching to text chat
        if (isVoiceModeActive) {
            stopVoiceMode()
        }

        try {
            const response = await apiClient.chatSessions.get(sessionId)
            if (response) {
                setCurrentSessionId(sessionId)
                currentSessionIdRef.current = sessionId
                const loadedMessages = (response as any).messages?.map((m: any) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content
                })) || []
                setMessages(loadedMessages)
            }
        } catch (e) {
            // Failed to load chat session
        }
    }

    const handleDeleteChat = (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation() // Prevent card click from triggering
        setConfirmDeleteId(sessionId)
    }

    const confirmDeleteChat = async () => {
        if (!confirmDeleteId) return
        try {
            await apiClient.chatSessions.delete(confirmDeleteId)
            const updatedHistory = chatHistory.filter((session) => session.id !== confirmDeleteId)
            setChatHistory(updatedHistory)
            // If we deleted the current session, clear it
            if (currentSessionId === confirmDeleteId) {
                setCurrentSessionId(null)
                setMessages([])
            }
        } catch (e) {
            // Failed to delete chat session
        } finally {
            setConfirmDeleteId(null)
        }
    }

    const handleNewChat = () => {
        setCurrentSessionId(null) // Backend will create new session
        setMessages([])
        setInputValue("")
    }

    if (!quest) {
        return <div className="h-screen flex items-center justify-center">{t("loadingQuest", lang)}</div>
    }

    const iconSrc = iconSvgMap[quest.icon] || "/icons/glassmorphism/rocket.svg"

    return (
        <div className={`h-screen bg-gradient-to-br ${quest.bg_color || "from-slate-50 to-slate-100"} overflow-hidden flex flex-col`}>
            <DashboardHeader />

            <div className="flex-1 min-h-0 flex overflow-hidden relative">
                {/* Left Sidebar */}
                <div className={`bg-white border-r border-slate-200 transition-all duration-300 ${sidebarCollapsed ? "w-0" : "w-72"} overflow-hidden flex flex-col`}>
                    <div className={`p-4 border-b border-slate-200 bg-gradient-to-br ${quest.bg_color}`}>
                        <h2 className="font-medium text-2xl text-slate-900 flex items-center gap-2 mb-2">
                            <Image src={iconSrc} alt={quest.title} width={24} height={24} className="object-contain" />
                            {quest.title}
                        </h2>
                        <p className="text-sm text-slate-600 ml-8">{quest.description}</p>
                    </div>

                    <div className="p-4 border-b border-slate-200">
                        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t("workspaceTools", lang)}</h3>
                        <Link href="/quests/my-projects">
                            <Button className="w-full justify-start h-auto py-3 bg-slate-900 text-white hover:bg-slate-800">
                                <FolderOpen className="w-5 h-5 mr-3" />
                                <div className="text-left">
                                    <div className="font-semibold">{t("myProjects", lang)}</div>
                                </div>
                            </Button>
                        </Link>
                    </div>

                    <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                        <h3 className="text-sm font-semibold flex items-center gap-2"><History className="w-4 h-4" /> {t("chatHistory", lang)}</h3>
                        <button
                            onClick={handleNewChat}
                            className="group relative w-7 h-7 rounded-md border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50 flex items-center justify-center transition-all"
                            title={t("newChat", lang)}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none">
                                <path stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit="4" d="M10 4c-1.864 0-2.796 0-3.531.304-.98.406-1.759 1.185-2.165 2.165C4 7.204 4 8.136 4 10v3.6c0 2.24 0 3.36.436 4.216.383.753.995 1.365 1.748 1.748C7.04 20 8.16 20 10.4 20h3.6c1.864 0 2.796 0 3.531-.304.98-.406 1.759-1.185 2.165-2.165.304-.735.304-1.667.304-3.531"/>
                                <path stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit="4" d="M19.5 7.5l-7.06 7.06c-.281.281-.663.44-1.06.44H9v-2.38c0-.397.159-.779.44-1.06L16.5 4.5a2.121 2.121 0 113 3z"/>
                            </svg>
                            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                {t("newChat", lang)}
                            </span>
                        </button>
                    </div>
                    <div ref={historyListRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-1">
                        {chatHistory.map((session, index) => (
                            <div
                                key={session.id}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleLoadChat(session.id)
                                }}
                            >
                                <Card
                                    className={`${historyHasScrollbar ? "w-[250px]" : "w-[255px]"} h-[50px] cursor-pointer hover:bg-slate-50 group`}
                                >
                                    <CardContent className="h-full px-2 py-0 flex items-center justify-between">
                                        <div className="flex-1 min-w-0">
                                            <TooltipProvider delayDuration={0}>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <p className="text-sm font-medium truncate leading-none cursor-default">{session.title}</p>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="right" className="max-w-xs">
                                                        <p>{session.title}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                            <p className="text-xs text-slate-500 leading-none">{session.timestamp.toLocaleDateString()}</p>
                                        </div>
                                        <button
                                            onClick={(e) => handleDeleteChat(e, session.id)}
                                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 rounded transition-opacity"
                                            title="Delete chat"
                                        >
                                            <Trash2 className="w-4 h-4 text-red-500" />
                                        </button>
                                    </CardContent>
                                </Card>
                            </div>
                        ))}
                    </div>
                    <div className="p-4">
                        <Card className="border border-slate-200 bg-white">
                            <CardContent className="p-4">
                                <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                                    <Target className="w-4 h-4" />
                                    {t("keySkills", lang)}
                                </h3>
                                <p className="text-xs text-slate-600">{t("mastering", lang)} {quest.title} {t("throughAIProjects", lang)}.</p>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Center Chat */}
                <div className="flex-1 flex flex-col bg-white min-w-0">
                    <div className="flex-1 overflow-y-auto min-h-0">
                        <div className="max-w-3xl mx-auto p-6 space-y-4">
                            {messages.length === 0 && (
                                <div className="py-8">
                                    <div className="text-center mb-8">
                                        <Image src={iconSrc} alt={quest.title} width={64} height={64} className="mx-auto mb-4 object-contain" />
                                        <h2 className="text-2xl font-medium text-slate-900 mb-2">{t("welcomeTo", lang)} {quest.title}!</h2>
                                        <p className="text-slate-600 max-w-xl mx-auto">{t("aiAssistantIntro", lang)}</p>
                                    </div>
                                    {starterPrompts.length > 0 && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
                                            {starterPrompts.map((prompt) => (
                                                <button
                                                    key={prompt.id}
                                                    onClick={() => handlePromptClick(prompt.prompt_text)}
                                                    disabled={isProcessing}
                                                    className={`p-4 text-left rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all text-sm text-slate-700 flex items-start gap-2 ${isProcessing ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                                                >
                                                    <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                                    <span className="line-clamp-2">{prompt.prompt_text}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            {messages.filter(msg => msg.content.trim()).map((message: any) => (
                                <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${message.role === "user" ? "bg-blue-500" : "bg-white border border-slate-200"}`}>
                                        {message.role === "user" ? (
                                            <span className="text-white text-sm">{userName[0]}</span>
                                        ) : (
                                            <Image src={iconSrc} alt={quest.title} width={20} height={20} className="object-contain" />
                                        )}
                                    </div>
                                    <div className="flex-1 max-w-[85%]">
                                        <div className={`rounded-2xl px-4 py-3 ${message.role === "user" ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-900"}`}>
                                            <MarkdownContent content={message.content} />
                                        </div>
                                        {message.role === "assistant" && (
                                            <div className="mt-1 flex justify-start gap-2">
                                                <button
                                                    type="button"
                                                    className="group relative w-6 h-6 rounded border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 flex items-center justify-center"
                                                    title={t("copy", lang)}
                                                    aria-label={t("copy", lang)}
                                                    onClick={() => handleCopyAssistantMessage(message.content)}
                                                >
                                                    <Copy className="w-4 h-4" />
                                                    <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                        {t("copy", lang)}
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`group relative w-6 h-6 rounded border flex items-center justify-center ${speakingMessageId === message.id ? "border-blue-400 text-blue-600 bg-blue-50" : "border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300"}`}
                                                    title={speakingMessageId === message.id ? t("stop", lang) : t("read", lang)}
                                                    aria-label={speakingMessageId === message.id ? t("stop", lang) : t("read", lang)}
                                                    onClick={() => handleSpeak(message.id, message.content)}
                                                >
                                                    {speakingMessageId === message.id ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                                    <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                        {speakingMessageId === message.id ? t("stop", lang) : t("read", lang)}
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="group relative w-6 h-6 rounded border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 flex items-center justify-center"
                                                    title={t("save", lang)}
                                                    aria-label={t("save", lang)}
                                                    onClick={() => handleSaveAssistantMessage(message.content)}
                                                >
                                                    <Save className="w-4 h-4" />
                                                    <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                                                        {t("save", lang)}
                                                    </span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {(status === "submitted" || status === "streaming") && (
                                <div className="flex gap-3">
                                    <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                                        <Image src={iconSrc} alt={quest.title} width={20} height={20} className="object-contain" />
                                    </div>
                                    <div className="bg-slate-100 rounded-2xl px-4 py-3">
                                        <div className="flex gap-1">
                                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    </div>

                    <div className="border-t border-slate-200 bg-white p-4">
                        {voiceError && (
                            <div className="max-w-3xl mx-auto mb-3 text-center text-sm text-red-500">
                                {voiceError}
                            </div>
                        )}

                        {isVoiceModeActive || isConnecting ? (
                            /* Voice Mode UI - Sound Wave Visualization */
                            <div className="flex gap-3 max-w-3xl mx-auto items-center">
                                <div className="flex-1 h-12 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200 flex items-center justify-center gap-1 px-4 overflow-hidden">
                                    {isConnecting ? (
                                        <div className="flex items-center gap-2 text-purple-600">
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            <span className="text-sm">{t("connecting", lang)}</span>
                                        </div>
                                    ) : (
                                        /* Sound wave bars - height based on audio level */
                                        <>
                                            {[...Array(20)].map((_, i) => {
                                                const centerDistance = Math.abs(i - 9.5) / 9.5
                                                const baseHeight = 0.3 + (1 - centerDistance) * 0.4
                                                const dynamicHeight = baseHeight + audioLevel * (1 - centerDistance) * 0.6
                                                const delay = i * 0.05
                                                return (
                                                    <div
                                                        key={i}
                                                        className={`w-1 rounded-full transition-all duration-75 ${
                                                            isSpeaking ? "bg-blue-500" : isRecording ? "bg-purple-500" : "bg-purple-300"
                                                        }`}
                                                        style={{
                                                            height: `${Math.max(8, dynamicHeight * 40)}px`,
                                                            opacity: isSpeaking || isRecording ? 1 : 0.5,
                                                            animation: isSpeaking ? `pulse 0.5s ease-in-out ${delay}s infinite alternate` : undefined
                                                        }}
                                                    />
                                                )
                                            })}
                                            <span className="ml-3 text-sm text-purple-600 whitespace-nowrap">
                                                {isSpeaking ? t("speakingResponse", lang) : isRecording ? t("listening", lang) : `${t("connected", lang)} (${connectionQuality})`}
                                            </span>
                                        </>
                                    )}
                                </div>
                                <Button
                                    type="button"
                                    variant="destructive"
                                    onClick={handleVoiceToggle}
                                    disabled={isConnecting}
                                    className="flex-shrink-0 h-12 px-4"
                                    title={t("endVoiceChat", lang)}
                                >
                                    <MicOff className="w-5 h-5 mr-2" />
                                    {t("endVoiceChat", lang)}
                                </Button>
                            </div>
                        ) : (
                            /* Text Mode UI - Normal Input */
                            <form onSubmit={onSubmit} className="max-w-3xl mx-auto flex gap-2">
                                <Input
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    placeholder={t("typeMessage", lang)}
                                    disabled={isProcessing}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleVoiceToggle}
                                    disabled={isProcessing}
                                    className="flex-shrink-0"
                                    title={t("voiceModeReady", lang)}
                                >
                                    <Mic className="w-4 h-4" />
                                </Button>
                                <Button type="submit" disabled={!inputValue.trim() || isProcessing}>
                                    <Send className="w-4 h-4" />
                                </Button>
                            </form>
                        )}

                        {!isVoiceModeActive && !isConnecting && (
                            <p className="text-xs text-slate-500 mt-2 text-center">
                                {t("textInstructions", lang)}
                            </p>
                        )}
                    </div>
                </div>

                <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="absolute left-0 top-1/2 -translate-y-1/2 bg-white border rounded-r-lg p-2 z-10" style={{ left: sidebarCollapsed ? "0px" : "288px" }}>
                    {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
            </div>

            {confirmDeleteId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-white rounded-lg shadow-lg w-[360px] max-w-[90vw] p-5">
                        <h3 className="text-base font-semibold text-slate-900">{t("deleteChat", lang)}</h3>
                        <p className="text-sm text-slate-600 mt-2">
                            {t("deleteWarning", lang)}
                        </p>
                        <div className="flex justify-end gap-2 mt-4">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setConfirmDeleteId(null)}
                            >
                                {t("cancel", lang)}
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={confirmDeleteChat}
                            >
                                {t("delete", lang)}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
