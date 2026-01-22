/**
 * おしゃべりワンコ AI - メインロジック
 */

// APIキーを設定（Google AI Studioで取得したキーをここに入れてください）
const apiKey = "AIzaSyDxqNGI38bRSGhWaX2WNfwgOuVQfMa4nu4"; 
let isProcessing = false;

// DOM要素の取得
const setupScreen = document.getElementById('setup-screen');
const chatScreen = document.getElementById('chat-screen');
const startChatBtn = document.getElementById('start-chat-btn');
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const typingIndicator = document.getElementById('typing-indicator');
const resetBtn = document.getElementById('reset-btn');
const errorToast = document.getElementById('error-toast');

/**
 * エラーメッセージの表示
 */
function showError(msg) {
    errorToast.textContent = msg || "エラーが発生しました。";
    errorToast.classList.remove('hidden');
    setTimeout(() => errorToast.classList.add('hidden'), 3000);
}

/**
 * 指数バックオフ付きフェッチ
 */
async function fetchWithRetry(url, options, retries = 5) {
    let delay = 1000;
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return await response.json();
            
            // レート制限(429)の場合はリトライ
            if (response.status === 429) {
                await new Promise(res => setTimeout(res, delay));
                delay *= 2;
                continue;
            }
            throw new Error(`HTTP ${response.status}`);
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }
}

/**
 * Gemini APIを使用してイヌの返答を取得
 */
async function getDogResponse(message) {
    const systemPrompt = `あなたは飼い主に忠実で可愛いイヌです。
    名前は「ワンコ」です。
    返答は短く、親しみやすく、語尾に「ワン！」「だワン！」「クゥ〜ン」を付けてください。
    人間のような言葉を話しつつも、イヌらしい素直な感情を表現してください。`;

    try {
        const result = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: message }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] }
            })
        });
        return result.candidates?.[0]?.content?.parts?.[0]?.text || "ワン！(返信に失敗したワン...)";
    } catch (error) {
        showError("ワンコの返信が届かなかったワン...");
        return "ワンワン！(通信エラーだワン！)";
    }
}

/**
 * Gemini TTSを使用して音声を再生
 */
async function speak(text) {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Say this like a cute happy dog: ${text}` }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } }
                },
                model: "gemini-2.5-flash-preview-tts"
            })
        });

        const result = await response.json();
        const audioData = result.candidates[0].content.parts[0].inlineData.data;
        const sampleRateMatch = result.candidates[0].content.parts[0].inlineData.mimeType.match(/rate=(\d+)/);
        const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1]) : 24000;
        playPcm16(audioData, sampleRate);
    } catch (e) { 
        console.error("TTS error", e); 
    }
}

/**
 * PCM16データをWAVに変換して再生
 */
function playPcm16(base64Data, sampleRate) {
    const binaryString = window.atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    
    const pcm16 = new Int16Array(bytes.buffer);
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    
    const writeString = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    
    writeString(0, 'RIFF'); 
    view.setUint32(4, 36 + pcm16.length * 2, true);
    writeString(8, 'WAVE'); 
    writeString(12, 'fmt '); 
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); 
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); 
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); 
    view.setUint16(34, 16, true);
    writeString(36, 'data'); 
    view.setUint32(40, pcm16.length * 2, true);
    
    const blob = new Blob([wavHeader, pcm16], { type: 'audio/wav' });
    const audio = new Audio(URL.createObjectURL(blob));
    audio.play();
}

/**
 * チャット画面にメッセージを追加
 */
function addMessage(text, isUser = false) {
    const div = document.createElement('div');
    div.className = `flex ${isUser ? 'justify-end' : 'justify-start'}`;
    
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble max-w-[85%] p-4 shadow-sm ${isUser ? 'bg-[#d4a373] text-white bubble-right' : 'bg-white text-gray-800 bubble-left border border-gray-100'}`;
    bubble.textContent = text;
    
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * メッセージ送信処理
 */
async function handleSendMessage() {
    const text = userInput.value.trim();
    if (!text || isProcessing) return;

    isProcessing = true;
    sendBtn.disabled = true;
    userInput.value = '';
    addMessage(text, true);

    typingIndicator.classList.remove('hidden');
    const response = await getDogResponse(text);
    typingIndicator.classList.add('hidden');

    addMessage(response);
    speak(response);
    
    isProcessing = false;
    sendBtn.disabled = false;
}

// --- イベントリスナー ---

startChatBtn.addEventListener('click', () => {
    setupScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    chatScreen.classList.add('flex');
    
    const greeting = "クゥ〜ン... あ！来てくれたんだね！はじめましてだワン！これからよろしくね！";
    addMessage(greeting);
    speak(greeting);
});

sendBtn.addEventListener('click', handleSendMessage);

userInput.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') handleSendMessage(); 
});

resetBtn.addEventListener('click', () => { 
    if (confirm('最初に戻りますか？')) location.reload(); 
});
