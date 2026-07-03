const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'canvas_data.json');

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const MAX_WIDTH = 4000;
const MAX_HEIGHT = 4000;

// 💡 그림 데이터와 커스텀 색상 데이터를 함께 관리할 저장소
let serverData = {
    canvasMatrix: {},
    customColors: [] // 유저들이 추가한 헥사코드가 저장될 배열
};

function loadCanvasData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const fileData = fs.readFileSync(DATA_FILE, 'utf8');
            serverData = JSON.parse(fileData);
            // 옛날 데이터 포맷 호환성 유지용 안전장치
            if (!serverData.canvasMatrix) {
                serverData = { canvasMatrix: serverData, customColors: [] };
            }
            console.log('💾 [성공] 캔버스 및 팔레트 데이터를 불러왔습니다.');
        } else {
            console.log('📝 [안내] 새 데이터를 생성합니다.');
        }
    } catch (err) {
        console.error('❌ 데이터 로드 중 오류 발생:', err);
    }
}

function saveCanvasData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(serverData), 'utf8');
    } catch (err) {
        console.error('❌ 데이터 저장 중 오류 발생:', err);
    }
}

loadCanvasData();

io.on('connection', (socket) => {
    // 💡 접속 시 픽셀 데이터와 저장된 커스텀 색상 리스트를 함께 내려줌
    socket.emit('initCanvas', { 
        width: MAX_WIDTH, 
        height: MAX_HEIGHT, 
        matrix: serverData.canvasMatrix,
        customColors: serverData.customColors 
    });

    socket.on('drawPixel', (data) => {
        const { x, y, color } = data;
        if (x >= 0 && x < MAX_WIDTH && y >= 0 && y < MAX_HEIGHT) {
            const key = `${x},${y}`;
            if (color === 'transparent') {
                delete serverData.canvasMatrix[key];
            } else {
                serverData.canvasMatrix[key] = color;
            }
            io.emit('updatePixel', { x, y, color });
            saveCanvasData(); 
        }
    });

    // 💡 누군가 새로운 헥사코드를 추가했을 때 처리
    socket.on('newColorAdded', (hexColor) => {
        if (!serverData.customColors.includes(hexColor)) {
            serverData.customColors.push(hexColor);
            // 다른 모든 접속자에게도 이 색상이 추가되었다고 실시간 전송
            io.emit('syncNewColor', hexColor);
            saveCanvasData();
        }
    });
});

server.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(` 🚀 픽셀 및 팔레트 통합 영구 저장 활성화 완료!`);
    console.log(`=============================================`);
});