// ===========================
// FIREBASE CONFIGURATION
// ===========================
const firebaseConfig = {
  apiKey: "AIzaSyB53J9m0IEfIUYxerwc0n65nCxdF0JOqpA",
  authDomain: "trainerbilliard.firebaseapp.com",
  databaseURL: "https://trainerbilliard-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "trainerbilliard",
  storageBucket: "trainerbilliard.firebasestorage.app",
  messagingSenderId: "563812776339",
  appId: "1:563812776339:web:e7db8ccd208ca063c05066"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

console.log('✓ Firebase initialized');
console.log('Project ID:', firebaseConfig.projectId);
console.log('Database URL:', firebaseConfig.databaseURL);
console.log('User ID: 8i7zA1AVlId6iZHLEZDeDsows4u2');

// ===========================
// MQTT CONFIGURATION
// ===========================
// Menggunakan EMQX Public Broker (Gratis & Support WSS)
// ESP32: broker.emqx.io:1883 (MQTT)
// Web: broker.emqx.io:8084 (WebSocket Secure)

const MQTT_BROKER = "broker.emqx.io";
const MQTT_PORT = 8084;  // WebSocket Secure port (wss://)
const MQTT_USERNAME = "";  // Public broker tidak memerlukan username
const MQTT_PASSWORD = "";  // Public broker tidak memerlukan password

const MQTT_CLIENT_ID = "web_billiard_" + Math.random().toString(16).substring(2, 10);

// MQTT Topics
const MQTT_TOPIC_STATUS = "billiard/esp32/status";
const MQTT_TOPIC_SENSOR = "billiard/esp32/sensor";
const MQTT_TOPIC_COUNTER = "billiard/esp32/counter";
const MQTT_TOPIC_COUNTER_EVENT = "billiard/esp32/counter_event";
const MQTT_TOPIC_MOTOR = "billiard/esp32/motor";
const MQTT_TOPIC_SERVO = "billiard/esp32/servo";
const MQTT_TOPIC_DEBUG = "billiard/esp32/debug";

// Command Topics (Web → ESP32)
const MQTT_TOPIC_COMMAND = "billiard/web/command";
const MQTT_TOPIC_FIRE = "billiard/web/fire";
const MQTT_TOPIC_DISTANCE = "billiard/web/distance";
const MQTT_TOPIC_PWM = "billiard/web/pwm";
const MQTT_TOPIC_RESET = "billiard/web/reset";

// MQTT Client
let mqttClient = null;
let mqttConnected = false;

// ===========================
// STATE
// ===========================
let selectedBallCount = 1;
let selectedDistance = 60;
let selectedPWM = 200;
let isRunning = false;
let isAutoMode = false; // false = manual, true = auto
let totalBalls = 9;     // Maksimal bola (MAX_BALLS di firmware)
let ballsRemaining = 0; // Sisa bola saat ini (sesuai INITIAL_BALLS = 0 di firmware)
let ballsInCount = 0;
let ballsOutCount = 0;
let autoModeRunning = false;
let autoModeTargetBalls = 0;
let autoModeBallsDispensed = 0;
let autoModeTimer = 2.0; // Timer periode dalam detik (default 2 detik) - TANPA BATAS

// Sensor status from ESP32
let sensorStatus = {
    ir_up: false,
    ir_down: false,
    motor_active: false,
    servo_position: 90,  // Servo mulai pada posisi tutup (90°)
    counter: 0
};

// PWM Settings (disimpan di localStorage agar tidak hilang saat refresh)
let pwmSettings = {
    60: 800,
    70: 900,
    80: 1000,
    90: 1023
};

// Load PWM settings dari localStorage
const savedPWM = localStorage.getItem('pwmSettings');
if (savedPWM) {
    pwmSettings = JSON.parse(savedPWM);
}

// Load timer setting dari localStorage
const savedTimer = localStorage.getItem('autoModeTimer');
if (savedTimer) {
    autoModeTimer = parseFloat(savedTimer);
}

// Elements
const ballCountSlider = document.getElementById('ballCountSlider');
const ballCountValue = document.getElementById('ballCountValue');
const timerInput = document.getElementById('timerInput');
const timerValueDisplay = document.getElementById('timerValueDisplay');
const timerCard = document.getElementById('timerCard');
const manualModeBtn = document.getElementById('manualModeBtn');
const autoModeBtn = document.getElementById('autoModeBtn');
const modeInfo = document.getElementById('modeInfo');
const manualFireBtn = document.getElementById('manualFireBtn');
const autoStartBtn = document.getElementById('autoStartBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');
const selectedBallsDisplay = document.getElementById('selectedBalls');
const selectedDistanceDisplay = document.getElementById('selectedDistance');
const modeDisplay = document.getElementById('modeDisplay');
const targetBallsRow = document.getElementById('targetBallsRow');
const machineStatusDisplay = document.getElementById('machineStatus');
const motorStatusDisplay = document.getElementById('motorStatus');
const servoStatusDisplay = document.getElementById('servoStatus');
const statusDot = document.getElementById('statusDot');
const connectionText = document.getElementById('connectionText');
const ballsRemainingDisplay = document.getElementById('ballsRemaining');
const distanceBtns = document.querySelectorAll('.distance-btn');
const notificationContainer = document.getElementById('notificationContainer');
const autoTimerDisplay = document.getElementById('autoTimerDisplay');

// Calibration Modal Elements
const calibrateBtn = document.getElementById('calibrateBtn');
const calibrationModal = document.getElementById('calibrationModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelCalibrateBtn = document.getElementById('cancelCalibrateBtn');
const saveCalibrateBtn = document.getElementById('saveCalibrateBtn');
const testPwmBtns = document.querySelectorAll('.test-pwm-btn');

// Notification System
function showNotification(title, message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    const icons = {
        success: 'fa-check-circle',
        warning: 'fa-exclamation-triangle',
        error: 'fa-times-circle',
        info: 'fa-info-circle'
    };

    notification.innerHTML = `
        <div class="notification-icon">
            <i class="fas ${icons[type]}"></i>
        </div>
        <div class="notification-content">
            <div class="notification-title">${title}</div>
            <div class="notification-message">${message}</div>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
        <div class="notification-progress"></div>
    `;

    notificationContainer.appendChild(notification);

    // Auto remove after duration
    setTimeout(() => {
        notification.classList.add('removing');
        setTimeout(() => {
            notification.remove();
        }, 400);
    }, duration);

    return notification;
}

// Mode Selection
manualModeBtn.addEventListener('click', () => {
    setMode(false);
});

autoModeBtn.addEventListener('click', () => {
    setMode(true);
});

function setMode(isAuto) {
    isAutoMode = isAuto;
    const autoModeInfo = document.getElementById('autoModeInfo');
    const ballCountCard = document.getElementById('ballCountCard');

    if (isAuto) {
        // Auto Mode
        manualModeBtn.classList.remove('active');
        autoModeBtn.classList.add('active');
        manualFireBtn.style.display = 'none';
        autoStartBtn.style.display = 'block';
        autoModeInfo.style.display = 'block';
        ballCountCard.style.display = 'block'; // Tampilkan card jumlah bola
        timerCard.style.display = 'block'; // Tampilkan card timer
        targetBallsRow.style.display = 'flex'; // Tampilkan row target bola
        modeDisplay.textContent = 'Otomatis';
        modeInfo.innerHTML = '<p><i class="fas fa-info-circle"></i> <strong>Otomatis:</strong> Aktif</p>';

        // Update info auto mode
        updateAutoModeInfo();
    } else {
        // Manual Mode
        autoModeBtn.classList.remove('active');
        manualModeBtn.classList.add('active');
        autoStartBtn.style.display = 'none';
        autoModeInfo.style.display = 'none';
        ballCountCard.style.display = 'none'; // Sembunyikan card jumlah bola
        timerCard.style.display = 'none'; // Sembunyikan card timer
        targetBallsRow.style.display = 'none'; // Sembunyikan row target bola
        manualFireBtn.style.display = 'block';
        modeDisplay.textContent = 'Manual';
        modeInfo.innerHTML = '<p><i class="fas fa-info-circle"></i> <strong>Manual:</strong> Aktif - 1 bola per klik</p>';

        // Stop auto mode jika sedang berjalan
        if (autoModeRunning) {
            stopAutoMode();
        }
    }
}

// Helper function untuk format timer tanpa desimal jika bilangan bulat
function formatTimer(value) {
    return parseFloat(value.toFixed(1));
}

// Update auto mode info display
function updateAutoModeInfo() {
    const autoBallCount = document.getElementById('autoBallCount');
    const autoDistance = document.getElementById('autoDistance');
    const autoProgress = document.getElementById('autoProgress');
    const autoProgressText = document.getElementById('autoProgressText');

    if (autoBallCount) autoBallCount.textContent = selectedBallCount;
    if (autoDistance) autoDistance.textContent = selectedDistance + ' cm';
    if (autoTimerDisplay) autoTimerDisplay.textContent = formatTimer(autoModeTimer);

    // Update progress
    if (autoModeRunning) {
        const progress = (autoModeBallsDispensed / autoModeTargetBalls) * 100;
        if (autoProgress) autoProgress.style.width = progress + '%';
        if (autoProgressText) autoProgressText.textContent = `${autoModeBallsDispensed}/${autoModeTargetBalls} bola`;
    } else {
        if (autoProgress) autoProgress.style.width = '0%';
        if (autoProgressText) autoProgressText.textContent = `0/${selectedBallCount} bola`;
    }
}

// Update Distance Buttons dengan PWM values yang tersimpan
function updateDistanceButtons() {
    distanceBtns.forEach(btn => {
        const distance = btn.dataset.distance;
        const pwm = pwmSettings[distance];
        btn.dataset.pwm = pwm;
        // Note: HTML doesn't have .pwm-label element, just update data-pwm attribute
    });
}

// Distance Button Selection
distanceBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all buttons
        distanceBtns.forEach(b => b.classList.remove('active'));

        // Add active class to clicked button
        btn.classList.add('active');

        // Update values
        selectedDistance = parseInt(btn.dataset.distance);
        selectedPWM = parseInt(btn.dataset.pwm);

        // Update display
        selectedDistanceDisplay.textContent = selectedDistance + ' cm';

        // Update auto mode info jika dalam mode auto
        if (isAutoMode) {
            updateAutoModeInfo();
        }
    });
});

// Ball count slider
ballCountSlider.addEventListener('input', (e) => {
    selectedBallCount = parseInt(e.target.value);
    ballCountValue.textContent = selectedBallCount;
    selectedBallsDisplay.textContent = selectedBallCount + ' Bola';
    updateSliderGradient(ballCountSlider);

    // Update auto mode info jika dalam mode auto
    if (isAutoMode) {
        updateAutoModeInfo();
    }
});

// Timer Input - FITUR TIMER BARU TANPA BATAS
timerInput.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);

    // Validasi input
    if (isNaN(value) || value <= 0) {
        return; // Jangan update jika invalid
    }

    autoModeTimer = value;

    // Update display
    if (timerValueDisplay) {
        timerValueDisplay.textContent = formatTimer(autoModeTimer) + ' detik';
    }

    // Simpan ke localStorage
    localStorage.setItem('autoModeTimer', autoModeTimer);

    // Update auto mode info jika dalam mode auto
    if (isAutoMode) {
        updateAutoModeInfo();
    }
});

// Timer input blur event - validasi dan format
timerInput.addEventListener('blur', (e) => {
    let value = parseFloat(e.target.value);

    // Validasi: harus lebih dari 0
    if (isNaN(value) || value <= 0) {
        value = 0.5; // Default minimum
        showNotification(
            '⚠️ Timer Tidak Valid',
            'Timer harus lebih dari 0 detik. Diatur ke 0.5 detik.',
            'warning',
            3000
        );
    }

    autoModeTimer = value;
    e.target.value = value.toFixed(1);

    // Update display
    if (timerValueDisplay) {
        timerValueDisplay.textContent = formatTimer(autoModeTimer) + ' detik';
    }

    // Simpan ke localStorage
    localStorage.setItem('autoModeTimer', autoModeTimer);

    // Update auto mode info jika dalam mode auto
    if (isAutoMode) {
        updateAutoModeInfo();
    }
});

// Update slider gradient based on value
function updateSliderGradient(slider) {
    const min = parseInt(slider.min);
    const max = parseInt(slider.max);
    const value = parseInt(slider.value);
    const percentage = ((value - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(90deg, #1976D2 ${percentage}%, #E3F2FD ${percentage}%)`;
}

// Manual Fire Button - kirim satu bola via MQTT
manualFireBtn.addEventListener('click', () => {
    if (ballsRemaining <= 0) {
        showNotification(
            '⚠️ Tidak Ada Bola',
            'Masukkan bola terlebih dahulu (0 → 9)\nGunakan IR IN untuk menghitung bola masuk',
            'warning',
            4000
        );
        return;
    }

    if (!mqttConnected) {
        showNotification(
            '⚠️ MQTT Tidak Terhubung',
            'Tidak dapat mengirim perintah. Periksa koneksi.',
            'error',
            3000
        );
        return;
    }

    // Kirim perintah ke ESP32 via MQTT
    console.log('Mengeluarkan bola:', {
        jarak: selectedDistance + ' cm',
        pwm: selectedPWM
    });

    // 1. Kirim perintah FIRE ke ESP32
    publishMQTT(MQTT_TOPIC_FIRE, 'FIRE');
    console.log('→ Perintah FIRE dikirim');

    // 2. Kirim data jarak dan PWM
    publishMQTT(MQTT_TOPIC_DISTANCE, String(selectedDistance));
    publishMQTT(MQTT_TOPIC_PWM, String(selectedPWM));

    // UI Update sementara
    if (motorStatusDisplay) {
        motorStatusDisplay.textContent = 'ON';
        motorStatusDisplay.classList.add('active');
    }
    if (servoStatusDisplay) {
        servoStatusDisplay.textContent = '180°';
    }
    machineStatusDisplay.textContent = 'Mengeluarkan Bola...';
    isRunning = true;

    // ESP32 akan menangani dispensing dan update counter via MQTT
    // UI akan diupdate otomatis dari pesan MQTT

    // Notifikasi
    showNotification(
        '🎱 Mengeluarkan Bola',
        `Jarak: ${selectedDistance} cm\nPWM: ${selectedPWM}\nMotor berhenti saat laser terhalang`,
        'info',
        3000
    );
});

// Auto Start Button - kirim perintah ke ESP32 via MQTT untuk mode otomatis
autoStartBtn.addEventListener('click', () => {
    if (ballsRemaining <= 0) {
        showNotification(
            '⚠️ Tidak Ada Bola',
            'Masukkan bola terlebih dahulu (0 → 9)\nGunakan IR IN untuk menghitung bola masuk',
            'warning',
            4000
        );
        return;
    }

    if (selectedBallCount > ballsRemaining) {
        showNotification(
            '⚠️ Jumlah Bola Terlalu Banyak',
            `Hanya tersisa ${ballsRemaining} bola. Kurangi jumlah bola atau masukkan lebih banyak bola.`,
            'warning',
            4000
        );
        return;
    }

    console.log('Memulai mode otomatis:', {
        jumlah: selectedBallCount,
        jarak: selectedDistance + ' cm',
        pwm: selectedPWM,
        timer: autoModeTimer + ' detik'
    });

    // Set auto mode state
    autoModeRunning = true;
    autoModeTargetBalls = selectedBallCount;
    autoModeBallsDispensed = 0;

    // Publish MQTT commands - Kirim jumlah bola, timer, dan setting lainnya dalam JSON
    publishMQTT(MQTT_TOPIC_COMMAND, JSON.stringify({
        command: 'START_AUTO',
        ballCount: selectedBallCount,
        timer: autoModeTimer
    }));
    publishMQTT(MQTT_TOPIC_DISTANCE, String(selectedDistance));
    publishMQTT(MQTT_TOPIC_PWM, String(selectedPWM));

    // Update info display
    updateAutoModeInfo();

    // Show notification
    showNotification(
        '🔄 Mode Otomatis Dimulai',
        `Mengeluarkan ${selectedBallCount} bola\nJarak: ${selectedDistance} cm\nPWM: ${selectedPWM}\nTimer periode: ${formatTimer(autoModeTimer)} detik/bola\nSetiap bola berhenti saat laser terhalang`,
        'info',
        4000
    );

    // UI Update
    autoStartBtn.style.display = 'none';
    stopBtn.style.display = 'block';
    machineStatusDisplay.textContent = 'Mengeluarkan Bola...';
    isRunning = true;
});

// Stop button via MQTT
stopBtn.addEventListener('click', () => {
    console.log('Menghentikan mesin...');

    // Stop auto mode
    stopAutoMode();

    // Publish MQTT command
    publishMQTT(MQTT_TOPIC_COMMAND, 'STOP');

    // UI Update
    if (isAutoMode) {
        autoStartBtn.style.display = 'block';
    }
    stopBtn.style.display = 'none';
    machineStatusDisplay.textContent = 'Siap';
    isRunning = false;

    // Show notification
    showNotification(
        '⏹️ Dihentikan',
        'Mode otomatis dihentikan. Bola tidak dikeluarkan lagi.',
        'warning',
        3000
    );
});

// Stop auto mode function
function stopAutoMode() {
    autoModeRunning = false;
    autoModeTargetBalls = 0;
    autoModeBallsDispensed = 0;
    updateAutoModeInfo();
}

// Reset button via MQTT
resetBtn.addEventListener('click', () => {
    if (!confirm('Reset counter ke 0?')) {
        return;
    }

    console.log('Reset counter...');

    // Stop auto mode jika running
    if (autoModeRunning) {
        stopAutoMode();
    }

    // Publish MQTT command
    publishMQTT(MQTT_TOPIC_RESET, 'RESET');

    // Update local state sementara (actual update akan dari ESP32 via MQTT)
    ballsRemaining = 0;
    ballsInCount = 0;
    ballsOutCount = 0;

    // Update displays
    ballsRemainingDisplay.textContent = ballsRemaining;
    const ballsInCountDisplay = document.getElementById('ballsInCount');
    const ballsOutCountDisplay = document.getElementById('ballsOutCount');
    if (ballsInCountDisplay) ballsInCountDisplay.textContent = '0';
    if (ballsOutCountDisplay) ballsOutCountDisplay.textContent = '0';

    machineStatusDisplay.textContent = 'Siap';
    isRunning = false;

    // Show auto start button if in auto mode
    if (isAutoMode) {
        autoStartBtn.style.display = 'block';
        stopBtn.style.display = 'none';
        updateAutoModeInfo();
    }

    // Show notification
    showNotification(
        '🔄 Reset Berhasil',
        'Counter direset ke 0\nSiap menghitung bola masuk (0 → 9)',
        'success',
        3000
    );
});

// Calibration Modal
calibrateBtn.addEventListener('click', () => {
    // Load current PWM values ke input fields
    document.getElementById('pwm60').value = pwmSettings[60];
    document.getElementById('pwm70').value = pwmSettings[70];
    document.getElementById('pwm80').value = pwmSettings[80];
    document.getElementById('pwm90').value = pwmSettings[90];

    // Show modal
    calibrationModal.classList.add('active');
});

// Close modal
closeModalBtn.addEventListener('click', () => {
    calibrationModal.classList.remove('active');
});

cancelCalibrateBtn.addEventListener('click', () => {
    calibrationModal.classList.remove('active');
});

// Close modal when clicking outside
calibrationModal.addEventListener('click', (e) => {
    if (e.target === calibrationModal) {
        calibrationModal.classList.remove('active');
    }
});

// Test PWM button via MQTT
testPwmBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const distance = btn.dataset.distance;
        const pwmInput = document.getElementById('pwm' + distance);
        const pwm = parseInt(pwmInput.value);

        console.log(`Testing PWM ${pwm} untuk jarak ${distance}cm`);

        // Kirim test command ke ESP32 via MQTT
        publishMQTT(MQTT_TOPIC_PWM, String(pwm));
        publishMQTT(MQTT_TOPIC_DISTANCE, String(distance));
        publishMQTT(MQTT_TOPIC_FIRE, 'TEST');

        machineStatusDisplay.textContent = `Testing PWM ${pwm}...`;

        // Show notification
        showNotification(
            `🧪 Testing PWM ${pwm}`,
            `Jarak target: ${distance} cm\nUkur dengan meteran untuk memastikan`,
            'info',
            3000
        );

        setTimeout(() => {
            machineStatusDisplay.textContent = 'Siap';
        }, 2000);
    });
});

// Save PWM settings
saveCalibrateBtn.addEventListener('click', () => {
    // Get values dari input fields
    pwmSettings[60] = parseInt(document.getElementById('pwm60').value) || 800;
    pwmSettings[70] = parseInt(document.getElementById('pwm70').value) || 900;
    pwmSettings[80] = parseInt(document.getElementById('pwm80').value) || 1000;
    pwmSettings[90] = parseInt(document.getElementById('pwm90').value) || 1023;

    // Save ke localStorage
    localStorage.setItem('pwmSettings', JSON.stringify(pwmSettings));

    // Update distance buttons dengan PWM values baru
    updateDistanceButtons();

    // Update current selected PWM jika perlu
    const currentBtn = document.querySelector('.distance-btn.active');
    if (currentBtn) {
        selectedPWM = parseInt(currentBtn.dataset.pwm);
    }

    console.log('PWM Settings saved:', pwmSettings);

    // Close modal
    calibrationModal.classList.remove('active');

    // Show notification
    showNotification(
        '💾 PWM Disimpan',
        'Pengaturan PWM berhasil disimpan!',
        'success',
        3000
    );
});

// ===========================
// MQTT FUNCTIONS
// ===========================

// Initialize MQTT Connection
function initMQTT() {
    console.log('='.repeat(60));
    console.log('INIT MQTT CONNECTION (EMQX Public Broker)');
    console.log('='.repeat(60));
    console.log('MQTT Broker:', MQTT_BROKER);
    console.log('MQTT Port:', MQTT_PORT);
    console.log('MQTT Client ID:', MQTT_CLIENT_ID);
    console.log('MQTT Protocol: WebSocket Secure (wss://)');

    // Safety check untuk elemen DOM
    if (!connectionText || !statusDot) {
        console.error('✗ DOM elements not found!');
        console.error('connectionText:', connectionText);
        console.error('statusDot:', statusDot);
        return;
    }

    // Update UI status
    connectionText.textContent = 'Menghubungkan...';
    statusDot.classList.remove('offline');
    statusDot.style.background = '#FFA726'; // Orange untuk connecting

    // WebSocket URL untuk EMQX Public Broker
    const connectUrl = `wss://${MQTT_BROKER}:${MQTT_PORT}/mqtt`;

    console.log('Connect URL:', connectUrl);
    console.log('Attempting connection to EMQX Public Broker...');

    try {
        mqttClient = mqtt.connect(connectUrl, {
            clientId: MQTT_CLIENT_ID,
            clean: true,
            connectTimeout: 30 * 1000,      // 30 detik timeout
            reconnectPeriod: 5 * 1000,      // Reconnect 5 detik
            keepalive: 60,
            protocolId: 'MQTT',
            protocolVersion: 4              // MQTT 3.1.1
        });

        // Connection successful
        mqttClient.on('connect', () => {
            console.log('✓✓✓ MQTT CONNECTED! ✓✓✓');
            console.log('='.repeat(60));
            mqttConnected = true;

            // Update UI
            if (statusDot) {
                statusDot.classList.remove('offline');
                statusDot.style.background = '#4CAF50'; // Green
            }
            if (connectionText) connectionText.textContent = 'Terhubung ke Device';

            // Subscribe ke topics
            const topics = [
                MQTT_TOPIC_SENSOR,
                MQTT_TOPIC_COUNTER,
                MQTT_TOPIC_COUNTER_EVENT,
                MQTT_TOPIC_MOTOR,
                MQTT_TOPIC_SERVO,
                MQTT_TOPIC_STATUS,
                MQTT_TOPIC_DEBUG
            ];

            topics.forEach(topic => {
                mqttClient.subscribe(topic, { qos: 0 }, (err) => {
                    if (!err) {
                        console.log('✓ Subscribed:', topic);
                    } else {
                        console.error('✗ Subscribe failed:', topic, err);
                    }
                });
            });

            console.log('✓ All topics subscribed successfully');
            console.log('='.repeat(60));

            showNotification(
                '📡 MQTT Terhubung',
                'Berhasil terhubung ke EMQX Public Broker!\nBroker: ' + MQTT_BROKER + '\nPort: 8084 (WebSocket Secure)\nSiap menerima data dari ESP32',
                'success',
                3000
            );
        });

        // Error handler
        mqttClient.on('error', (err) => {
            console.error('✗✗✗ MQTT ERROR ✗✗✗');
            console.error('Error type:', err.constructor.name);
            console.error('Error message:', err.message);
            console.error('Full error:', err);

            // Cek jenis error umum
            if (err.message.includes('ECONNREFUSED')) {
                console.error('❌ CONNECTION REFUSED');
                console.error('Cek broker dan port!');
                console.error('Pastikan broker URL dan port benar');
            } else if (err.message.includes('timeout')) {
                console.error('❌ CONNECTION TIMEOUT');
                console.error('Cek koneksi internet');
            }

            mqttConnected = false;
            if (statusDot) statusDot.classList.add('offline');
            if (connectionText) connectionText.textContent = 'MQTT Error - Cek Console';

            showNotification(
                '❌ MQTT Error',
                'Gagal terhubung: ' + err.message + '\nPeriksa koneksi internet',
                'error',
                5000
            );
        });

        // Connection closed
        mqttClient.on('close', () => {
            console.log('MQTT Connection closed');
            mqttConnected = false;
            if (statusDot) statusDot.classList.add('offline');
            if (connectionText) connectionText.textContent = 'Terputus - Reconnecting...';
        });

        // Offline event
        mqttClient.on('offline', () => {
            console.log('MQTT Client went offline');
            mqttConnected = false;
            if (statusDot) statusDot.classList.add('offline');
            if (connectionText) connectionText.textContent = 'Offline - Reconnecting...';
        });

        // End event
        mqttClient.on('end', () => {
            console.log('MQTT Connection ended');
            mqttConnected = false;
            if (statusDot) statusDot.classList.add('offline');
            if (connectionText) connectionText.textContent = 'Connection Ended';
        });

        // Reconnecting
        mqttClient.on('reconnect', () => {
            console.log('MQTT Attempting to reconnect...');
            if (connectionText) connectionText.textContent = 'Reconnecting...';
            if (statusDot) statusDot.style.background = '#FFA726'; // Orange
        });

        // Message received
        mqttClient.on('message', (topic, message) => {
            handleMQTTMessage(topic, message);
        });

        // Connection timeout (hanya jika supported)
        mqttClient.on('end', () => {
            console.log('MQTT Connection ended');
        });

    } catch (error) {
        console.error('FATAL ERROR initializing MQTT:', error);
        console.error('Error stack:', error.stack);

        if (statusDot) statusDot.classList.add('offline');
        if (connectionText) connectionText.textContent = 'MQTT Init Failed';

        showNotification(
            '❌ MQTT Error',
            'Gagal inisialisasi MQTT: ' + error.message + '\nCek browser console (F12)',
            'error',
            5000
        );
    }
}

// Handle incoming MQTT messages
function handleMQTTMessage(topic, message) {
    console.log('📨 MQTT MESSAGE RECEIVED');
    console.log('Topic:', topic);
    console.log('Raw message:', message.toString());

    try {
        const payload = JSON.parse(message.toString());
        console.log('Parsed payload:', payload);

        // Route message ke handler yang sesuai
        switch(topic) {
            case MQTT_TOPIC_SENSOR:
                console.log('→ Handling: SENSOR status');
                updateSensorStatus(payload);
                break;
            case MQTT_TOPIC_COUNTER:
                console.log('→ Handling: COUNTER status');
                updateCounterStatus(payload);
                break;
            case MQTT_TOPIC_COUNTER_EVENT:
                console.log('→ Handling: COUNTER EVENT');
                handleCounterEvent(payload);
                break;
            case MQTT_TOPIC_MOTOR:
                console.log('→ Handling: MOTOR status');
                updateMotorStatus(payload);
                break;
            case MQTT_TOPIC_SERVO:
                console.log('→ Handling: SERVO status');
                updateServoStatus(payload);
                break;
            case MQTT_TOPIC_DEBUG:
                console.log('→ Handling: DEBUG info');
                updateDebugInfo(payload);
                break;
            case MQTT_TOPIC_STATUS:
                console.log('→ Handling: STATUS');
                if (payload.connected === true) {
                    console.log('✓ ESP32 is ONLINE');
                } else if (payload.connected === false) {
                    console.log('✗ ESP32 is OFFLINE');
                    showNotification(
                        '⚠️ ESP32 Offline',
                        'ESP32 device terputus',
                        'warning',
                        3000
                    );
                }
                break;
            default:
                console.log('⚠️ Unknown topic:', topic);
        }
    } catch (error) {
        console.error('✗✗✗ ERROR parsing MQTT message ✗✗✗');
        console.error('Topic:', topic);
        console.error('Message:', message.toString());
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Update sensor status di UI
function updateSensorStatus(data) {
    const irUpIndicator = document.getElementById('irUpIndicator');
    const irDownIndicator = document.getElementById('irDownIndicator');
    const irUpState = document.getElementById('irUpState');
    const irDownState = document.getElementById('irDownState');

    console.log('📡 Sensor Status Update:', data);
    console.log('  ir_down:', data.ir_down, '(IR IN - bola masuk)');
    console.log('  laser_blocked:', data.laser_blocked, '(Laser RX - bola keluar)');
    console.log('  ir_raw:', data.ir_raw, '(0=LOW, 1=HIGH)');
    if (data.laser_raw !== undefined) {
        console.log('  laser_raw:', data.laser_raw, '(0=LOW/blocked, 1=HIGH/clear)');
    }

    // Update IR DOWN (Bola Masuk) - menggunakan field ir_down
    // ir_down = true → ada objek terdeteksi → hijau
    // ir_down = false → tidak ada objek → normal (tidak hijau)
    if (data.ir_down !== undefined) {
        sensorStatus.ir_down = data.ir_down;
        if (irDownIndicator && irDownState) {
            if (data.ir_down) {
                // Ada objek - aktifkan indicator
                irDownIndicator.classList.add('active');
                irDownState.textContent = 'DETECTED';
                irDownState.classList.add('detected');
                console.log('✅ IR IN: Object DETECTED - Indicator GREEN');
            } else {
                // Tidak ada objek - matikan indicator SEMUA class
                irDownIndicator.classList.remove('active');
                irDownState.textContent = 'CLEAR';
                irDownState.classList.remove('detected');
                // Pastikan tidak ada style inline yang tertinggal
                irDownState.style.color = '';
                console.log('⭕ IR IN: No object - Indicator NORMAL (RESET)');
            }
        }
    }

    // Update IR UP/LASER RX (Bola Keluar) - menggunakan field laser_blocked
    // DIBALIK: laser_blocked = true → normal, false → bola lewat
    if (data.laser_blocked !== undefined) {
        sensorStatus.ir_up = !data.laser_blocked; // Balik logika
        if (irUpIndicator && irUpState) {
            if (!data.laser_blocked) {
                // Bola lewat/sinar terhalang - aktifkan indicator HIJAU
                irUpIndicator.classList.add('active');
                irUpState.textContent = 'DETECTED';
                irUpState.classList.add('detected');
                console.log('✅ LASER: Ball Detected - Indicator GREEN (laser_blocked=' + data.laser_blocked + ')');
            } else {
                // Normal/tidak ada bola - indicator NORMAL
                irUpIndicator.classList.remove('active');
                irUpState.textContent = 'CLEAR';
                irUpState.classList.remove('detected');
                // Pastikan tidak ada style inline yang tertinggal
                irUpState.style.color = '';
                console.log('⭕ LASER: Normal - Indicator NORMAL (laser_blocked=' + data.laser_blocked + ')');
            }
        }
    }
    // Fallback untuk kompatibilitas dengan field ir_up lama
    else if (data.ir_up !== undefined) {
        sensorStatus.ir_up = data.ir_up;
        if (irUpIndicator && irUpState) {
            if (data.ir_up) {
                // Detected - aktifkan indicator HIJAU
                irUpIndicator.classList.add('active');
                irUpState.textContent = 'DETECTED';
                irUpState.classList.add('detected');
                console.log('✅ IR UP (OLD): Detected - Indicator GREEN');
            } else {
                // Clear - matikan indicator NORMAL
                irUpIndicator.classList.remove('active');
                irUpState.textContent = 'CLEAR';
                irUpState.classList.remove('detected');
                irUpState.style.color = '';
                console.log('⭕ IR UP (OLD): Clear - Indicator NORMAL (RESET)');
            }
        }
    }
}

// Update counter status di UI
function updateCounterStatus(data) {
    if (data.counter !== undefined) {
        sensorStatus.counter = data.counter;
    }
    if (data.balls_remaining !== undefined) {
        ballsRemaining = data.balls_remaining;
        ballsRemainingDisplay.textContent = ballsRemaining;

        // Update total balls count display
        const totalBallsCount = document.getElementById('totalBallsCount');
        if (totalBallsCount && data.max_balls !== undefined) {
            totalBallsCount.textContent = data.max_balls;
        }
    }

    // Update selected count jika ada
    if (data.selected_count !== undefined) {
        selectedBallCount = data.selected_count;
    }
}

// Handle counter events (bola masuk/keluar)
function handleCounterEvent(data) {
    console.log('Counter Event:', data);

    const ballInDisplay = document.getElementById('ballInDisplay');
    const ballOutDisplay = document.getElementById('ballOutDisplay');
    const ballsInCountDisplay = document.getElementById('ballsInCount');
    const ballsOutCountDisplay = document.getElementById('ballsOutCount');

    // Update sisa bola
    if (data.balls_remaining !== undefined) {
        ballsRemaining = data.balls_remaining;
        ballsRemainingDisplay.textContent = ballsRemaining;

        // Highlight effect pada sisa bola
        ballsRemainingDisplay.style.transform = 'scale(1.5)';
        ballsRemainingDisplay.style.color = '#4CAF50';
        setTimeout(() => {
            ballsRemainingDisplay.style.transform = 'scale(1)';
            ballsRemainingDisplay.style.color = '';
        }, 500);
    }

    // Tampilkan notifikasi berdasarkan event
    if (data.event === 'ball_in') {
        // Bola masuk (IR IN terdeteksi)
        ballsInCount++;
        if (ballsInCountDisplay) {
            ballsInCountDisplay.textContent = ballsInCount;
        }

        // Tampilkan display bola masuk
        if (ballInDisplay) {
            ballInDisplay.style.display = 'flex';
            setTimeout(() => {
                ballInDisplay.style.display = 'none';
            }, 2000);
        }

        // Simpan ke Firebase
        saveBallEventToFirebase('ball_in', data.new_count, ballsInCount, ballsOutCount, data.message);

        showNotification(
            '✅ Bola Masuk',
            `Counter: ${data.new_count}/${data.max_balls}\nMenghitung: 0 → 9\n${data.message}`,
            'success',
            3000
        );
    }
    else if (data.event === 'ball_out') {
        // Bola keluar (IR OUT terdeteksi atau FIRE command)
        ballsOutCount++;
        autoModeBallsDispensed++;
        if (ballsOutCountDisplay) {
            ballsOutCountDisplay.textContent = ballsOutCount;
        }

        // Tampilkan display bola keluar
        if (ballOutDisplay) {
            ballOutDisplay.style.display = 'flex';
            setTimeout(() => {
                ballOutDisplay.style.display = 'none';
            }, 2000);
        }

        // Simpan ke Firebase
        saveBallEventToFirebase('ball_out', data.new_count, ballsInCount, ballsOutCount, data.message);

        // Update progress jika auto mode running
        if (autoModeRunning) {
            updateAutoModeInfo();

            // Cek jika auto mode selesai
            if (autoModeBallsDispensed >= autoModeTargetBalls) {
                // Auto mode selesai
                setTimeout(() => {
                    autoModeComplete();
                }, 1000);
            }
        }

        showNotification(
            '📤 Bola Keluar',
            `Counter: ${data.new_count}/${data.max_balls}\nMotor berhenti saat laser terhalang`,
            'info',
            3000
        );
    }
    else if (data.event === 'auto_complete') {
        // Auto mode selesai dari ESP32
        autoModeComplete();
    }
    else if (data.event === 'max_reached') {
        // Simpan ke Firebase
        saveBallEventToFirebase('max_reached', data.new_count, ballsInCount, ballsOutCount, data.message);

        showNotification(
            '⚠️ Penuh',
            'Maksimal 9 bola! Tidak bisa menambah lagi.',
            'warning',
            3000
        );
    }
    else if (data.event === 'empty') {
        // Stop auto mode jika bola habis
        if (autoModeRunning) {
            stopAutoMode();
        }

        // Simpan ke Firebase
        saveBallEventToFirebase('empty', data.new_count, ballsInCount, ballsOutCount, data.message);

        showNotification(
            '❌ Tidak Ada Bola',
            'Counter = 0\nMasukkan bola (0 → 9) menggunakan IR IN',
            'error',
            4000
        );
    }
    else if (data.event === 'reset') {
        // Reset counter
        ballsInCount = 0;
        ballsOutCount = 0;
        if (ballsInCountDisplay) ballsInCountDisplay.textContent = '0';
        if (ballsOutCountDisplay) ballsOutCountDisplay.textContent = '0';

        // Stop auto mode jika running
        if (autoModeRunning) {
            stopAutoMode();
        }

        // Simpan ke Firebase
        saveBallEventToFirebase('reset', data.new_count, ballsInCount, ballsOutCount, data.message);

        showNotification(
            '🔄 Reset Berhasil',
            `Counter direset ke ${data.new_count} bola`,
            'success',
            3000
        );
    }
}

// Auto mode complete handler
function autoModeComplete() {
    if (!autoModeRunning) return;

    console.log('Auto mode selesai!');

    // Update state
    stopAutoMode();

    // UI Update
    if (isAutoMode) {
        autoStartBtn.style.display = 'block';
    }
    stopBtn.style.display = 'none';
    machineStatusDisplay.textContent = 'Selesai';
    isRunning = false;

    // Show notification
    showNotification(
        '✅ Mode Otomatis Selesai',
        `Berhasil mengeluarkan ${autoModeBallsDispensed} bola!`,
        'success',
        4000
    );

    // Reset machine status setelah 3 detik
    setTimeout(() => {
        machineStatusDisplay.textContent = 'Siap';
    }, 3000);
}

// Update motor status di UI
function updateMotorStatus(data) {
    const motorStatusDisplay = document.getElementById('motorStatus');

    if (data.active !== undefined) {
        sensorStatus.motor_active = data.active;
        if (data.active) {
            motorStatusDisplay.textContent = 'ON';
            motorStatusDisplay.classList.add('active');
        } else {
            motorStatusDisplay.textContent = 'OFF';
            motorStatusDisplay.classList.remove('active');
        }
    }
}

// Update servo status di UI
function updateServoStatus(data) {
    const servoStatusDisplay = document.getElementById('servoStatus');

    if (data.position !== undefined) {
        sensorStatus.servo_position = data.position;
        servoStatusDisplay.textContent = data.position + '°';
    }
}

// Update debug info
function updateDebugInfo(data) {
    // Debug info bisa ditampilkan di console atau UI tambahan
    console.log('WiFi RSSI:', data.wifi_rssi, 'dBm');
    console.log('Free Heap:', data.free_heap, 'bytes');
    console.log('Uptime:', data.uptime, 'seconds');
}

// Publish MQTT message ke ESP32
function publishMQTT(topic, message) {
    if (mqttClient && mqttConnected) {
        mqttClient.publish(topic, message);
        console.log('MQTT Publish [' + topic + ']:', message);
    } else {
        console.warn('MQTT tidak terhubung, tidak dapat publish');
        showNotification(
            '⚠️ MQTT Tidak Terhubung',
            'Tidak dapat mengirim perintah ke ESP32',
            'warning',
            3000
        );
    }
}

// ===========================
// FIREBASE DATABASE FUNCTIONS
// ===========================

// Save ball event to Firebase (bola masuk/keluar/reset)
function saveBallEventToFirebase(event, count, ballsIn, ballsOut, message) {
    // Hanya update /current node, tanpa menyimpan events
    updateCurrentStateToFirebase(count, ballsIn, ballsOut);
}

// Update current state di Firebase
function updateCurrentStateToFirebase(count, ballsIn, ballsOut) {
    const currentData = {
        count: count,
        ballsIn: ballsIn,
        ballsOut: ballsOut,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP,
        lastUpdateDate: new Date().toISOString()
    };

    db.ref('balls/current').update(currentData)
        .then(() => {
            console.log('✓ Current state updated:', currentData);
        })
        .catch((error) => {
            console.error('✗ Firebase update error:', error);
        });
}

// ===========================
// END FIREBASE FUNCTIONS
// ===========================

// ===========================
// END MQTT FUNCTIONS
// ===========================

// Check connection (MQTT based)
async function checkConnection() {
    if (!statusDot || !connectionText) return;

    if (mqttConnected) {
        statusDot.classList.remove('offline');
        connectionText.textContent = 'Terhubung ke Device';
    } else {
        statusDot.classList.add('offline');
        connectionText.textContent = 'Offline - Cek Koneksi';
    }
}

// Check connection setiap 5 detik
setInterval(checkConnection, 5000);

// Initialize Firebase - Cek dan buat data awal jika belum ada
function initFirebaseListener() {
    console.log('Checking Firebase data...');

    // Cek apakah data sudah ada, jika belum buat data awal
    db.ref('balls/current').get().then((snapshot) => {
        if (!snapshot.exists()) {
            console.log('⚠️ Data Firebase belum ada, membuat data awal...');

            // Buat data awal
            const initialData = {
                count: 0,
                ballsIn: 0,
                ballsOut: 0,
                lastUpdate: firebase.database.ServerValue.TIMESTAMP,
                lastUpdateDate: new Date().toISOString()
            };

            db.ref('balls/current').set(initialData)
                .then(() => {
                    console.log('✓ Data awal Firebase berhasil dibuat');
                })
                .catch((error) => {
                    console.error('✗ Gagal membuat data awal:', error);
                });
        } else {
            console.log('✓ Data Firebase sudah ada');
        }
    }).catch((error) => {
        console.error('✗ Error checking Firebase:', error);
    });

    console.log('✓ Firebase initialized');
}

// Initialize
function init() {
    console.log('Initializing application...');
    console.log('System behavior: Count balls IN (0 → 9), count balls OUT');
    console.log('MQTT Broker: EMQX Public Broker (broker.emqx.io)');

    // Update distance buttons dengan saved PWM values
    updateDistanceButtons();

    // Set first distance button as active (60cm)
    if (distanceBtns.length > 0) {
        distanceBtns[0].classList.add('active');
        selectedPWM = pwmSettings[60];
    }

    // Set initial display values
    if (ballCountValue) ballCountValue.textContent = selectedBallCount;
    if (selectedBallsDisplay) selectedBallsDisplay.textContent = selectedBallCount + ' Bola';
    if (selectedDistanceDisplay) selectedDistanceDisplay.textContent = selectedDistance + ' cm';
    if (ballsRemainingDisplay) ballsRemainingDisplay.textContent = ballsRemaining;
    if (modeDisplay) modeDisplay.textContent = 'Manual'; // Default mode

    // Set timer input dan display dari localStorage
    if (timerInput) timerInput.value = autoModeTimer.toFixed(1);
    if (timerValueDisplay) timerValueDisplay.textContent = formatTimer(autoModeTimer) + ' detik';

    // Set initial slider gradient
    if (ballCountSlider) updateSliderGradient(ballCountSlider);

    // Sembunyikan card jumlah bola di awal (mode manual default)
    const ballCountCard = document.getElementById('ballCountCard');
    if (ballCountCard) {
        ballCountCard.style.display = 'none';
    }

    // Sembunyikan card timer di awal (mode manual default)
    const timerCard = document.getElementById('timerCard');
    if (timerCard) {
        timerCard.style.display = 'none';
    }

    // Sembunyikan row target bola di awal
    if (targetBallsRow) {
        targetBallsRow.style.display = 'none';
    }

    // Log initial element status
    console.log('Element check:');
    console.log('  - motorStatusDisplay:', motorStatusDisplay ? '✓' : '✗');
    console.log('  - servoStatusDisplay:', servoStatusDisplay ? '✓' : '✗');
    console.log('  - machineStatusDisplay:', machineStatusDisplay ? '✓' : '✗');
    console.log('Initial balls remaining:', ballsRemaining, '(sesuai INITIAL_BALLS di firmware)');
    console.log('Auto mode timer:', autoModeTimer, 'seconds (TANPA BATAS)');
    console.log('EMQX Public Broker:', MQTT_BROKER);
    console.log('WebSocket Secure Port:', MQTT_PORT);

    // Initialize Firebase listener
    initFirebaseListener();

    // Initialize MQTT connection
    console.log('DOM ready, starting MQTT connection...');
    initMQTT();
}

// Tunggu DOM sepenuhnya loaded sebelum menjalankan init()
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // DOM sudah ready
    init();
}
