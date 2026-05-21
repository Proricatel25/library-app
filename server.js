const express = require("express");
const { Pool } = require("pg");
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

app.use(express.json());
app.use(cors());

// Раздача статических файлов - ПРОВЕРЬ ПУТЬ
app.use(express.static(path.join(__dirname, 'public')));

// Главная страница
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    console.log('📄 Ищу файл:', indexPath); // Для отладки
    res.sendFile(indexPath);
});

// ===== ПОДКЛЮЧЕНИЕ К БД (исправлено для Amvera/Supabase) =====
const pool = new Pool({
  // Используем DATABASE_URL из переменных окружения
  connectionString: process.env.DATABASE_URL,
  // SSL обязателен для Supabase в продакшене
  ssl: {
    rejectUnauthorized: false
  },
  // Fallback для локальной разработки (если DATABASE_URL не задан)
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "library",
  password: process.env.PGPASSWORD || "1234",
  port: process.env.PGPORT || 5432,
});

// 🔥 НАСТРОЙКИ ПОЧТЫ (с поддержкой переменных окружения)
const EMAIL_CONFIG = {
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER || 'proricatelmiphifig@gmail.com',
    pass: process.env.EMAIL_PASS || 'nqbvdewukhqwrkpa'
  },
  tls: {
    rejectUnauthorized: false
  }
};

// Создание транспортера
const transporter = nodemailer.createTransport(EMAIL_CONFIG);

// Проверка подключения к почте
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Ошибка подключения к почте:', error.message);
  } else {
    console.log('✅ Почта готова к отправке');
  }
});

// Начальное количество экземпляров
const INITIAL_BOOK_COUNT = 15;

// Проверка подключения к БД
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err.message);
    console.error('💡 Проверьте переменную DATABASE_URL в Amvera');
    console.error('💡 Убедитесь, что пароль закодирован (например, # → %23)');
  } else {
    console.log('✅ Подключение к базе данных установлено');
    console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
    release();
  }
});

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric' 
  });
}

async function getAvailableCount(bookId) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM book_distribution 
       WHERE book_id = $1 AND date_return IS NULL`,
      [bookId]
    );
    return INITIAL_BOOK_COUNT - parseInt(result.rows[0].count);
  } catch (error) {
    console.error("❌ getAvailableCount error:", error);
    return INITIAL_BOOK_COUNT;
  }
}

// ===== РЕГИСТРАЦИЯ С ПОДТВЕРЖДЕНИЕМ =====
// ... [ВСЕ ОСТАЛЬНЫЕ МАРШРУТЫ ОСТАЮТСЯ БЕЗ ИЗМЕНЕНИЙ] ...
// Скопируй весь код от app.post("/register/send-code" 
// и до "// ===== ЗАПУСК СЕРВЕРА =====" без изменений

// ===== ЗАПУСК СЕРВЕРА (исправлено для Amvera) =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});