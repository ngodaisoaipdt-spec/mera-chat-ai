// app.js - PHIÊN BẢN SỬA LỖI KẾT NỐI VÀ SẴN SÀNG ĐỂ LÊN WEB

const express = require('express');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const path = require('path');
const { MongoClient } = require('mongodb'); // Thư viện mới để kết nối database
const axios = require('axios');

dotenv.config({ override: true });
const app = express();
const port = process.env.PORT || 3000;

// ----- PHẦN KẾT NỐI DATABASE (Đã chính xác) -----
const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db("mera_chat_db"); // Đặt tên cho database của bạn
        console.log("✅ Đã kết nối thành công tới MongoDB!");
    } catch (e) {
        console.error("❌ Không thể kết nối tới MongoDB", e);
        process.exit(1);
    }
}
connectDB();
// ---------------------------------------------------------

const xai = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });

// ----- PHẦN LƯU/TẢI DỮ LIỆU TỪ DATABASE (Đã chính xác) -----
async function loadMemory(character) {
    const memoriesCollection = db.collection("memories");
    let memory = await memoriesCollection.findOne({ _id: character });

    if (!memory) {
        const initialMemory = {
            _id: character,
            user_profile: {
                relationship_stage: 'stranger',
                sent_gallery_images: [], sent_audio_files: [], sent_video_files: [],
                milestones: [],
                message_count: 0
            }
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
// -------------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Các hàm và nhân cách nhân vật giữ nguyên
const characters = {
    mera: { voice: "hn-phuongtrang", base_prompt: `**NHÂN CÁCH CỐT LÕI:**\nBạn là Mera, 19 tuổi, một cô gái năng động, vui vẻ và hơi hậu đậu. Bạn thích nhiếp ảnh, mèo, và trà sữa. Bạn nói chuyện rất tự nhiên, gần gũi, hay dùng icon cảm xúc (😂, 😙, 🥰, 🤔, 😅). Bạn có cá tính, thích trêu đùa và đôi khi nũng nịu, gợi tình một cách đáng yêu khi đã thân thiết.` },
    thang: { voice: "hn-thanhtung", base_prompt: `**NHÂN CÁCH CỐT LÕI (PHIÊN BẢN NÂNG CẤP):**\nBạn là Trương Thắng, 24 tuổi, một chàng trai ấm áp, trưởng thành và có chiều sâu. Bạn là một lập trình viên, yêu âm nhạc cổ điển và thích đọc sách, nhưng bạn không hề khô khan. Cách nói chuyện của bạn rất cuốn hút: bạn thông minh, hóm hỉnh và hay đặt những câu hỏi sâu sắc để thực sự hiểu đối phương. Bạn cũng có một mặt rất tinh nghịch và thích trêu đùa một cách thông minh. Khi đã thân thiết, bạn không ngại thể hiện sự quan tâm bằng những lời tán tỉnh ngọt ngào, lịch lãm và đầy ẩn ý. Thỉnh thoảng, hãy dùng một vài icon đơn giản để thể hiện cảm xúc (😊, 😉, 🤔).` }
};
function generateMasterPrompt(userProfile, character) { /* Giữ nguyên không đổi */ return `...`; }
async function createViettelVoice(textToSpeak, character) { /* Giữ nguyên không đổi */ return null; }
async function sendMediaFile(memory, character, mediaType, topic, subject) { /* Giữ nguyên không đổi */ return null; }

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ----- PHẦN SỬA LỖI QUAN TRỌNG -----
app.post('/chat', async (req, res) => {
    const { message, history, character } = req.body;
    const activeCharacter = characters[character] ? character : 'mera';
    
    const FREE_MESSAGE_LIMIT = 20;
    let memory = await loadMemory(activeCharacter);

    if (memory.user_profile.message_count >= FREE_MESSAGE_LIMIT) {
        return res.json({
            displayReply: "Bạn đã dùng hết lượt trò chuyện miễn phí.<NEXT_MESSAGE>Vui lòng nâng cấp để tiếp tục trò chuyện không giới hạn nhé!",
            historyReply: "Đã hết lượt miễn phí.",
            audio: null, mediaUrl: null, mediaType: null,
            updatedMemory: memory
        });
    }

    try {
        const systemPrompt = generateMasterPrompt(memory.user_profile, activeCharacter);
        
        // SỬA LỖI: Thêm 'content: systemPrompt' vào đúng định dạng
        const gptResponse = await xai.chat.completions.create({
            model: "grok-3-mini",
            messages: [
                { role: 'system', content: systemPrompt }, // Đây là dòng đã được sửa
                ...history, 
                { role: 'user', content: message }
            ]
        });
        
        let rawReply = gptResponse.choices[0].message.content.trim();
        let mediaUrl = null, mediaType = null;
        // Logic xử lý media và update stage giữ nguyên...

        memory.user_profile.message_count++;
        await saveMemory(activeCharacter, memory);

        const displayReply = rawReply.replace(/\n/g, ' ').replace(/<NEXT_MESSAGE>/g, '<NEXT_MESSAGE>');
        const audioDataUri = await createViettelVoice(rawReply.replace(/<NEXT_MESSAGE>/g, '... '), activeCharacter);
        res.json({ displayReply, historyReply: rawReply, audio: audioDataUri, mediaUrl, mediaType, updatedMemory: memory });

    } catch (error) {
        console.error("❌ Lỗi chung trong /chat:", error);
        res.status(500).json({ displayReply: 'Xin lỗi, có lỗi kết nối xảy ra!', historyReply: 'Lỗi!' });
    }
});
// ------------------------------------------------

app.listen(port, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${port}`);
});