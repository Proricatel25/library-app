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

// Подключение к БД
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "library",
  password: "1234",
  port: 5432,
});

// 🔥 НАСТРОЙКИ ПОЧТЫ
const EMAIL_CONFIG = {
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'proricatelmiphifig@gmail.com',
    pass: 'nqbvdewukhqwrkpa'
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
  } else {
    console.log('✅ Подключение к базе данных установлено');
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

app.post("/register/send-code", async (req, res) => {
  const { login, password, email } = req.body;
  console.log('📧 Запрос кода подтверждения:', email);

  try {
    const existing = await pool.query(
      "SELECT id FROM reader WHERE login = $1 OR email = $2",
      [login, email]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Такой логин или email уже занят" });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const userResult = await pool.query(
      `INSERT INTO reader (login, password, email, name, surname, phonenumber, is_active) 
       VALUES ($1, $2, $3, NULL, NULL, NULL, false)
       RETURNING id`,
      [login, password, email]
    );
    
    const userId = userResult.rows[0].id;

    await pool.query(
      `INSERT INTO verification_codes (user_id, code, email, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, code, email, expiresAt]
    );

    try {
      await transporter.sendMail({
        from: `"Библиотека" <${EMAIL_CONFIG.auth.user}>`,
        to: email,
        subject: '📚 Подтверждение регистрации',
        text: `Ваш код подтверждения: ${code}\nКод действителен 10 минут.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #667eea;">📚 Библиотека</h2>
            <p>Здравствуйте!</p>
            <p>Для завершения регистрации введите код:</p>
            <div style="background: #f0f0f0; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <h1 style="color: #667eea; letter-spacing: 10px; margin: 0;">${code}</h1>
            </div>
            <p style="color: #666; font-size: 14px;">Код действителен 10 минут.</p>
          </div>
        `
      });
      console.log('✅ Код отправлен на:', email);
    } catch (mailError) {
      console.error('❌ Ошибка отправки письма:', mailError.message);
    }

    res.json({ message: "Код отправлен", user_id: userId });
    
  } catch (error) {
    console.error("❌ Send code error:", error);
    res.status(500).json({ message: "Ошибка при отправке кода: " + error.message });
  }
});

app.post("/register/verify", async (req, res) => {
  const { user_id, code } = req.body;
  console.log('🔐 Проверка кода для пользователя:', user_id);

  try {
    const codeResult = await pool.query(
      `SELECT * FROM verification_codes 
       WHERE user_id = $1 AND code = $2 AND used = false 
       AND expires_at > NOW()`,
      [user_id, code]
    );

    if (codeResult.rows.length === 0) {
      const checkResult = await pool.query(
        `SELECT used, expires_at FROM verification_codes WHERE user_id = $1 AND code = $2`,
        [user_id, code]
      );
      
      if (checkResult.rows.length === 0) {
        return res.status(400).json({ message: "Неверный код" });
      }
      if (checkResult.rows[0].used) {
        return res.status(400).json({ message: "Код уже использован" });
      }
      if (new Date(checkResult.rows[0].expires_at) < new Date()) {
        return res.status(400).json({ message: "Код истёк" });
      }
      return res.status(400).json({ message: "Неверный код" });
    }

    await pool.query("UPDATE reader SET is_active = true WHERE id = $1", [user_id]);
    await pool.query("UPDATE verification_codes SET used = true WHERE id = $1", [codeResult.rows[0].id]);

    const userResult = await pool.query(
      "SELECT id, login, email, name, surname, phonenumber FROM reader WHERE id = $1",
      [user_id]
    );

    console.log('✅ Пользователь активирован:', user_id);
    res.json({ message: "Регистрация завершена!", user: userResult.rows[0] });
    
  } catch (error) {
    console.error("❌ Verify error:", error);
    res.status(500).json({ message: "Ошибка при проверке кода: " + error.message });
  }
});

app.post("/register/resend-code", async (req, res) => {
  const { user_id } = req.body;
  console.log('🔄 Повторная отправка кода для:', user_id);

  try {
    const userResult = await pool.query(
      "SELECT email, is_active FROM reader WHERE id = $1",
      [user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }
    if (userResult.rows[0].is_active) {
      return res.status(400).json({ message: "Аккаунт уже активирован" });
    }

    const email = userResult.rows[0].email;
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO verification_codes (user_id, code, email, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE 
       SET code = $2, expires_at = $4, used = false, created_at = NOW()
       WHERE verification_codes.used = false`,
      [user_id, code, email, expiresAt]
    );

    try {
      await transporter.sendMail({
        from: `"Библиотека" <${EMAIL_CONFIG.auth.user}>`,
        to: email,
        subject: '📚 Новый код подтверждения',
        text: `Ваш новый код: ${code}\nДействителен 10 минут.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2 style="color: #667eea;">📚 Библиотека</h2>
            <p>Ваш новый код подтверждения:</p>
            <div style="background: #f0f0f0; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <h1 style="color: #667eea; letter-spacing: 10px; margin: 0;">${code}</h1>
            </div>
          </div>
        `
      });
      console.log('✅ Новый код отправлен');
    } catch (mailError) {
      console.error('❌ Ошибка отправки письма:', mailError.message);
    }

    res.json({ message: "Код отправлен повторно" });
    
  } catch (error) {
    console.error("❌ Resend error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

// ===== ВХОД =====
app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  console.log('🔐 Вход:', login);

  try {
    const result = await pool.query(
      "SELECT id, login, password, email, name, surname, phonenumber, is_active FROM reader WHERE login=$1 AND password=$2",
      [login, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Неверный логин или пароль" });
    }

    const user = result.rows[0];
    
    if (!user.is_active) {
      return res.status(403).json({ message: "Аккаунт не активирован. Проверьте почту." });
    }

    console.log('✅ Вход успешен:', login);
    res.json(user);
    
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ message: "Ошибка при входе: " + error.message });
  }
});

// ===== КНИГИ (с рейтингом) =====
app.get("/books", async (req, res) => {
  try {
    const booksResult = await pool.query(`
      SELECT b.*, 
             COALESCE(AVG(br.rating), 0) as avg_rating,
             COUNT(br.id) as reviews_count
      FROM books b
      LEFT JOIN book_reviews br ON b.id = br.book_id
      GROUP BY b.id
      ORDER BY b.id
    `);

    const booksWithCount = await Promise.all(
      booksResult.rows.map(async (book) => {
        const availableCount = await getAvailableCount(book.id);
        return { 
          ...book, 
          "Количество экземпляров": availableCount, 
          available: availableCount > 0 
        };
      })
    );

    res.json(booksWithCount);
  } catch (error) {
    console.error("❌ Books error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

// ===== ПОЛУЧИТЬ ОДНУ КНИГУ ПО ID =====
app.get("/books/:id", async (req, res) => {
  const bookId = parseInt(req.params.id);
  
  try {
    const result = await pool.query(
      `SELECT * FROM books WHERE id = $1`,
      [bookId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Книга не найдена" });
    }
    
    const book = result.rows[0];
    const availableCount = await getAvailableCount(bookId);
    book["Количество экземпляров"] = availableCount;
    book.available = availableCount > 0;
    
    res.json(book);
  } catch (error) {
    console.error("❌ Book detail error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

// ===== ВЗЯТЬ КНИГУ =====
app.post("/borrow", async (req, res) => {
  const { user_id, book_id } = req.body;
  console.log(`📥 Выдача: book_id=${book_id}, user_id=${user_id}`);

  try {
    if (!user_id || !book_id) {
      return res.status(400).json({ message: "Не все обязательные поля заполнены" });
    }

    const bookResult = await pool.query("SELECT id, title FROM books WHERE id=$1", [book_id]);
    const readerResult = await pool.query("SELECT id, login FROM reader WHERE id=$1", [user_id]);

    if (bookResult.rows.length === 0) return res.status(404).json({ message: "Книга не найдена" });
    if (readerResult.rows.length === 0) return res.status(404).json({ message: "Читатель не найден" });

    const book = bookResult.rows[0];
    const reader = readerResult.rows[0];

    const existingBorrow = await pool.query(
      `SELECT id FROM book_distribution 
       WHERE reader_id = $1 AND book_id = $2 AND date_return IS NULL`,
      [user_id, book_id]
    );
    
    if (existingBorrow.rows.length > 0) {
      return res.status(400).json({ message: "📚 Вы уже взяли эту книгу. Верните её, чтобы взять снова." });
    }

    const userBorrowCount = await pool.query(
      `SELECT COUNT(*) as count FROM book_distribution 
       WHERE reader_id = $1 AND date_return IS NULL`,
      [user_id]
    );
    
    const currentCount = parseInt(userBorrowCount.rows[0].count);
    const MAX_BOOKS_PER_USER = 20;
    
    if (currentCount >= MAX_BOOKS_PER_USER) {
      return res.status(400).json({ 
        message: `📚 Достигнут лимит книг (${MAX_BOOKS_PER_USER}). Верните хотя бы одну книгу, чтобы взять новую.` 
      });
    }

    const availableCount = await getAvailableCount(book_id);
    if (availableCount <= 0) {
      return res.status(400).json({ message: "❌ Все экземпляры книги уже выданы" });
    }

    const readerName = `${reader.name || ''} ${reader.surname || ''}`.trim() || reader.login || 'Читатель';

    await pool.query(
      `INSERT INTO book_distribution (book_id, book_title, reader_id, reader_name, date_issue, date_return, planned_return_date)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, NULL, CURRENT_DATE + INTERVAL '14 days')`,
      [book_id, book.title, user_id, readerName]
    );

    await pool.query(
      `UPDATE books SET "Количество экземпляров" = $1, available = $2 WHERE id=$3`, 
      [availableCount - 1, availableCount - 1 > 0, book_id]
    );

    console.log('✅ Книга выдана');
    res.send("Книга выдана");
    
  } catch (error) {
    console.error("❌ Borrow error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

// ===== ВЕРНУТЬ КНИГУ =====
app.post("/return", async (req, res) => {
  const { distribution_id } = req.body;
  
  try {
    if (!distribution_id) {
      return res.status(400).json({ message: "Не указан ID выдачи" });
    }

    const distributionResult = await pool.query(
      `SELECT book_id FROM book_distribution WHERE id = $1 AND date_return IS NULL`,
      [distribution_id]
    );

    if (distributionResult.rows.length === 0) {
      return res.status(404).json({ message: "Книга не найдена или уже возвращена" });
    }

    const book_id = distributionResult.rows[0].book_id;
    const availableCount = await getAvailableCount(book_id);

    if (availableCount >= INITIAL_BOOK_COUNT) {
      return res.status(400).json({ message: `Достигнут лимит экземпляров (${INITIAL_BOOK_COUNT})` });
    }

    await pool.query(`UPDATE book_distribution SET date_return = CURRENT_DATE WHERE id = $1`, [distribution_id]);
    await pool.query(`UPDATE books SET "Количество экземпляров" = $1, available = true WHERE id=$2`, [availableCount + 1, book_id]);

    res.send("Книга возвращена");
  } catch (error) {
    console.error("❌ Return error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

// ===== МОИ КНИГИ =====
app.get("/mybooks/:id", async (req, res) => {
  const userId = parseInt(req.params.id);
  
  try {
    if (!userId) {
      return res.status(400).json({ message: "Не указан ID пользователя" });
    }

    const userCheck = await pool.query("SELECT id FROM reader WHERE id=$1", [userId]);
    if (userCheck.rows.length === 0) return res.status(404).json({ message: "Пользователь не найден" });
    
    const result = await pool.query(
      `SELECT books.id, books.title, books.author,
              book_distribution.id as distribution_id,
              book_distribution.date_issue, book_distribution.date_return,
              book_distribution.planned_return_date, book_distribution.book_title
       FROM book_distribution
       INNER JOIN books ON book_distribution.book_id = books.id
       WHERE book_distribution.reader_id = $1 AND book_distribution.date_return IS NULL
       ORDER BY book_distribution.date_issue DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ MyBooks error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

// ===== ПРОФИЛЬ =====
app.put("/profile/:id", async (req, res) => {
  const userId = parseInt(req.params.id);
  const { email, name, surname, phonenumber } = req.body;
  
  try {
    if (!userId) {
      return res.status(400).json({ message: "Не указан ID пользователя" });
    }

    if (email) {
      const existing = await pool.query("SELECT id FROM reader WHERE email = $1 AND id != $2", [email, userId]);
      if (existing.rows.length > 0) return res.status(400).json({ message: "Email уже занят" });
    }

    const result = await pool.query(
      `UPDATE reader SET email = $1, name = $2, surname = $3, phonenumber = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING id, login, email, name, surname, phonenumber`,
      [email || null, name || null, surname || null, phonenumber || null, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ message: "Пользователь не найден" });
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Profile error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

// ===== DEBUG =====
app.get("/debug/db", async (req, res) => {
  try {
    const books = await pool.query("SELECT COUNT(*) FROM books");
    const readers = await pool.query("SELECT COUNT(*) FROM reader");
    const active = await pool.query("SELECT COUNT(*) FROM reader WHERE is_active = true");
    const borrowed = await pool.query("SELECT COUNT(*) FROM book_distribution WHERE date_return IS NULL");
    
    res.json({
      books: books.rows[0].count,
      readers: readers.rows[0].count,
      active_users: active.rows[0].count,
      active_borrows: borrowed.rows[0].count
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== 🔥 БРОНИРОВАНИЕ КНИГ =====

app.post("/reserve", async (req, res) => {
  const { user_id, book_id, reservation_date } = req.body;
  
  console.log(`📅 Бронь: user_id=${user_id}, book_id=${book_id}, date=${reservation_date}`);

  try {
    if (!user_id || !book_id || !reservation_date) {
      return res.status(400).json({ message: "Не все обязательные поля заполнены" });
    }

    const bookResult = await pool.query("SELECT id, title FROM books WHERE id=$1", [book_id]);
    const readerResult = await pool.query("SELECT id, login FROM reader WHERE id=$1", [user_id]);

    if (bookResult.rows.length === 0) return res.status(404).json({ message: "Книга не найдена" });
    if (readerResult.rows.length === 0) return res.status(404).json({ message: "Читатель не найден" });

    const book = bookResult.rows[0];
    const reader = readerResult.rows[0];

    const existingReservation = await pool.query(
      `SELECT id FROM book_reservations 
       WHERE user_id = $1 AND book_id = $2 AND status = 'active'`,
      [user_id, book_id]
    );
    
    if (existingReservation.rows.length > 0) {
      return res.status(400).json({ message: "📚 Вы уже забронировали эту книгу" });
    }

    const userReservationCount = await pool.query(
      `SELECT COUNT(*) as count FROM book_reservations 
       WHERE user_id = $1 AND status = 'active'`,
      [user_id]
    );
    
    const currentCount = parseInt(userReservationCount.rows[0].count);
    const MAX_RESERVATIONS = 5;
    
    if (currentCount >= MAX_RESERVATIONS) {
      return res.status(400).json({ 
        message: `📚 Достигнут лимит бронирований (${MAX_RESERVATIONS}). Отмените старые брони, чтобы создать новые.` 
      });
    }

    const reservationDate = new Date(reservation_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (reservationDate < today) {
      return res.status(400).json({ message: "❌ Нельзя забронировать на прошедшую дату" });
    }

    const expiresAt = new Date(reservationDate);
    expiresAt.setDate(expiresAt.getDate() + 3);
    expiresAt.setHours(23, 59, 59, 999);

    await pool.query(
      `INSERT INTO book_reservations (book_id, user_id, reservation_date, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [book_id, user_id, reservation_date, expiresAt]
    );

    console.log('✅ Книга забронирована');
    res.json({ message: `✅ Книга "${book.title}" забронирована на ${formatDate(reservation_date)}. Действует 3 дня.` });
    
  } catch (error) {
    console.error("❌ Reserve error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

// ===== МОИ БРОНИРОВАНИЯ (с изображениями и рейтингом) =====
app.get("/my-reservations/:id", async (req, res) => {
  const userId = parseInt(req.params.id);
  
  try {
    const userCheck = await pool.query("SELECT id FROM reader WHERE id=$1", [userId]);
    if (userCheck.rows.length === 0) return res.status(404).json({ message: "Пользователь не найден" });
    
    const result = await pool.query(
      `SELECT books.id, books.title, books.author, books.image_url,
             COALESCE(AVG(br.rating), 0) as avg_rating,
             COUNT(br.id) as reviews_count,
             book_reservations.id as reservation_id,
             book_reservations.reservation_date,
             book_reservations.expires_at,
             book_reservations.status,
             book_reservations.created_at
       FROM book_reservations
       INNER JOIN books ON book_reservations.book_id = books.id
       LEFT JOIN book_reviews br ON books.id = br.book_id
       WHERE book_reservations.user_id = $1 AND book_reservations.status = 'active'
       GROUP BY books.id, book_reservations.id
       ORDER BY book_reservations.reservation_date ASC`,
      [userId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error("❌ MyReservations error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

app.post("/cancel-reservation", async (req, res) => {
  const { reservation_id } = req.body;
  console.log(`❌ Отмена брони: reservation_id=${reservation_id}`);

  try {
    if (!reservation_id) {
      return res.status(400).json({ message: "Не указан ID брони" });
    }

    const result = await pool.query(
      `UPDATE book_reservations SET status = 'cancelled' WHERE id = $1 AND status = 'active'`,
      [reservation_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Бронь не найдена или уже отменена" });
    }

    res.send("Бронь отменена");
  } catch (error) {
    console.error("❌ Cancel reservation error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

app.post("/take-reserved-book", async (req, res) => {
  const { user_id, book_id, reservation_id } = req.body;
  console.log(`📥 Взятие забронированной книги: book_id=${book_id}, reservation_id=${reservation_id}`);

  try {
    if (!user_id || !book_id || !reservation_id) {
      return res.status(400).json({ message: "Не все обязательные поля заполнены" });
    }

    const reservationResult = await pool.query(
      `SELECT * FROM book_reservations 
       WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [reservation_id, user_id]
    );

    if (reservationResult.rows.length === 0) {
      return res.status(404).json({ message: "Бронь не найдена или истекла" });
    }

    const reservation = reservationResult.rows[0];
    
    const now = new Date();
    const expiresAt = new Date(reservation.expires_at);
    
    if (now > expiresAt) {
      return res.status(400).json({ message: "❌ Срок брони истёк" });
    }

    const availableCount = await getAvailableCount(book_id);
    
    if (availableCount <= 0) {
      return res.status(400).json({ message: "❌ Книга временно отсутствует" });
    }

    const bookResult = await pool.query("SELECT title FROM books WHERE id=$1", [book_id]);
    const readerResult = await pool.query("SELECT name, surname, login FROM reader WHERE id=$1", [user_id]);
    
    if (bookResult.rows.length === 0) {
      return res.status(404).json({ message: "Книга не найдена" });
    }
    if (readerResult.rows.length === 0) {
      return res.status(404).json({ message: "Читатель не найден" });
    }
    
    const book = bookResult.rows[0];
    const reader = readerResult.rows[0];
    const readerName = `${reader.name || ''} ${reader.surname || ''}`.trim() || reader.login || 'Читатель';

    await pool.query(
      `INSERT INTO book_distribution (book_id, book_title, reader_id, reader_name, date_issue, date_return, planned_return_date)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, NULL, CURRENT_DATE + INTERVAL '14 days')`,
      [book_id, book.title, user_id, readerName]
    );

    await pool.query(
      `UPDATE book_reservations SET status = 'completed' WHERE id = $1`,
      [reservation_id]
    );

    await pool.query(
      `UPDATE books SET "Количество экземпляров" = $1, available = $2 WHERE id=$3`, 
      [availableCount - 1, availableCount - 1 > 0, book_id]
    );

    console.log('✅ Книга выдана по брони');
    res.send("Книга выдана по брони");
    
  } catch (error) {
    console.error("❌ Take reserved book error:", error);
    res.status(500).json({ message: "Ошибка сервера: " + error.message });
  }
});

// ===== ОТЗЫВЫ И ОЦЕНКИ КНИГ =====

app.get("/books/:id/reviews", async (req, res) => {
  const bookId = parseInt(req.params.id);
  
  try {
    if (!bookId) {
      return res.status(400).json({ message: "Не указан ID книги" });
    }

    const result = await pool.query(
      `SELECT br.id, br.rating, br.comment, br.created_at,
              r.login, r.name, r.surname
       FROM book_reviews br
       JOIN reader r ON br.user_id = r.id
       WHERE br.book_id = $1
       ORDER BY br.created_at DESC`,
      [bookId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Get reviews error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

app.post("/books/:id/reviews", async (req, res) => {
  const bookId = parseInt(req.params.id);
  const { user_id, rating, comment } = req.body;

  try {
    if (!bookId || !user_id || !rating) {
      return res.status(400).json({ message: "Не все обязательные поля заполнены" });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Оценка должна быть от 1 до 5" });
    }

    const result = await pool.query(
      `INSERT INTO book_reviews (book_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (book_id, user_id) DO UPDATE
       SET rating = $3, comment = $4, created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [bookId, user_id, rating, comment || null]
    );
    res.json({ message: "Отзыв сохранён", review: result.rows[0] });
  } catch (error) {
    console.error("❌ Save review error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

// ===== ПЕРСОНАЛЬНЫЕ СПИСКИ КНИГ =====

app.post("/books/:id/status", async (req, res) => {
  const bookId = parseInt(req.params.id);
  const { user_id, status } = req.body;
  
  try {
    if (!bookId || !user_id || !status) {
      return res.status(400).json({ message: "Не все обязательные поля заполнены" });
    }

    if (!['read', 'plan_to_read', 'favorites'].includes(status)) {
      return res.status(400).json({ message: "Неверный статус" });
    }

    const check = await pool.query(
      "SELECT id FROM user_book_statuses WHERE user_id = $1 AND book_id = $2 AND status = $3",
      [user_id, bookId, status]
    );

    if (check.rows.length > 0) {
      await pool.query("DELETE FROM user_book_statuses WHERE id = $1", [check.rows[0].id]);
      return res.json({ message: "Статус удалён", action: "removed" });
    } else {
      await pool.query(
        "INSERT INTO user_book_statuses (user_id, book_id, status) VALUES ($1, $2, $3)",
        [user_id, bookId, status]
      );
      return res.json({ message: "Статус добавлен", action: "added" });
    }
  } catch (error) {
    console.error("❌ Toggle status error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

app.get("/my-book-statuses/:id", async (req, res) => {
  const userId = parseInt(req.params.id);
  
  try {
    if (!userId) {
      return res.status(400).json({ message: "Не указан ID пользователя" });
    }

    const result = await pool.query(
      `SELECT book_id, status FROM user_book_statuses WHERE user_id = $1`,
      [userId]
    );
    
    const statusesMap = {};
    result.rows.forEach(row => {
      if (!statusesMap[row.book_id]) statusesMap[row.book_id] = [];
      statusesMap[row.book_id].push(row.status);
    });
    
    res.json(statusesMap);
  } catch (error) {
    console.error("❌ Get statuses error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

app.get("/my-list-books", async (req, res) => {
    const userId = parseInt(req.query.user_id);
    const status = req.query.status;

    try {
        if (!userId) {
            return res.status(400).json({ message: "Не указан ID пользователя" });
        }

        let query = `
            SELECT b.*, s.status, s.created_at as added_at
            FROM user_book_statuses s
            JOIN books b ON s.book_id = b.id
            WHERE s.user_id = $1
        `;
        const params = [userId];

        if (status && status !== 'all') {
            query += ` AND s.status = $2`;
            params.push(status);
        }

        query += ` ORDER BY s.created_at DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error("❌ Get my list books error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ===== МОЙ СПИСОК (прочитал/планирую/избранное) =====
app.get("/my-list/:id", async (req, res) => {
  const userId = parseInt(req.params.id);
  const { status } = req.query; // 'read', 'plan_to_read', 'favorites' или undefined (все)
  
  try {
    const userCheck = await pool.query("SELECT id FROM reader WHERE id=$1", [userId]);
    if (userCheck.rows.length === 0) return res.status(404).json({ message: "Пользователь не найден" });
    
    let query;
    let params;
    
    if (status) {
      // Конкретный статус
      query = `
        SELECT books.id, books.title, books.author, books.yearofrelease, 
               books.roomnumber, books.shelfnumber, books.image_url, books.description,
               COALESCE(AVG(br.rating), 0) as avg_rating,
               COUNT(br.id) as reviews_count,
               ubs.status,
               ubs.created_at as added_at
        FROM user_book_statuses ubs
        INNER JOIN books ON ubs.book_id = books.id
        LEFT JOIN book_reviews br ON books.id = br.book_id
        WHERE ubs.user_id = $1 AND ubs.status = $2
        GROUP BY books.id, ubs.status, ubs.created_at
        ORDER BY ubs.created_at DESC
      `;
      params = [userId, status];
    } else {
      // Все статусы
      query = `
        SELECT books.id, books.title, books.author, books.yearofrelease, 
               books.roomnumber, books.shelfnumber, books.image_url, books.description,
               COALESCE(AVG(br.rating), 0) as avg_rating,
               COUNT(br.id) as reviews_count,
               ARRAY_AGG(ubs.status) as statuses,
               MIN(ubs.created_at) as added_at
        FROM user_book_statuses ubs
        INNER JOIN books ON ubs.book_id = books.id
        LEFT JOIN book_reviews br ON books.id = br.book_id
        WHERE ubs.user_id = $1
        GROUP BY books.id
        ORDER BY added_at DESC
      `;
      params = [userId];
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ MyList error:", error);
    res.status(500).json({ message: "Ошибка: " + error.message });
  }
});

// ===== ЗАПУСК СЕРВЕРА =====
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Server started on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});