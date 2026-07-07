const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// 1. MongoDB 연결 설정
if (!MONGO_URI) {
    console.error("❌ 에러: Render 환경 변수에 MONGO_URI가 설정되지 않았습니다!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log("✔ MongoDB에 성공적으로 연결되었습니다! Data가 안전하게 보호됩니다."))
    .catch(err => console.error("❌ MongoDB 연결 실패:", err));

// 2. MongoDB 스키마 및 모델 정의
const pixelSchema = new mongoose.Schema({
    coordinate: { type: String, unique: true }, // "x,y" 형식의 고유 키
    x: Number,
    y: Number,
    color: String
});
const Pixel = mongoose.model('Pixel', pixelSchema);

// 팔레트 색상 저장용 스키마
const colorSchema = new mongoose.Schema({
    hex: { type: String, unique: true }
});
const CustomColor = mongoose.model('CustomColor', colorSchema);

// 공유 도안(템플릿) 저장용 스키마
const templateSchema = new mongoose.Schema({
    name: String,         
    imgData: String,      // Base64 이미지 데이터 (원본 소스)
    createdAt: { type: Date, default: Date.now }
});
const Template = mongoose.model('Template', templateSchema);

// 3. 미들웨어 및 라우팅 설정
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 4. Socket.io 실시간 통신 설정
io.on('connection', async (socket) => {
    console.log('📡 새로운 유저가 월드에 접속했습니다.');

    try {
        const pixels = await Pixel.find({});
        let matrix = {};
        pixels.forEach(p => {
            matrix[p.coordinate] = p.color;
        });

        const colors = await CustomColor.find({});
        let customColors = colors.map(c => c.hex);

        const templates = await Template.find({}).sort({ createdAt: -1 });

        socket.emit('initCanvas', { matrix, customColors, templates });
    } catch (err) {
        console.error("데이터 로딩 중 에러 발생:", err);
    }

    socket.on('drawPixel', async (data) => {
        const { x, y, color } = data;
        const coordinate = `${x},${y}`;

        socket.broadcast.emit('updatePixel', data);

        try {
            if (color === 'transparent') {
                await Pixel.deleteOne({ coordinate });
            } else {
                await Pixel.updateOne(
                    { coordinate },
                    { x, y, color },
                    { upsert: true }
                );
            }
        } catch (err) {
            console.error("픽셀 저장 중 에러 발생:", err);
        }
    });

    socket.on('newColorAdded', async (hexValue) => {
        socket.broadcast.emit('syncNewColor', hexValue);
        try {
            await CustomColor.updateOne({ hex: hexValue }, { hex: hexValue }, { upsert: true });
        } catch (err) {
            console.error("색상 저장 중 에러 발생:", err);
        }
    });

    // 💡 수정됨: 유저가 서버에 새 도안을 업로드할 때 중복 여부 체크
    socket.on('uploadTemplate', async (tData) => {
        try {
            // 동일한 이미지 파일(Base64 문자열 일치)이 있는지 먼저 조회합니다.
            const existingTemplate = await Template.findOne({ imgData: tData.imgData });
            
            if (existingTemplate) {
                // 이미 존재한다면 새로 저장하지 않고 기존 데이터를 다시 모든 유저에게 보내 UI 리프레시 유도
                io.emit('newTemplateAdded', existingTemplate);
                return;
            }

            // 중복되지 않은 도안일 때만 새로 생성 및 저장
            const newTemplate = new Template({
                name: tData.name,
                imgData: tData.imgData
            });
            await newTemplate.save();

            io.emit('newTemplateAdded', newTemplate);
        } catch (err) {
            console.error("도안 업로드 중 에러 발생:", err);
        }
    });

    socket.on('disconnect', () => {
        console.log('💤 유저가 나갔습니다.');
    });
});

server.listen(PORT, () => {
    console.log(`🚀 서버가 포트 ${PORT}에서 정상 작동 중입니다!`);
});
