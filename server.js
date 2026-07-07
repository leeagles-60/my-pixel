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

// 신설: 공유 도안(템플릿) 저장용 스키마
const templateSchema = new mongoose.Schema({
    name: String,         // 도안 이름
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
        // DB에서 기존 픽셀 데이터 로딩
        const pixels = await Pixel.find({});
        let matrix = {};
        pixels.forEach(p => {
            matrix[p.coordinate] = p.color;
        });

        // DB에서 추가된 커스텀 색상 로딩
        const colors = await CustomColor.find({});
        let customColors = colors.map(c => c.hex);

        // 신설: DB에서 공유된 도안 목록 로딩
        const templates = await Template.find({}).sort({ createdAt: -1 });

        // 처음 접속한 유저에게 캔버스 초기 데이터, 커스텀 색상, 공유 도안 전달
        socket.emit('initCanvas', { matrix, customColors, templates });
    } catch (err) {
        console.error("데이터 로딩 중 에러 발생:", err);
    }

    // 유저가 점을 찍었을 때
    socket.on('drawPixel', async (data) => {
        const { x, y, color } = data;
        const coordinate = `${x},${y}`;

        // 다른 접속자들에게 실시간 브로드캐스팅
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

    // 유저가 새로운 헥스 코드를 팔레트에 추가했을 때
    socket.on('newColorAdded', async (hexValue) => {
        socket.broadcast.emit('syncNewColor', hexValue);
        try {
            await CustomColor.updateOne({ hex: hexValue }, { hex: hexValue }, { upsert: true });
        } catch (err) {
            console.error("색상 저장 중 에러 발생:", err);
        }
    });

    // 신설: 유저가 서버에 새 도안을 업로드(공유)했을 때
    socket.on('uploadTemplate', async (tData) => {
        try {
            const newTemplate = new Template({
                name: tData.name,
                imgData: tData.imgData
            });
            await newTemplate.save();

            // 모든 유저(나 포함)에게 새 도안 공유 및 갤러리 갱신 요구
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
