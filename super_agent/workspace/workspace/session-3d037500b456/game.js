// 游戏常量配置
const BOARD_SIZE = 8;
const GEM_TYPES = [
    { type: 'red', emoji: '💎', color: 'gem-red' },
    { type: 'blue', emoji: '💙', color: 'gem-blue' },
    { type: 'green', emoji: '💚', color: 'gem-green' },
    { type: 'yellow', emoji: '⭐', color: 'gem-yellow' },
    { type: 'purple', emoji: '🔮', color: 'gem-purple' },
    { type: 'orange', emoji: '🧡', color: 'gem-orange' },
    { type: 'pink', emoji: '💗', color: 'gem-pink' },
    { type: 'cyan', emoji: '💠', color: 'gem-cyan' }
];

const GAME_MODES = {
    CLASSIC: 'classic',
    TIMED: 'timed',
    LEVEL: 'level'
};

const MODE_NAMES = {
    'classic': '经典模式',
    'timed': '限时模式',
    'level': '关卡模式'
};

// 游戏状态
class GameState {
    constructor() {
        this.board = [];
        this.score = 0;
        this.moves = Infinity;
        this.currentMode = null;
        this.selectedGem = null;
        this.isAnimating = false;
        this.isPaused = false;
        this.comboCount = 0;
        this.timer = 60;
        this.timerInterval = null;
        this.level = 1;
        this.targetScore = 1000;
        this.powerups = {
            bomb: 3,
            shuffle: 2,
            hint: 5,
            colorBomb: 1
        };
        this.activePowerup = null;
    }

    reset() {
        this.score = 0;
        this.moves = Infinity;
        this.selectedGem = null;
        this.isAnimating = false;
        this.isPaused = false;
        this.comboCount = 0;
        this.powerups = {
            bomb: 3,
            shuffle: 2,
            hint: 5,
            colorBomb: 1
        };
        this.activePowerup = null;
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
}

const gameState = new GameState();

// DOM 元素
const elements = {
    modeSelection: document.getElementById('modeSelection'),
    gameContainer: document.getElementById('gameContainer'),
    board: document.getElementById('board'),
    score: document.getElementById('score'),
    moves: document.getElementById('moves'),
    timer: document.getElementById('timer'),
    level: document.getElementById('level'),
    target: document.getElementById('target'),
    currentMode: document.getElementById('currentMode'),
    gameOver: document.getElementById('gameOver'),
    pauseMenu: document.getElementById('pauseMenu'),
    comboDisplay: document.getElementById('comboDisplay'),
    timerContainer: document.getElementById('timerContainer'),
    levelContainer: document.getElementById('levelContainer'),
    targetContainer: document.getElementById('targetContainer'),
    finalScore: document.getElementById('finalScore'),
    gameOverTitle: document.getElementById('gameOverTitle'),
    gameOverMessage: document.getElementById('gameOverMessage')
};

// 初始化
function init() {
    setupEventListeners();
}

// 设置事件监听器
function setupEventListeners() {
    // 模式选择按钮
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mode = btn.getAttribute('data-mode');
            startGame(mode);
        });
    });

    // 道具按钮
    document.getElementById('bombPowerup').addEventListener('click', () => activatePowerup('bomb'));
    document.getElementById('shufflePowerup').addEventListener('click', () => activatePowerup('shuffle'));
    document.getElementById('hintPowerup').addEventListener('click', () => activatePowerup('hint'));
    document.getElementById('colorBombPowerup').addEventListener('click', () => activatePowerup('colorBomb'));

    // 控制按钮
    document.getElementById('backBtn').addEventListener('click', backToMenu);
    document.getElementById('restartBtn').addEventListener('click', restartGame);
    document.getElementById('pauseBtn').addEventListener('click', pauseGame);

    // 游戏结束按钮
    document.getElementById('playAgainBtn').addEventListener('click', restartGame);
    document.getElementById('backToMenuBtn').addEventListener('click', backToMenu);

    // 暂停菜单按钮
    document.getElementById('resumeBtn').addEventListener('click', resumeGame);
    document.getElementById('pauseRestartBtn').addEventListener('click', () => {
        resumeGame();
        restartGame();
    });
    document.getElementById('pauseBackBtn').addEventListener('click', () => {
        resumeGame();
        backToMenu();
    });
}

// 开始游戏
function startGame(mode) {
    gameState.currentMode = mode;
    gameState.reset();

    // 根据模式设置参数
    switch (mode) {
        case GAME_MODES.CLASSIC:
            gameState.moves = Infinity;
            elements.timerContainer.style.display = 'none';
            elements.levelContainer.style.display = 'none';
            elements.targetContainer.style.display = 'none';
            break;
        case GAME_MODES.TIMED:
            gameState.timer = 60;
            elements.timerContainer.style.display = 'flex';
            elements.levelContainer.style.display = 'none';
            elements.targetContainer.style.display = 'none';
            startTimer();
            break;
        case GAME_MODES.LEVEL:
            gameState.level = 1;
            gameState.targetScore = 1000;
            gameState.moves = 30;
            elements.timerContainer.style.display = 'none';
            elements.levelContainer.style.display = 'flex';
            elements.targetContainer.style.display = 'flex';
            break;
    }

    // 更新UI
    elements.currentMode.textContent = MODE_NAMES[mode];
    elements.modeSelection.classList.add('hidden');
    elements.gameContainer.classList.remove('hidden');

    // 初始化棋盘
    initBoard();
    updateUI();
}

// 初始化棋盘
function initBoard() {
    gameState.board = [];
    elements.board.innerHTML = '';

    // 生成随机棋盘
    for (let row = 0; row < BOARD_SIZE; row++) {
        gameState.board[row] = [];
        for (let col = 0; col < BOARD_SIZE; col++) {
            gameState.board[row][col] = createRandomGem();
        }
    }

    // 确保初始棋盘没有匹配
    while (hasMatches()) {
        shuffleBoard();
    }

    // 渲染棋盘
    renderBoard();
}

// 创建随机宝石
function createRandomGem() {
    const randomIndex = Math.floor(Math.random() * GEM_TYPES.length);
    return {
        ...GEM_TYPES[randomIndex],
        special: null
    };
}

// 渲染棋盘
function renderBoard() {
    elements.board.innerHTML = '';

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const gem = gameState.board[row][col];
            const gemElement = document.createElement('div');
            gemElement.className = `gem ${gem.color}`;
            gemElement.textContent = gem.emoji;
            gemElement.dataset.row = row;
            gemElement.dataset.col = col;

            if (gem.special) {
                gemElement.classList.add(`special-${gem.special}`);
            }

            gemElement.addEventListener('click', () => handleGemClick(row, col));
            elements.board.appendChild(gemElement);
        }
    }
}

// 处理宝石点击
function handleGemClick(row, col) {
    if (gameState.isAnimating || gameState.isPaused) return;

    // 如果激活了道具
    if (gameState.activePowerup) {
        handlePowerupClick(row, col);
        return;
    }

    const clickedGem = { row, col };

    if (!gameState.selectedGem) {
        // 第一次选择
        gameState.selectedGem = clickedGem;
        highlightGem(row, col, true);
    } else {
        // 第二次选择
        const { row: selectedRow, col: selectedCol } = gameState.selectedGem;

        // 如果点击同一个宝石,取消选择
        if (selectedRow === row && selectedCol === col) {
            highlightGem(selectedRow, selectedCol, false);
            gameState.selectedGem = null;
            return;
        }

        // 检查是否相邻
        if (isAdjacent(selectedRow, selectedCol, row, col)) {
            highlightGem(selectedRow, selectedCol, false);
            swapGems(selectedRow, selectedCol, row, col);
            gameState.selectedGem = null;
        } else {
            // 选择新的宝石
            highlightGem(selectedRow, selectedCol, false);
            gameState.selectedGem = clickedGem;
            highlightGem(row, col, true);
        }
    }
}

// 高亮宝石
function highlightGem(row, col, highlight) {
    const gemElement = elements.board.children[row * BOARD_SIZE + col];
    if (highlight) {
        gemElement.classList.add('selected');
    } else {
        gemElement.classList.remove('selected');
    }
}

// 检查是否相邻
function isAdjacent(row1, col1, row2, col2) {
    const rowDiff = Math.abs(row1 - row2);
    const colDiff = Math.abs(col1 - col2);
    return (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
}

// 交换宝石
async function swapGems(row1, col1, row2, col2) {
    gameState.isAnimating = true;

    // 交换数据
    const temp = gameState.board[row1][col1];
    gameState.board[row1][col1] = gameState.board[row2][col2];
    gameState.board[row2][col2] = temp;

    renderBoard();

    // 检查是否有匹配
    const matches = findMatches();

    if (matches.length > 0) {
        // 有效移动
        if (gameState.currentMode === GAME_MODES.LEVEL) {
            gameState.moves--;
            updateUI();
        }

        gameState.comboCount = 0;
        await processMatches();
    } else {
        // 无效移动,交换回来
        await new Promise(resolve => setTimeout(resolve, 300));
        gameState.board[row1][col1] = gameState.board[row2][col2];
        gameState.board[row2][col2] = temp;
        renderBoard();
    }

    gameState.isAnimating = false;
    checkGameStatus();
}

// 查找匹配
function findMatches() {
    const matches = [];
    const matched = new Set();

    // 检查横向匹配
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE - 2; col++) {
            const type = gameState.board[row][col].type;
            if (gameState.board[row][col + 1].type === type &&
                gameState.board[row][col + 2].type === type) {

                let count = 3;
                let endCol = col + 2;

                // 检查更长的匹配
                while (endCol + 1 < BOARD_SIZE && gameState.board[row][endCol + 1].type === type) {
                    count++;
                    endCol++;
                }

                for (let c = col; c <= endCol; c++) {
                    const key = `${row},${c}`;
                    if (!matched.has(key)) {
                        matches.push({ row, col: c, count, direction: 'horizontal' });
                        matched.add(key);
                    }
                }
            }
        }
    }

    // 检查纵向匹配
    for (let col = 0; col < BOARD_SIZE; col++) {
        for (let row = 0; row < BOARD_SIZE - 2; row++) {
            const type = gameState.board[row][col].type;
            if (gameState.board[row + 1][col].type === type &&
                gameState.board[row + 2][col].type === type) {

                let count = 3;
                let endRow = row + 2;

                while (endRow + 1 < BOARD_SIZE && gameState.board[endRow + 1][col].type === type) {
                    count++;
                    endRow++;
                }

                for (let r = row; r <= endRow; r++) {
                    const key = `${r},${col}`;
                    if (!matched.has(key)) {
                        matches.push({ row: r, col, count, direction: 'vertical' });
                        matched.add(key);
                    }
                }
            }
        }
    }

    return matches;
}

// 检查是否有匹配
function hasMatches() {
    return findMatches().length > 0;
}

// 处理匹配
async function processMatches() {
    let hasMatch = true;

    while (hasMatch) {
        const matches = findMatches();

        if (matches.length === 0) {
            hasMatch = false;
            break;
        }

        gameState.comboCount++;

        // 显示连击
        if (gameState.comboCount > 1) {
            showCombo(gameState.comboCount);
        }

        // 计算分数
        const baseScore = matches.length * 10;
        const comboBonus = gameState.comboCount * 5;
        const totalScore = baseScore + comboBonus;
        gameState.score += totalScore;

        // 检查特殊宝石生成
        checkSpecialGemCreation(matches);

        // 移除匹配的宝石
        await removeMatches(matches);

        // 下落宝石
        await dropGems();

        // 填充新宝石
        await fillBoard();

        updateUI();
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    gameState.comboCount = 0;
}

// 检查特殊宝石生成
function checkSpecialGemCreation(matches) {
    const matchGroups = {};

    matches.forEach(match => {
        const key = `${match.row},${match.col}`;
        if (!matchGroups[key]) {
            matchGroups[key] = { row: match.row, col: match.col, count: match.count, direction: match.direction };
        } else {
            matchGroups[key].count = Math.max(matchGroups[key].count, match.count);
        }
    });

    // 检查是否生成特殊宝石
    Object.values(matchGroups).forEach(group => {
        if (group.count >= 4) {
            // 4个或以上生成特殊宝石
            const gem = gameState.board[group.row][group.col];
            if (group.count >= 5) {
                gem.special = 'rainbow';
            } else {
                gem.special = group.direction === 'horizontal' ? 'horizontal' : 'vertical';
            }
        }
    });
}

// 移除匹配
async function removeMatches(matches) {
    const toRemove = new Set();

    matches.forEach(match => {
        const key = `${match.row},${match.col}`;
        toRemove.add(key);
    });

    // 添加移除动画
    toRemove.forEach(key => {
        const [row, col] = key.split(',').map(Number);
        const index = row * BOARD_SIZE + col;
        const gemElement = elements.board.children[index];
        if (gemElement) {
            gemElement.classList.add('removing');
        }
    });

    await new Promise(resolve => setTimeout(resolve, 400));

    // 移除宝石
    toRemove.forEach(key => {
        const [row, col] = key.split(',').map(Number);
        gameState.board[row][col] = null;
    });

    renderBoard();
}

// 下落宝石
async function dropGems() {
    for (let col = 0; col < BOARD_SIZE; col++) {
        let emptyRow = BOARD_SIZE - 1;

        for (let row = BOARD_SIZE - 1; row >= 0; row--) {
            if (gameState.board[row][col] !== null) {
                if (row !== emptyRow) {
                    gameState.board[emptyRow][col] = gameState.board[row][col];
                    gameState.board[row][col] = null;
                }
                emptyRow--;
            }
        }
    }

    renderBoard();
    await new Promise(resolve => setTimeout(resolve, 300));
}

// 填充棋盘
async function fillBoard() {
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            if (gameState.board[row][col] === null) {
                gameState.board[row][col] = createRandomGem();
            }
        }
    }

    renderBoard();
    await new Promise(resolve => setTimeout(resolve, 300));
}

// 洗牌
function shuffleBoard() {
    const gems = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            gems.push(gameState.board[row][col]);
        }
    }

    // Fisher-Yates 洗牌
    for (let i = gems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gems[i], gems[j]] = [gems[j], gems[i]];
    }

    let index = 0;
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            gameState.board[row][col] = gems[index++];
        }
    }
}

// 激活道具
function activatePowerup(type) {
    if (gameState.powerups[type] <= 0 || gameState.isAnimating) return;

    if (type === 'shuffle') {
        // 重排直接执行
        gameState.powerups[type]--;
        shuffleBoard();
        renderBoard();
        updateUI();
    } else if (type === 'hint') {
        // 提示可消除的组合
        gameState.powerups[type]--;
        showHint();
        updateUI();
    } else {
        // 其他道具需要点击棋盘
        gameState.activePowerup = type;
        document.querySelectorAll('.powerup-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(`${type}Powerup`).classList.add('active');
    }
}

// 处理道具点击
async function handlePowerupClick(row, col) {
    const type = gameState.activePowerup;
    gameState.powerups[type]--;

    if (type === 'bomb') {
        await useBombPowerup(row, col);
    } else if (type === 'colorBomb') {
        await useColorBombPowerup(row, col);
    }

    gameState.activePowerup = null;
    document.querySelectorAll('.powerup-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    updateUI();
}

// 使用炸弹道具
async function useBombPowerup(row, col) {
    gameState.isAnimating = true;
    const toRemove = [];

    // 3x3范围
    for (let r = Math.max(0, row - 1); r <= Math.min(BOARD_SIZE - 1, row + 1); r++) {
        for (let c = Math.max(0, col - 1); c <= Math.min(BOARD_SIZE - 1, col + 1); c++) {
            toRemove.push({ row: r, col: c });
            const index = r * BOARD_SIZE + c;
            const gemElement = elements.board.children[index];
            if (gemElement) {
                gemElement.classList.add('bomb-target');
            }
        }
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // 移除宝石
    toRemove.forEach(({ row, col }) => {
        gameState.board[row][col] = null;
    });

    gameState.score += toRemove.length * 10;
    await dropGems();
    await fillBoard();
    await processMatches();

    gameState.isAnimating = false;
}

// 使用彩虹炸弹
async function useColorBombPowerup(row, col) {
    gameState.isAnimating = true;
    const targetType = gameState.board[row][col].type;
    const toRemove = [];

    // 找到所有相同颜色的宝石
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (gameState.board[r][c].type === targetType) {
                toRemove.push({ row: r, col: c });
            }
        }
    }

    // 添加动画
    toRemove.forEach(({ row, col }) => {
        const index = row * BOARD_SIZE + col;
        const gemElement = elements.board.children[index];
        if (gemElement) {
            gemElement.classList.add('removing');
        }
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // 移除宝石
    toRemove.forEach(({ row, col }) => {
        gameState.board[row][col] = null;
    });

    gameState.score += toRemove.length * 20;
    await dropGems();
    await fillBoard();
    await processMatches();

    gameState.isAnimating = false;
}

// 显示提示
function showHint() {
    // 查找可能的移动
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            // 尝试向右交换
            if (col < BOARD_SIZE - 1) {
                const temp = gameState.board[row][col];
                gameState.board[row][col] = gameState.board[row][col + 1];
                gameState.board[row][col + 1] = temp;

                if (hasMatches()) {
                    // 找到匹配,显示提示
                    gameState.board[row][col + 1] = gameState.board[row][col];
                    gameState.board[row][col] = temp;

                    const index1 = row * BOARD_SIZE + col;
                    const index2 = row * BOARD_SIZE + col + 1;
                    elements.board.children[index1].classList.add('hint');
                    elements.board.children[index2].classList.add('hint');

                    setTimeout(() => {
                        elements.board.children[index1].classList.remove('hint');
                        elements.board.children[index2].classList.remove('hint');
                    }, 2000);
                    return;
                }

                gameState.board[row][col + 1] = gameState.board[row][col];
                gameState.board[row][col] = temp;
            }

            // 尝试向下交换
            if (row < BOARD_SIZE - 1) {
                const temp = gameState.board[row][col];
                gameState.board[row][col] = gameState.board[row + 1][col];
                gameState.board[row + 1][col] = temp;

                if (hasMatches()) {
                    gameState.board[row + 1][col] = gameState.board[row][col];
                    gameState.board[row][col] = temp;

                    const index1 = row * BOARD_SIZE + col;
                    const index2 = (row + 1) * BOARD_SIZE + col;
                    elements.board.children[index1].classList.add('hint');
                    elements.board.children[index2].classList.add('hint');

                    setTimeout(() => {
                        elements.board.children[index1].classList.remove('hint');
                        elements.board.children[index2].classList.remove('hint');
                    }, 2000);
                    return;
                }

                gameState.board[row + 1][col] = gameState.board[row][col];
                gameState.board[row][col] = temp;
            }
        }
    }
}

// 显示连击
function showCombo(count) {
    elements.comboDisplay.textContent = `${count}x 连击! 🔥`;
    elements.comboDisplay.classList.remove('hidden');

    setTimeout(() => {
        elements.comboDisplay.classList.add('hidden');
    }, 1000);
}

// 更新UI
function updateUI() {
    elements.score.textContent = gameState.score;

    if (gameState.currentMode === GAME_MODES.LEVEL) {
        elements.moves.textContent = gameState.moves;
        elements.level.textContent = gameState.level;
        elements.target.textContent = gameState.targetScore;
    } else {
        elements.moves.textContent = '∞';
    }

    // 更新道具数量
    document.getElementById('bombCount').textContent = gameState.powerups.bomb;
    document.getElementById('shuffleCount').textContent = gameState.powerups.shuffle;
    document.getElementById('hintCount').textContent = gameState.powerups.hint;
    document.getElementById('colorBombCount').textContent = gameState.powerups.colorBomb;

    // 禁用没有数量的道具
    Object.keys(gameState.powerups).forEach(type => {
        const btn = document.getElementById(`${type}Powerup`);
        if (gameState.powerups[type] <= 0) {
            btn.disabled = true;
        } else {
            btn.disabled = false;
        }
    });
}

// 开始计时器
function startTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
    }

    gameState.timerInterval = setInterval(() => {
        if (!gameState.isPaused) {
            gameState.timer--;
            elements.timer.textContent = gameState.timer;

            if (gameState.timer <= 0) {
                clearInterval(gameState.timerInterval);
                endGame(false, '时间到!');
            }
        }
    }, 1000);
}

// 检查游戏状态
function checkGameStatus() {
    if (gameState.currentMode === GAME_MODES.LEVEL) {
        if (gameState.score >= gameState.targetScore) {
            // 过关
            gameState.level++;
            gameState.targetScore = Math.floor(gameState.targetScore * 1.5);
            gameState.moves = 30;
            gameState.powerups.bomb++;
            gameState.powerups.hint += 2;

            showCombo(`第 ${gameState.level} 关!`);
            updateUI();
        } else if (gameState.moves <= 0) {
            // 失败
            endGame(false, '移动次数用完了!');
        }
    }
}

// 暂停游戏
function pauseGame() {
    if (gameState.isAnimating) return;
    gameState.isPaused = true;
    elements.pauseMenu.classList.remove('hidden');
}

// 恢复游戏
function resumeGame() {
    gameState.isPaused = false;
    elements.pauseMenu.classList.add('hidden');
}

// 重新开始
function restartGame() {
    elements.gameOver.classList.add('hidden');
    startGame(gameState.currentMode);
}

// 返回菜单
function backToMenu() {
    gameState.reset();
    elements.gameContainer.classList.add('hidden');
    elements.gameOver.classList.add('hidden');
    elements.pauseMenu.classList.add('hidden');
    elements.modeSelection.classList.remove('hidden');
}

// 结束游戏
function endGame(won, message) {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
    }

    elements.gameOverTitle.textContent = won ? '🎉 恭喜! 🎉' : '游戏结束';
    elements.gameOverMessage.textContent = message;
    elements.finalScore.textContent = gameState.score;
    elements.gameOver.classList.remove('hidden');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
