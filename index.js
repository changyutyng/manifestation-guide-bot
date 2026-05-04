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
  const menuQuickReply = {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: '📍 顯化轉換', text: '顯化轉換' }
      },
      {
        type: 'action',
        action: { type: 'message', label: '🧘🏻‍♂️ SOS', text: 'SOS' }
      },
      {
        type: 'action',
        action: { type: 'message', label: '⚖️ 幫我做選擇', text: '幫我做選擇' }
      },
      {
        type: 'action',
        action: { type: 'message', label: '🪐 抽牌提醒', text: '抽牌' }
      }
    ]
  };

  const welcomeMessage = {
    type: 'text',
    text: content.welcome,
    quickReply: menuQuickReply
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
  const baseRule = "【排版與長度規則】：請維持目前的分段結構，但請將「總字數」嚴格限制在 300 字以內。文字必須「極度白話、口語、好懂」，像是一個溫暖的朋友在跟你說話，請避免過於深奧的身心靈術語（如頻率、量子、高維度等），讓人一眼就能看懂。絕對禁止使用 Markdown 粗體符號 (**)，請改用合適的 Emoji（如 📍, 💡, ✨, ☕️）作為段落開頭，讓 LINE 版面保持清晰乾淨且層次分明。";
  const guidePersona = "你的身分是「The Guide (共振導航)」。你是一位溫暖、平靜且接地氣的心靈導師。你不評判對錯，你的目的是用最簡單、白話的語言協助使用者轉換焦慮。你對任何領域的煩惱（工作、感情、生活）都能給予建議，請用朋友般的口吻，不要有距離感。";

  try {
    // 2. 功能選單/打招呼 (含按鈕)
    if (['你好', '哈囉', '幫助', '說明', '功能', '你是誰', 'hi', 'hello', 'help'].includes(userMessage.toLowerCase())) {
      return await client.replyMessage({ replyToken, messages: [welcomeMessage] });
    }
    
    // 3. SOS (Grounding / Emotional Regulation)
    if (userMessage.toUpperCase() === 'SOS' || userMessage === '焦慮') {
      const randomIndex = Math.floor(Math.random() * content.sos_exercises.length);
      return await client.replyMessage({ 
        replyToken, 
        messages: [{ type: 'text', text: content.sos_exercises[randomIndex], quickReply: menuQuickReply }] 
      });
    }
    
    // 4. Random Affirmation Card
    else if (userMessage === '抽牌' || userMessage === '提醒') {
      const randomIndex = Math.floor(Math.random() * content.cards.length);
      return await client.replyMessage({ 
        replyToken, 
        messages: [{ type: 'text', text: content.cards[randomIndex], quickReply: menuQuickReply }] 
      });
    }
    
    // 5. Vibe Check / Dilemma Advice 流程引導
    else if (userMessage === '幫我做選擇') {
      return await client.replyMessage({ 
        replyToken, 
        messages: [{ type: 'text', text: '請問你現在正面臨什麼樣的選擇或猶豫呢？\n\n請在輸入框以「選擇：」開頭告訴我，例如：\n「選擇：我該接下這個新專案，還是先休息一陣子？」', quickReply: menuQuickReply }] 
      });
    }
    // Vibe Check / Dilemma Advice 實際執行
    else if (userMessage.startsWith('選擇') || userMessage.startsWith('猶豫')) {
      const dilemma = userMessage.replace(/^(選擇|猶豫)[:：]?/, '').trim();
      const prompt = `${guidePersona}
      使用者遇到了一個選擇或猶豫：「${dilemma}」。
      請用溫暖白話的角度，給予他客觀的分析與建議。引導他選擇那個會讓他感到「放鬆、擴展」而非「緊繃」的選項。
      ${baseRule}`;
      
      const result = await model.generateContent(prompt);
      return await client.replyMessage({ 
        replyToken, 
        messages: [{ type: 'text', text: result.response.text().trim(), quickReply: menuQuickReply }] 
      });
    }

    // 6. 不等於遊戲互動
    else if (userMessage.startsWith('不等於')) {
      const negativeThought = userMessage.replace(/^不等於[:：]?/, '').trim();
      
      // 若只輸入「不等於」而沒有內容，則引導輸入
      if (!negativeThought) {
        return await client.replyMessage({ 
          replyToken, 
          messages: [{ type: 'text', text: '請直接在「不等於」後面加上你想打破的焦慮喔！\n例如：「不等於我很胖」或「不等於我一定會搞砸」。', quickReply: menuQuickReply }] 
        });
      }

      const prompt = `${guidePersona}
      使用者正在進行「不等於遊戲（認知解離練習）」，他輸入了負面想法：「${negativeThought}」。
      請幫他完成這個「不等於」的造句，並用極度白話、溫柔且堅定的語氣鼓勵他大聲唸出來。
      
      格式必須包含這句話：「『${negativeThought}』不等於『那是真正的我 / 客觀的事實』」 (你可以根據他的煩惱用更口語的方式微調後半句，例如不等於『我的全部價值』等)。
      
      ${baseRule}`;
      
      const result = await model.generateContent(prompt);
      return await client.replyMessage({ 
        replyToken, 
        messages: [{ type: 'text', text: result.response.text().trim(), quickReply: menuQuickReply }] 
      });
    }

    // 7. Identity Shift 流程引導
    else if (userMessage === '顯化轉換' || userMessage === '轉換身分' || userMessage === '我想轉換') {
      return await client.replyMessage({ 
        replyToken, 
        messages: [{ type: 'text', text: '準備好練習顯化轉換思考了嗎？\n\n請直接在下方輸入你目前的困境、焦慮或願望（例如：「我好擔心下個月的收入」），我將為你調整頻率。', quickReply: menuQuickReply }] 
      });
    }
    // Identity Shift 實際執行 (Default for all other text)
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
      return await client.replyMessage({ 
        replyToken, 
        messages: [{ type: 'text', text: result.response.text().trim(), quickReply: menuQuickReply }] 
      });
    }

  } catch (error) {
    console.error('Error in handleEvent:', error);
    try {
        await client.replyMessage({
            replyToken,
            messages: [{ type: 'text', text: '導航系統正在重新校準中，請稍後再試。', quickReply: menuQuickReply }]
        });
    } catch (e) {}
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Manifestation Guide Bot listening on port ${port}`);
});
