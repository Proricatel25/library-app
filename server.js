const express = require("express");
const { Pool } = require("pg");
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

app.use(express.json());
app.use(cors());

// Раздача статических файлов
app.use(express.static('public'));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== ПОДКЛЮЧЕНИЕ К БД (исправлено для Amvera/Supabase) =====
const pool = new Pool({
  // Для Supabase используем переменные окружения
  connectionString: process.env.DATABASE_URL || 
    `postgresql://postgres:1234@localhost:5432/library`,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,
  // Fallback для локальной разработки
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "library",
  password: process.env.PGPASSWORD || "1234",
  port: process.env.PGPORT || 5432,
});

// 🔥 НАСТРОЙКИ ПОЧТЫ
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
    console.error('Проверьте переменные окружения DATABASE_URL');
  } else {
    console.log('✅ Подключение к базе данных установлено');
    console.log('Host:', process.env.PGHOST || 'localhost');
    console.log('Database:', process.env.PGDATABASE || 'library');
    release();
  }
});

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 🔥 Функция форматирования даты
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
// ... (весь остальной код остается БЕЗ ИЗМЕНЕНИЙ) ...
// Скопируй ВСЕ функции начиная от app.post("/register/send-code" 
// и до конца файла БЕЗ ИЗМЕНЕНИЙ

// ===== ЗАПУСК СЕРВЕРА (исправлено) =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});