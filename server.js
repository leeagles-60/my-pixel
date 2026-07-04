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

// 2. MongoDB 스키마 및 모델 정의 (픽셀 저장용)
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

// 정적 파일 서빙 (index.html이 있는 폴더 위치 지정)
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. 소켓 통신 및 실시간 연동
io.on('connection', async (socket) => {
    console.log('🎈 새로운 유저가 접속했습니다.');

    try {
        // DB에서 기존 픽셀 데이터 전부 긁어오기
        const pixels = await Pixel.find({});
        const matrix = {};
        pixels.forEach(p => {
            matrix[p.coordinate] = p.color;
        });

        // DB에서 커스텀 팔레트 색상 가져오기
        const colors = await CustomColor.find({});
        const customColors = colors.map(c => c.hex);

        // 처음 접속한 유저에게 캔버스 초기 데이터 전송
        socket.emit('initCanvas', { matrix, customColors });
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
                // 지우개질을 하면 DB에서 삭제
                await Pixel.deleteOne({ coordinate });
            } else {
                // 이미 찍힌 좌표면 색상 업데이트, 새 좌표면 새로 생성 (Upsert)
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

    socket.on('disconnect', () => {
        console.log('💤 유저가 나갔습니다.');
    });
});

server.listen(PORT, () => {
    console.log(`🚀 서버가 포트 ${PORT}에서 작동 중입니다...`);
});
