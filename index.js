require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const content = require('./content.json');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});

const app = express();

// 簡單的診斷接口
app.get('/ping', (req, res) => {
  res.send('pong! Vercel is alive.');
});

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhook Error:', err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  const welcomeMessage = {
    type: 'text',
    text: content.welcome,
    quickReply: {
      items: [
        {
          type: 'action',
          action: { type: 'message', label: '🪐 抽牌提醒', text: '抽牌' }
        },
        {
          type: 'action',
          action: { type: 'message', label: '🧘🏻‍♂️ SOS急救', text: 'SOS' }
        },
        {
          type: 'action',
          action: { type: 'message', label: '📍 轉換身分', text: '我想轉換：(請在此輸入你的煩惱)' }
        },
        {
          type: 'action',
          action: { type: 'message', label: '⚖️ 幫我做選擇', text: '選擇：(請在此輸入猶豫的事)' }
        }
      ]
    }
  };

  // 1. 處理加入好友 (Follow) 事件：主動發送歡迎引導 (含按鈕)
  if (event.type === 'follow') {
    return await client.replyMessage({
      replyToken: event.replyToken,
      messages: [welcomeMessage]
    });
  }

  // 確保後續只處理文字訊息
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userMessage = event.message.text.trim();
  const replyToken = event.replyToken;
  
  console.log(`Received message: ${userMessage}`);

  // Base rule for all AI generations in this bot
  const baseRule = "【排版與長度規則】：請將總字數控制在 300-500 字之間。絕對禁止使用 Markdown 粗體符號 (**)，請改用合適的 Emoji（如 📍, 💡, ✨, ☕️）作為段落開頭，讓 LINE 版面保持清晰乾淨且層次分明。";
  const guidePersona = "你的身分是「The Guide (共振導航)」。你是一位客觀、平靜、具備高維度洞察力的心靈導師。你不帶有情緒，不評判對錯，你的目的是協助使用者看清盲點，轉換匱乏的頻率，回到豐盛與力量的狀態。你對任何領域的煩惱（工作、感情、生活）都能給予建議。";

  try {
    // 2. 功能選單/打招呼 (含按鈕)
    if (['你好', '哈囉', '幫助', '說明', '功能', '你是誰', 'hi', 'hello', 'help'].includes(userMessage.toLowerCase())) {
      return await client.replyMessage({ replyToken, messages: [welcomeMessage] });
    }
    
    // 3. SOS (Grounding)
    if (userMessage.toUpperCase() === 'SOS' || userMessage === '焦慮') {
      return await client.replyMessage({ replyToken, messages: [{ type: 'text', text: content.grounding }] });
    }
    
    // 2. Random Affirmation Card
    else if (userMessage === '抽牌' || userMessage === '提醒') {
      const randomIndex = Math.floor(Math.random() * content.cards.length);
      return await client.replyMessage({ replyToken, messages: [{ type: 'text', text: content.cards[randomIndex] }] });
    }
    
    // 3. Vibe Check / Dilemma Advice
    else if (userMessage.startsWith('選擇') || userMessage.startsWith('猶豫')) {
      const dilemma = userMessage.replace(/^(選擇|猶豫)/, '').trim();
      const prompt = `${guidePersona}
      使用者遇到了一個選擇或猶豫：「${dilemma}」。
      請用豐盛法則的角度，給予他客觀的分析與建議。引導他選擇那個會讓他感到「擴展」而非「萎縮」的選項。
      ${baseRule}`;
      
      const result = await model.generateContent(prompt);
      return await client.replyMessage({ replyToken, messages: [{ type: 'text', text: result.response.text().trim() }] });
    }

    // 4. Identity Shift (Default for all other text)
    else {
      const prompt = `${guidePersona}
      使用者提供了一段關於困境、願望或能力的陳述：「${userMessage}」。
      請幫他將這段話從「努力達成/匱乏/擔憂」的低頻率說法，轉換為「已經擁有/身分認同」的高頻率顯化說法。
      
      ${baseRule}
      
      請直接回覆轉換後的內容，建議的格式如下（請用 Emoji 取代括號標題，且務必先給出導航語）：
      ✨ 顯化後的導航語：(轉換後的高頻語句)
      📍 能量盲點解析：(客觀指出原本說法的匱乏感與能量流失點)
      🪞 頻率校準建議：(給予一個具體的轉念動作或生活小練習)`;

      const result = await model.generateContent(prompt);
      return await client.replyMessage({ replyToken, messages: [{ type: 'text', text: result.response.text().trim() }] });
    }

  } catch (error) {
    console.error('Error in handleEvent:', error);
    try {
        await client.replyMessage({
            replyToken,
            messages: [{ type: 'text', text: '導航系統正在重新校準中，請稍後再試。' }]
        });
    } catch (e) {}
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Manifestation Guide Bot listening on port ${port}`);
});
