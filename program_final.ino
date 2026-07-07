// KONFIGURASI PIN
#include <WiFi.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>


// KONFIGURASI WiFi
const char* WIFI_SSID = "redmi note 8";
const char* WIFI_PASSWORD = "12345678";


// KONFIGURASI MQTT EMQX
const char* MQTT_BROKER = "broker.emqx.io";
const int MQTT_PORT = 1883;
char MQTT_CLIENT_ID[50] = "esp32_billiard_";  // Buffer untuk client ID dinamis

// MQTT Topics
const char* MQTT_TOPIC_STATUS = "billiard/esp32/status";
const char* MQTT_TOPIC_SENSOR = "billiard/esp32/sensor";
const char* MQTT_TOPIC_COUNTER = "billiard/esp32/counter";
const char* MQTT_TOPIC_COUNTER_EVENT = "billiard/esp32/counter_event";
const char* MQTT_TOPIC_MOTOR = "billiard/esp32/motor";
const char* MQTT_TOPIC_SERVO = "billiard/esp32/servo";
const char* MQTT_TOPIC_DEBUG = "billiard/esp32/debug";

// Command Topics (Web → ESP32)
const char* MQTT_TOPIC_COMMAND = "billiard/web/command";
const char* MQTT_TOPIC_FIRE = "billiard/web/fire";
const char* MQTT_TOPIC_DISTANCE = "billiard/web/distance";
const char* MQTT_TOPIC_PWM = "billiard/web/pwm";
const char* MQTT_TOPIC_RESET = "billiard/web/reset";


// KONFIGURASI PIN
// Motor L298N
const int MOTOR_IN1 = 18;
const int MOTOR_IN2 = 19;
const int MOTOR_EN  = 21;

// Servo
const int SERVO_PIN = 25;
const int SERVO_OPEN_ANGLE = -180;   // Sudut buka pintu
const int SERVO_CLOSE_ANGLE = 90;   // Sudut tutup pintu (menahan bola)

// KONFIGURASI KECEPATAN SERVO
// Atur kecepatan gerakan servo (semakin besar semakin lambat)
const int SERVO_OPEN_DELAY = 1000;   // Delay servo buka (ms) - default 800
const int SERVO_CLOSE_DELAY = 5;  // Delay servo tutup (ms) - default 300
const int SERVO_STEP_DELAY = 5;    // Delay per step gerakan (ms) - default 30
                                    // Set 0 untuk langsung (tanpa smooth)
                                    // Set 10-50 untuk gerakan smooth

const bool SERVO_SMOOTH_MODE = false; // true = gerakan perlahan, false = langsung

// Sensor IR & Laser
const int IR_IN_PIN    = 16;   // IR Masuk - Counter bola masuk (0→9)
const int LASER_TX_PIN = 23;   // Laser Transmitter - Selalu HIGH (ON)
const int LASER_RX_PIN = 27;   // Laser Receiver - Detect bola keluar (HIGH=tidak terhalang, LOW=terhalang)

// Jika sensor Anda terbalik (hijau saat tidak ada objek), ubah nilai ini
const bool IR_ACTIVE_LOW = true;  // true untuk sensor umum (LOW=ada objek), false jika terbalik

// KONFIGURASI COUNTER
int ballsCount = 0;         // Bola yang tersisa saat ini
int ballsIn = 0;            // Total bola masuk
int ballsOut = 0;           // Total bola keluar
const int MAX_BALLS = 9;    // Maksimal bola
const int MIN_BALLS = 0;
const int INITIAL_BALLS = 0; // Jumlah bola awal (ubah ke 9 untuk langsung mulai dengan 9 bola)

// KONFIGURASI DEBOUNCE
const unsigned long DEBOUNCE_DELAY = 150;
unsigned long lastDebounceTimeIn = 0;
unsigned long lastDebounceTimeOut = 0;

// Variables untuk edge detection
int lastIrInState = HIGH;
int lastLaserRxState = HIGH;

// Variables untuk steady state (debouncing)
int irInSteadyState = HIGH;
int laserRxSteadyState = HIGH;

// VARIABEL MOTOR & DISPENSING
bool motorActive = false;
bool dispensingInProgress = false;
int motorPWM = 500;  // Default PWM untuk motor (0-1023)
int targetDistance = 90;  // Default jarak target dalam cm


// VARIABEL MODE OTOMATIS

bool autoModeActive = false;
int autoModeTargetBalls = 0;
int autoModeBallsDispensed = 0;
float autoModeTimer = 2.0;  // Timer periode dalam detik (default 2 detik)


// WIFI & MQTT OBJECTS
WiFiClient espClient;
PubSubClient mqttClient(espClient);
Servo myservo;

// Variables untuk MQTT timing
unsigned long lastMQTTConnect = 0;
const unsigned long MQTT_RECONNECT_INTERVAL = 5000;
unsigned long lastStatusUpdate = 0;
const unsigned long STATUS_UPDATE_INTERVAL = 2000;

// SETUP
void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("========================================");
    Serial.println("   ESP32 Billiard Ball Counter");
    Serial.println("   MQTT Mode - EMQX Public Broker");
    Serial.println("========================================");

    // Generate unique MQTT client ID menggunakan MAC address
    uint8_t mac[6];
    WiFi.macAddress(mac);
    sprintf(MQTT_CLIENT_ID, "esp32_billiard_%02x%02x%02x", mac[3], mac[4], mac[5]);
    Serial.print("MQTT Client ID: ");
    Serial.println(MQTT_CLIENT_ID);

    // Setup WiFi
    setupWiFi();

    // Setup MQTT
    setupMQTT();

    // Konfigurasi PWM Motor (ESP32 Arduino Core 3.0+)
    ledcAttach(MOTOR_EN, 5000, 10);  // 10-bit resolution (0-1023)

    // Konfigurasi pin Motor
    pinMode(MOTOR_IN1, OUTPUT);
    pinMode(MOTOR_IN2, OUTPUT);

    // Matikan motor awal
    digitalWrite(MOTOR_IN1, LOW);
    digitalWrite(MOTOR_IN2, LOW);
    ledcWrite(MOTOR_EN, 0);

    // Konfigurasi Servo - Mulai TERTUTUP (menahan bola)
    myservo.setPeriodHertz(50);
    myservo.attach(SERVO_PIN, 500, 2400);
    myservo.write(SERVO_CLOSE_ANGLE);

    // Konfigurasi pin Sensor IR & Laser
    pinMode(IR_IN_PIN, INPUT);
    pinMode(LASER_TX_PIN, OUTPUT);     // Laser Transmitter sebagai output
    digitalWrite(LASER_TX_PIN, HIGH);  // Laser transmitter selalu ON
    pinMode(LASER_RX_PIN, INPUT);      // Laser Receiver sebagai input

    // Inisialisasi counter dengan nilai awal
    ballsCount = INITIAL_BALLS;

    // Baca nilai awal sensor untuk debugging
    int initialIrValue = digitalRead(IR_IN_PIN);
    int initialLaserRxValue = digitalRead(LASER_RX_PIN);

    Serial.println("========================================");
    Serial.println("KONFIGURASI SENSOR:");
    Serial.print("PIN 16 (IR IN)       : Counter bola masuk 0->9 [");
    Serial.print(IR_ACTIVE_LOW ? "ACTIVE LOW" : "ACTIVE HIGH");
    Serial.println("]");
    Serial.print("  - Current Value: ");
    Serial.println(initialIrValue == HIGH ? "HIGH (tidak ada objek)" : "LOW (objek terdeteksi)");
    Serial.println("PIN 23 (LASER TX)    : Transmitter (selalu ON)");
    Serial.print("PIN 27 (LASER RX)    : Receiver bola keluar [Current: ");
    Serial.print(initialLaserRxValue == HIGH ? "HIGH (tidak terhalang)" : "LOW (terhalang)");
    Serial.println("]");
    Serial.println("PWM Range: 0-1023");
    Serial.print("Initial Balls: ");
    Serial.println(ballsCount);
    Serial.println("========================================\n");
}

void loop() {
    // Read current sensor states
    int currentIrInState = digitalRead(IR_IN_PIN);
    int currentLaserRxState = digitalRead(LASER_RX_PIN);

    // Handle MQTT connection
    handleMQTTConnection();

    // Handle MQTT messages
    if (mqttClient.connected()) {
        mqttClient.loop();
    }

    // Handle IR IN Sensor dengan steady state
    handleIrInSensorWithState(currentIrInState);

    // Handle Laser Receiver OUT Sensor dengan steady state
    handleLaserRxSensorWithState(currentLaserRxState);

    // Publish status update secara berkala
    if (millis() - lastStatusUpdate > STATUS_UPDATE_INTERVAL) {
        publishStatus();
        lastStatusUpdate = millis();
    }

    delay(20);
}

// WIFI SETUP
void setupWiFi() {
    Serial.print("Menghubungkan ke WiFi: ");
    Serial.println(WIFI_SSID);

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    // Timeout 20 detik untuk koneksi WiFi
    int timeout = 40; // 40 x 500ms = 20 detik
    while (WiFi.status() != WL_CONNECTED && timeout > 0) {
        delay(500);
        Serial.print(".");
        timeout--;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n✓ WiFi Terhubung!");
        Serial.print("IP Address: ");
        Serial.println(WiFi.localIP());
        Serial.print("Signal Strength: ");
        Serial.print(WiFi.RSSI());
        Serial.println(" dBm");
    } else {
        Serial.println("\n✗ WiFi Gagal Terhubung!");
        Serial.println("Melanjutkan tanpa WiFi...");
    }
}

// MQTT SETUP
void setupMQTT() {
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
}

// MQTT CONNECTION HANDLER
void handleMQTTConnection() {
    if (!mqttClient.connected() && millis() - lastMQTTConnect > MQTT_RECONNECT_INTERVAL) {
        reconnectMQTT();
        lastMQTTConnect = millis();
    }
}

void reconnectMQTT() {
    Serial.println("========================================");
    Serial.println("Menghubungkan ke MQTT Broker...");
    Serial.print("Broker: ");
    Serial.println(MQTT_BROKER);
    Serial.print("Client ID: ");
    Serial.println(MQTT_CLIENT_ID);

    // Connect dengan Last Will
    if (mqttClient.connect(MQTT_CLIENT_ID)) {
        Serial.println("✓ MQTT Terhubung!");

        // Subscribe ke topics
        mqttClient.subscribe(MQTT_TOPIC_COMMAND);
        mqttClient.subscribe(MQTT_TOPIC_FIRE);
        mqttClient.subscribe(MQTT_TOPIC_DISTANCE);
        mqttClient.subscribe(MQTT_TOPIC_PWM);
        mqttClient.subscribe(MQTT_TOPIC_RESET);

        Serial.println("✓ Subscribed ke command topics:");
        Serial.println("  - billiard/web/command");
        Serial.println("  - billiard/web/fire");
        Serial.println("  - billiard/web/distance");
        Serial.println("  - billiard/web/pwm");
        Serial.println("  - billiard/web/reset");

        // Publish status connected
        publishConnectionStatus(true);

        // Publish initial status
        Serial.println("✓ Publishing initial status...");
        publishStatus();
        Serial.println("========================================");
    } else {
        Serial.print("✗ MQTT Gagal terhubung, rc=");
        Serial.print(mqttClient.state());
        Serial.println(" -> coba lagi dalam 5 detik");
        Serial.println("  rc=-2: MQTT connection timeout");
        Serial.println("  rc=-4: MQTT connection failed");
        Serial.println("========================================");
    }
}

// MQTT CALLBACK
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    Serial.println("\n========================================");
    Serial.println("MQTT MESSAGE RECEIVED");
    Serial.print("Topic: ");
    Serial.println(topic);
    Serial.print("Payload: ");

    String message = "";
    for (unsigned int i = 0; i < length; i++) {
        message += (char)payload[i];
    }
    Serial.println(message);
    Serial.println("========================================\n");

    // Handle command topics
    if (strcmp(topic, MQTT_TOPIC_FIRE) == 0) {
        handleFireCommand(message);
    }
    else if (strcmp(topic, MQTT_TOPIC_COMMAND) == 0) {
        handleCommand(message);
    }
    else if (strcmp(topic, MQTT_TOPIC_DISTANCE) == 0) {
        targetDistance = message.toInt();
        Serial.print("[MQTT] Target Distance: ");
        Serial.println(targetDistance);
    }
    else if (strcmp(topic, MQTT_TOPIC_PWM) == 0) {
        int newPwm = message.toInt();
        if (newPwm >= 0 && newPwm <= 1023) {
            motorPWM = newPwm;
            Serial.print("[MQTT] PWM set to: ");
            Serial.println(motorPWM);

            // Update motor jika sedang aktif
            if (motorActive) {
                ledcWrite(MOTOR_EN, motorPWM);
            }

            // Publish motor status
            publishMotorStatus();
        } else {
            Serial.println("[MQTT] Invalid PWM range (0-1023)");
        }
    }
    else if (strcmp(topic, MQTT_TOPIC_RESET) == 0) {
        resetCounter();
    }
}


// HANDLE FIRE COMMAND
void handleFireCommand(String message) {
    if (ballsCount > 0) {
        Serial.println("[MQTT] FIRE - Keluarkan bola");
        dispenseBall();
    } else {
        Serial.println("[!] Tidak ada bola!");
        publishCounterEvent("empty", ballsCount, "Bola habis! Reset dulu.");
    }
}

// HANDLE COMMAND
void handleCommand(String message) {
    Serial.println("[CMD] Message: " + message);

    // Cek command START_AUTO (mode otomatis)
    if (message.indexOf("START_AUTO") >= 0) {
        // Parse JSON untuk mendapatkan ballCount dan timer
        int ballCountPos = message.indexOf("\"ballCount\":");
        int timerPos = message.indexOf("\"timer\":");

        if (ballCountPos > 0) {
            int ballCount = 0;
            int valueStart = ballCountPos + 12; // Setelah "ballCount":

            // Parse nilai ballCount
            String countStr = "";
            for (unsigned int i = valueStart; i < message.length(); i++) {
                char c = message.charAt(i);
                if (isdigit(c)) {
                    countStr += c;
                } else if (c == '}' || c == ',') {
                    break;
                }
            }
            ballCount = countStr.toInt();

            // Parse nilai timer jika ada
            if (timerPos > 0) {
                valueStart = timerPos + 8; // Setelah "timer":
                String timerStr = "";
                bool hasDecimal = false;

                for (unsigned int i = valueStart; i < message.length(); i++) {
                    char c = message.charAt(i);
                    if (isdigit(c) || c == '.') {
                        timerStr += c;
                        if (c == '.') hasDecimal = true;
                    } else if (c == '}' || c == ',') {
                        break;
                    }
                }
                autoModeTimer = timerStr.toFloat();
                Serial.print("[CMD] Timer diatur ke: ");
                Serial.println(autoModeTimer);
            } else {
                // Default timer jika tidak di-set
                autoModeTimer = 2.0;
            }

            Serial.print("[CMD] START_AUTO dengan ");
            Serial.print(ballCount);
            Serial.print(" bola, timer ");
            Serial.print(autoModeTimer);
            Serial.println(" detik");

            // Mulai mode otomatis
            startAutoMode(ballCount);
        } else {
            Serial.println("[!] START_AUTO tanpa ballCount!");
        }
    }
    // Cek command START (manual single shot)
    else if (message.indexOf("START") >= 0 && message.indexOf("START_AUTO") < 0) {
        if (ballsCount > 0) {
            Serial.println("[MQTT] START - Keluarkan bola");
            dispenseBall();
        } else {
            Serial.println("[!] Tidak ada bola!");
            publishCounterEvent("empty", ballsCount, "Bola habis! Reset dulu.");
        }
    }
    else if (message.indexOf("STOP") == 0) {
        Serial.println("[MQTT] STOP");
        stopAutoMode(); // Stop auto mode jika aktif
        stopMotor();
        myservo.write(SERVO_CLOSE_ANGLE);
        dispensingInProgress = false;
    }
}


// START AUTO MODE
// Memulai mode otomatis untuk mengeluarkan N bola
// Sistem akan berulang:
// - Servo buka → Motor ON → IR deteksi → Motor OFF
// - Ulangi sebanyak N kali
void startAutoMode(int ballCount) {
    if (ballsCount <= 0) {
        Serial.println("[AUTO] ! Tidak ada bola untuk mode otomatis !");
        publishCounterEvent("empty", ballsCount, "Bola habis! Reset dulu.");
        return;
    }

    if (ballCount > ballsCount) {
        Serial.print("[AUTO] ! Jumlah bola terlalu banyak ! Hanya tersisa ");
        Serial.println(ballsCount);
        publishCounterEvent("error", ballsCount, "Jumlah bola melebihi sisa!");
        return;
    }

    Serial.println("========================================");
    Serial.println("[AUTO] === MODE OTOMATIS DIMULAI ===");
    Serial.print("[AUTO] Target: ");
    Serial.print(ballCount);
    Serial.println(" bola");
    Serial.print("[AUTO] Sisa bola saat ini: ");
    Serial.println(ballsCount);
    Serial.println("========================================");

    // Set auto mode state
    autoModeActive = true;
    autoModeTargetBalls = ballCount;
    autoModeBallsDispensed = 0;

    // Keluarkan bola pertama
    Serial.println("[AUTO] Memulai bola #1...");
    dispenseBall();
}

// STOP AUTO MODE

void stopAutoMode() {
    if (autoModeActive) {
        Serial.println("[AUTO] Mode otomatis dihentikan");
        autoModeActive = false;
        autoModeTargetBalls = 0;
        autoModeBallsDispensed = 0;
    }
}


// HANDLE IR IN SENSOR (BOLA MASUK - COUNTER)
void handleIrInSensorWithState(int currentIrInState) {
    // Cek apakah state berubah
    if (currentIrInState != lastIrInState) {
        lastDebounceTimeIn = millis();
    }

    // Jika sudah lewat waktu debounce
    if ((millis() - lastDebounceTimeIn) > DEBOUNCE_DELAY) {
        // Cek apakah state steady berubah
        if (currentIrInState != irInSteadyState) {
            irInSteadyState = currentIrInState;

            // Deteksi objek berdasarkan konfigurasi Active LOW/HIGH
            bool objectDetected = IR_ACTIVE_LOW ? (irInSteadyState == LOW) : (irInSteadyState == HIGH);

            if (objectDetected) {
                // Objek terdeteksi - bola masuk
                if (ballsCount < MAX_BALLS) {
                    ballsCount++;
                    ballsIn++;
                    Serial.print("[IN] Bola masuk! Count: ");
                    Serial.println(ballsCount);

                    // Publish ke MQTT
                    publishCounterEvent("ball_in", ballsCount, "Bola masuk terdeteksi");
                    publishCounter();
                    publishSensorStatus();

                    if (ballsCount >= MAX_BALLS) {
                        Serial.println("[!] PENUH! (9/9)");
                        publishCounterEvent("max_reached", ballsCount, "Maksimal 9 bola!");
                    }
                }
            } else {
                // Objek telah lewat, sensor kembali clear
                Serial.println("[IR] Sensor kembali CLEAR - reset indicator web");
                // Publish update status sensor untuk reset indicator di web
                publishSensorStatus();
            }
        }
    }
    lastIrInState = currentIrInState;
}

// HANDLE LASER RECEIVER SENSOR (BOLA KELUAR - STOP MOTOR)
void handleLaserRxSensorWithState(int currentLaserRxState) {
    // Cek apakah state berubah
    if (currentLaserRxState != lastLaserRxState) {
        lastDebounceTimeOut = millis();
    }

    // Jika sudah lewat waktu debounce
    if ((millis() - lastDebounceTimeOut) > DEBOUNCE_DELAY) {
        // Cek apakah state steady berubah
        if (currentLaserRxState != laserRxSteadyState) {
            laserRxSteadyState = currentLaserRxState;

            // Deteksi FALLING edge (HIGH -> LOW) = sinar laser terhalang oleh bola
            if (laserRxSteadyState == LOW) {
                if (motorActive) {
                    if (ballsCount > MIN_BALLS) {
                        ballsCount--;
                        ballsOut++;

                        // Increment auto mode counter
                        if (autoModeActive) {
                            autoModeBallsDispensed++;
                        }

                        Serial.print("[OUT] Bola keluar! Count: ");
                        Serial.print(ballsCount);

                        if (autoModeActive) {
                            Serial.print(" | Auto: ");
                            Serial.print(autoModeBallsDispensed);
                            Serial.print("/");
                            Serial.println(autoModeTargetBalls);
                        } else {
                            Serial.println();
                        }

                        stopMotor();
                        delay(SERVO_CLOSE_DELAY);
                        myservo.write(SERVO_CLOSE_ANGLE);
                        dispensingInProgress = false;

                        // Publish ke MQTT
                        publishCounterEvent("ball_out", ballsCount, "Bola keluar terdeteksi");
                        publishCounter();
                        publishSensorStatus();
                        publishMotorStatus();

                        // Cek auto mode
                        if (autoModeActive) {
                            Serial.print("[AUTO] Progress: ");
                            Serial.print(autoModeBallsDispensed);
                            Serial.print("/");
                            Serial.print(autoModeTargetBalls);
                            Serial.println(" bola");

                            if (autoModeBallsDispensed >= autoModeTargetBalls) {
                                // Auto mode selesai
                                Serial.println("[AUTO] ===== MODE OTOMATIS SELESAI =====");
                                Serial.print("[AUTO] Total bola dikeluarkan: ");
                                Serial.println(autoModeBallsDispensed);
                                publishCounterEvent("auto_complete", ballsCount, "Mode otomatis selesai");
                                stopAutoMode();
                            } else {
                                // Lanjutkan ke bola berikutnya
                                Serial.println("[AUTO] Menyiapkan bola berikutnya...");

                                if (ballsCount > 0) {
                                    Serial.println("[AUTO] === Memanggil dispenseBall() ===");
                                    dispenseBall();
                                } else {
                                    Serial.println("[AUTO] ! Bola habis di tengah auto mode !");
                                    publishCounterEvent("empty", ballsCount, "Bola habis!");
                                    stopAutoMode();
                                }
                            }
                        }

                        if (ballsCount == 0) {
                            Serial.println("[!] HABIS!");
                            publishCounterEvent("empty", ballsCount, "Bola habis!");
                        }
                    } else {
                        stopMotor();
                        if (autoModeActive) {
                            Serial.println("[!] Bola habis di tengah auto mode!");
                            publishCounterEvent("empty", ballsCount, "Bola habis!");
                            stopAutoMode();
                        }
                    }
                }
            }
            // Deteksi RISING edge (LOW -> HIGH) = sinar laser kembali clear
            else if (laserRxSteadyState == HIGH) {
                // Bola telah lewat, sinar kembali clear
                Serial.println("[LASER] Sinar kembali CLEAR");
                // Publish update status sensor untuk reset indicator di web
                publishSensorStatus();
            }
        }
    }
    lastLaserRxState = currentLaserRxState;
}

// FUNGSI SERVO - MOVE SERVO SMOOTH
// Menggerakkan servo dari posisi saat ini ke target angle
// dengan kecepatan yang bisa diatur
void moveServo(int targetAngle) {
    int currentAngle = myservo.read();

    if (SERVO_SMOOTH_MODE && SERVO_STEP_DELAY > 0) {
        // Mode smooth - gerakan bertahap
        if (targetAngle > currentAngle) {
            // Gerak ke atas (90 -> 180)
            for (int angle = currentAngle; angle <= targetAngle; angle++) {
                myservo.write(angle);
                delay(SERVO_STEP_DELAY);
            }
        } else {
            // Gerak ke bawah (180 -> 90)
            for (int angle = currentAngle; angle >= targetAngle; angle--) {
                myservo.write(angle);
                delay(SERVO_STEP_DELAY);
            }
        }
    } else {
        // Mode langsung - tanpa smooth
        myservo.write(targetAngle);
    }

    publishServoStatus(targetAngle);
}

// DISPENSE BALL (KELUARKAN BOLA)
void dispenseBall() {
    if (ballsCount <= 0) {
        Serial.println("[!] Tidak ada bola!");
        return;
    }

    if (dispensingInProgress) {
        return;
    }

    dispensingInProgress = true;

    Serial.println("[DISPENSE] === Mulai Proses Keluarkan Bola ===");

    // 1. Buka servo (180°) - biarkan bola jatuh
    Serial.print("[DISPENSE] Servo: ");
    Serial.print(myservo.read());
    Serial.print("° → ");
    Serial.print(SERVO_OPEN_ANGLE);
    Serial.println("° (BUKA)");
    moveServo(SERVO_OPEN_ANGLE);
    delay(SERVO_OPEN_DELAY);

    // 2. Tutup servo (90°) - kembali menahan bola
    Serial.print("[DISPENSE] Servo: ");
    Serial.print(SERVO_OPEN_ANGLE);
    Serial.print("° → ");
    Serial.print(SERVO_CLOSE_ANGLE);
    Serial.println("° (TUTUP)");
    moveServo(SERVO_CLOSE_ANGLE);
    delay(SERVO_CLOSE_DELAY);

    // 3. Jika mode otomatis, delay sesuai timer setting
    if (autoModeActive) {
        Serial.print("[AUTO] Delay timer: ");
        Serial.print(autoModeTimer);
        Serial.println(" detik sebelum motor aktif");
        delay(autoModeTimer * 1000);
    }

    // 4. Aktifkan motor - dorong bola keluar
    Serial.println("[DISPENSE] Motor: AKTIF - Menunggu bola menghalangi sinar laser...");
    startMotor();
}

// FUNGSI MOTOR
void startMotor() {
    motorActive = true;
    digitalWrite(MOTOR_IN1, HIGH);
    digitalWrite(MOTOR_IN2, LOW);
    ledcWrite(MOTOR_EN, motorPWM);
    publishMotorStatus();
}

void stopMotor() {
    Serial.println("[MOTOR] MATI - Bola terdeteksi oleh laser receiver");
    motorActive = false;
    digitalWrite(MOTOR_IN1, LOW);
    digitalWrite(MOTOR_IN2, LOW);
    ledcWrite(MOTOR_EN, 0);
    publishMotorStatus();
}

// RESET COUNTER
void resetCounter() {
    ballsCount = MIN_BALLS;
    ballsIn = 0;
    ballsOut = 0;
    Serial.println("[CMD] RESET - Counter = 0");

    // Stop auto mode jika aktif
    if (autoModeActive) {
        stopAutoMode();
    }

    if (dispensingInProgress) {
        stopMotor();
        myservo.write(SERVO_CLOSE_ANGLE);
        dispensingInProgress = false;
    }

    // Publish ke MQTT
    publishCounterEvent("reset", ballsCount, "Counter direset");
    publishCounter();
}

// MQTT PUBLISH FUNCTIONS
void publishConnectionStatus(bool connected) {
    String payload = "{\"connected\":";
    payload += connected ? "true" : "false";
    payload += "}";
    mqttClient.publish(MQTT_TOPIC_STATUS, payload.c_str());
}

void publishSensorStatus() {
    int irInValue = digitalRead(IR_IN_PIN);
    // IR_ACTIVE_LOW=true: LOW=ada objek, HIGH=tidak ada objek
    // IR_ACTIVE_LOW=false: HIGH=ada objek, LOW=tidak ada objek
    bool irInDetected = IR_ACTIVE_LOW ? (irInValue == LOW) : (irInValue == HIGH);

    int laserRxValue = digitalRead(LASER_RX_PIN);
    // Laser: LOW=terhalang (ada bola), HIGH=tidak terhalang (clear)
    bool laserRxDetected = (laserRxValue == LOW);

    String payload = "{\"ir_down\":";
    payload += irInDetected ? "true" : "false";
    payload += ",\"laser_blocked\":";
    payload += laserRxDetected ? "true" : "false";
    payload += ",\"ir_raw\":";
    payload += irInValue;
    payload += ",\"laser_raw\":";
    payload += laserRxValue;
    payload += "}";
    mqttClient.publish(MQTT_TOPIC_SENSOR, payload.c_str());

    // Debug untuk troubleshooting
    Serial.print("[SENSOR] IR:");
    Serial.print(irInValue == HIGH ? "HIGH" : "LOW");
    Serial.print(irInDetected ? "(DETECTED)" : "(CLEAR)");
    Serial.print(" | Laser:");
    Serial.print(laserRxValue == HIGH ? "HIGH" : "LOW");
    Serial.println(laserRxDetected ? "(BLOCKED)" : "(CLEAR)");
}

void publishCounter() {
    String payload = "{\"counter\":";
    payload += ballsCount;
    payload += ",\"balls_remaining\":";
    payload += ballsCount;
    payload += ",\"max_balls\":";
    payload += MAX_BALLS;
    payload += ",\"balls_in\":";
    payload += ballsIn;
    payload += ",\"balls_out\":";
    payload += ballsOut;

    // Tambahkan info auto mode jika aktif
    if (autoModeActive) {
        payload += ",\"auto_mode\":true";
        payload += ",\"auto_target\":";
        payload += autoModeTargetBalls;
        payload += ",\"auto_dispensed\":";
        payload += autoModeBallsDispensed;
    } else {
        payload += ",\"auto_mode\":false";
    }

    payload += "}";
    mqttClient.publish(MQTT_TOPIC_COUNTER, payload.c_str());
}

void publishCounterEvent(const char* event, int newCount, const char* message) {
    String payload = "{\"event\":\"";
    payload += event;
    payload += "\",\"new_count\":";
    payload += newCount;
    payload += ",\"max_balls\":";
    payload += MAX_BALLS;
    payload += ",\"message\":\"";
    payload += message;
    payload += "\"}";
    mqttClient.publish(MQTT_TOPIC_COUNTER_EVENT, payload.c_str());
}

void publishMotorStatus() {
    String payload = "{\"active\":";
    payload += motorActive ? "true" : "false";
    payload += ",\"pwm\":";
    payload += motorPWM;
    payload += "}";
    mqttClient.publish(MQTT_TOPIC_MOTOR, payload.c_str());
}

void publishServoStatus(int position) {
    String payload = "{\"position\":";
    payload += position;
    payload += "}";
    mqttClient.publish(MQTT_TOPIC_SERVO, payload.c_str());
}

void publishStatus() {
    // Publish semua status secara berkala
    publishSensorStatus();
    publishCounter();
    publishMotorStatus();
    publishServoStatus(myservo.read());

    // Debug info
    String payload = "{\"wifi_rssi\":";
    payload += WiFi.RSSI();
    payload += ",\"free_heap\":";
    payload += ESP.getFreeHeap();
    payload += ",\"uptime\":";
    payload += millis() / 1000;
    payload += "}";
    mqttClient.publish(MQTT_TOPIC_DEBUG, payload.c_str());
}