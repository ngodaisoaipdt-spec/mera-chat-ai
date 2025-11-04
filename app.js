// app.js - PHIÊN BẢN SỬA LỖI CUỐI CÙNG (RACE CONDITION)

const express = require('express');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const path = require('path');
const { MongoClient } = require('mongodb');
const axios = require('axios');

dotenv.config({ override: true });
const app = express();
const port = process.env.PORT || 3000;

const client = new MongoClient(process.env.MONGODB_URI);
let db;

// ----- PHẦN SỬA LỖI CUỐI CÙNG: ĐẢM BẢO KẾT NỐI DB TRƯỚC KHI CHẠY SERVER -----
async function startServer() {
    try {
        // 1. Kết nối tới Database và chờ cho đến khi thành công
        await client.connect();
        db = client.db("mera_chat_db");
        console.log("✅ Đã kết nối thành công tới MongoDB!");

        // 2. SAU KHI kết nối thành công, MỚI bắt đầu chạy server
        app.listen(port, () => {
            console.log(`🚀 Server đang chạy tại cổng ${port}`);
        });

    } catch (e) {
        console.error("❌ Không thể kết nối tới MongoDB hoặc khởi động server", e);
        process.exit(1);
    }
}

// Bắt đầu toàn bộ quá trình
startServer();
// --------------------------------------------------------------------------


// Các hàm load/save memory giữ nguyên, giờ chúng sẽ hoạt động vì 'db' đã được khởi tạo
async function loadMemory(character) {
    const memoriesCollection = db.collection("memories");
    let memory = await memoriesCollection.findOne({ _id: character });
    if (!memory) {
        const initialMemory = {
            _id: character,
            user_profile: { message_count: 0 /* ...các trường khác */ }
        };
        await memoriesCollection.insertOne(initialMemory);
        return initialMemory;
    }
    if (memory.user_profile.message_count === undefined) {
        memory.user_profile.message_count = 0;
    }
    return memory;
}
async function saveMemory(character, memory) {
    const memoriesCollection = db.collection("memories");
    await memoriesCollection.replaceOne({ _id: character }, memory, { upsert: true });
}


app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Các hàm và nhân cách nhân vật giữ nguyên không đổi
const characters = { /* ... */ };
function generateMasterPrompt(userProfile, character) { /* ... */ }
async function createViettelVoice(textToSpeak, character) { /* ... */ }
async function sendMediaFile(memory, character, mediaType, topic, subject) { /* ... */ }

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Logic chat giữ nguyên không đổi
app.post('/chat', async (req, res) => {
    // ... toàn bộ logic chat của bạn ở đây ...
    const { message, history, character } = req.body;
    const activeCharacter = characters[character] ? character : 'mera';
    const FREE_MESSAGE_LIMIT = 20;
    let memory = await loadMemory(activeCharacter);

    if (memory.user_profile.message_count >= FREE_MESSAGE_LIMIT) {
        return res.json({
            displayReply: "Bạn đã dùng hết lượt trò chuyện miễn phí.<NEXT_MESSAGE>Vui lòng nâng cấp để tiếp tục trò chuyện không giới hạn nhé!",
            historyReply: "Đã hết lượt miễn phí.",
        });
    }
    
    try {
        const systemPrompt = generateMasterPrompt(memory.user_profile, activeCharacter);
        const gptResponse = await xai.chat.completions.create({ model: "grok-3-mini", messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: message }]});
        let rawReply = gptResponse.choices[0].message.content.trim();
        
        memory.user_profile.message_count++;
        await saveMemory(activeCharacter, memory);

        const displayReply = rawReply.replace(/\n/g, ' ').replace(/<NEXT_MESSAGE>/g, '<NEXT_MESSAGE>');
        const audioDataUri = await createViettelVoice(rawReply.replace(/<NEXT_MESSAGE>/g, '... '), activeCharacter);
        res.json({ displayReply, historyReply: rawReply, audio: audioDataUri, updatedMemory: memory });

    } catch (error) {
        console.error("❌ Lỗi chung trong /chat:", error);
        res.status(500).json({ displayReply: 'Xin lỗi, có lỗi kết nối xảy ra!', historyReply: 'Lỗi!' });
    }
});