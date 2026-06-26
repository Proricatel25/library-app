// ===== ИМПОРТЫ =====
const express = require("express");
const { Pool } = require("pg");
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const multer = require('multer');
const app = express();

// ===== НАСТРОЙКА MULTER ДЛЯ ЗАГРУЗКИ ФОТО =====
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 Папка для загрузок создана:', uploadDir);
} else {
    console.log('📁 Папка для загрузок существует:', uploadDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'book-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Разрешены только изображения: JPEG, PNG, WebP'));
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: fileFilter
});

// ===== MIDDLEWARE =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ===== НАСТРОЙКА ПУТЕЙ =====
const APP_DIR = process.cwd();
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');

console.log('📁 APP_DIR:', APP_DIR);
console.log('📁 PUBLIC_DIR:', PUBLIC_DIR);
console.log('📄 INDEX_PATH:', INDEX_PATH);

if (fs.existsSync(INDEX_PATH)) {
    const stats = fs.statSync(INDEX_PATH);
    console.log(`✅ index.html найден! Размер: ${Math.round(stats.size / 1024)} KB`);
} else {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: index.html не найден');
}

// ===== РАЗДАЧА СТАТИЧЕСКИХ ФАЙЛОВ =====
app.use(express.static(PUBLIC_DIR, {
    index: false,
    setHeaders: (res, filepath) => {
        if (filepath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
    }
}));

// ===== ГЛАВНАЯ СТРАНИЦА =====
app.get('/', (req, res) => {
    console.log('📥 GET / — запрос главной страницы');
    fs.readFile(INDEX_PATH, 'utf8', (err, data) => {
        if (err) {
            console.error('❌ Ошибка чтения index.html:', err.message);
            return res.status(500).send(`Ошибка: ${err.message}`);
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(data);
    });
});

// ===== ПОДКЛЮЧЕНИЕ К БД =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    user: process.env.PGUSER || "postgres",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "library",
    password: process.env.PGPASSWORD || "1234",
    port: parseInt(process.env.PGPORT) || 5432,
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err.message);
    } else {
        console.log('✅ Подключение к базе данных установлено');
        release();
    }
});

// ===== НАСТРОЙКИ ПОЧТЫ =====
const EMAIL_CONFIG = {
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER || 'proricatelmiphifig@gmail.com',
        pass: process.env.EMAIL_PASS || 'nqbvdewukhqwrkpa'
    },
    tls: { rejectUnauthorized: false }
};

const transporter = nodemailer.createTransport(EMAIL_CONFIG);
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Ошибка подключения к почте:', error.message);
    } else {
        console.log('✅ Почта готова к отправке');
    }
});

// ===== КОНСТАНТЫ =====
const INITIAL_BOOK_COUNT = 15;

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function getAvailableCount(bookId) {
    try {
        const result = await pool.query(
            `SELECT COUNT(*) FROM book_distribution WHERE book_id = $1 AND date_return IS NULL`,
            [bookId]
        );
        return INITIAL_BOOK_COUNT - parseInt(result.rows[0].count);
    } catch (error) {
        console.error("❌ getAvailableCount error:", error);
        return INITIAL_BOOK_COUNT;
    }
}

// ===== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ПРОВЕРКИ АКТИВНОСТИ ПОЛЬЗОВАТЕЛЯ =====
async function isUserActive(userId) {
    if (!userId) return false;
    try {
        const result = await pool.query("SELECT is_active FROM reader WHERE id = $1", [userId]);
        if (result.rows.length === 0) return false;
        return result.rows[0].is_active === true;
    } catch {
        return false;
    }
}

// ============================================================
// ===== API: РЕГИСТРАЦИЯ =====
// ============================================================
app.post("/register/send-code", async (req, res) => {
    const { login, password, email } = req.body;
    console.log('📧 Запрос кода:', email);
    try {
        if (login.toLowerCase() === 'librarian') {
            const checkLibrarian = await pool.query("SELECT id FROM reader WHERE login = 'librarian' AND is_active = true");
            if (checkLibrarian.rows.length > 0) {
                return res.status(400).json({ message: "Аккаунт библиотекаря уже существует" });
            }
        }

        const existing = await pool.query(
            "SELECT id, is_active FROM reader WHERE login = $1 OR email = $2",
            [login, email]
        );

        if (existing.rows.length > 0) {
            const hasActive = existing.rows.some(row => row.is_active === true);
            if (hasActive) {
                return res.status(400).json({ message: "Такой логин или email уже зарегистрирован" });
            }
            for (const row of existing.rows) {
                await pool.query("DELETE FROM verification_codes WHERE user_id = $1", [row.id]);
                await pool.query("DELETE FROM reader WHERE id = $1", [row.id]);
            }
        }

        const code = generateCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        const userResult = await pool.query(
            `INSERT INTO reader (login, password, email, name, surname, phonenumber, is_active) 
             VALUES ($1, $2, $3, NULL, NULL, NULL, false) RETURNING id`,
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
                html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                    <h2 style="color:#667eea;">📚 Библиотека</h2>
                    <p>Ваш код подтверждения:</p>
                    <div style="background:#f0f0f0;padding:20px;text-align:center;border-radius:8px;margin:20px 0;">
                        <h1 style="color:#667eea;letter-spacing:10px;margin:0;">${code}</h1>
                    </div>
                </div>`
            });
            console.log('✅ Код отправлен на:', email);
        } catch (mailError) {
            console.error('❌ Ошибка отправки письма:', mailError.message);
        }

        res.json({ message: "Код отправлен", user_id: userId });
    } catch (error) {
        console.error("❌ Send code error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

app.post("/register/verify", async (req, res) => {
    const { user_id, code } = req.body;
    try {
        const codeResult = await pool.query(
            `SELECT * FROM verification_codes WHERE user_id = $1 AND code = $2 AND used = false AND expires_at > NOW()`,
            [user_id, code]
        );

        if (codeResult.rows.length === 0) {
            return res.status(400).json({ message: "Неверный или истёкший код" });
        }

        await pool.query("UPDATE reader SET is_active = true WHERE id = $1", [user_id]);
        await pool.query("UPDATE verification_codes SET used = true WHERE id = $1", [codeResult.rows[0].id]);

        const userResult = await pool.query(
            "SELECT id, login, email, name, surname, phonenumber FROM reader WHERE id = $1",
            [user_id]
        );

        res.json({ message: "Регистрация завершена!", user: userResult.rows[0] });
    } catch (error) {
        console.error("❌ Verify error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

app.post("/register/resend-code", async (req, res) => {
    const { user_id } = req.body;
    try {
        const userResult = await pool.query("SELECT email, is_active FROM reader WHERE id = $1", [user_id]);
        if (userResult.rows.length === 0) return res.status(404).json({ message: "Пользователь не найден" });
        if (userResult.rows[0].is_active) return res.status(400).json({ message: "Аккаунт уже активирован" });

        const email = userResult.rows[0].email;
        const code = generateCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(
            `INSERT INTO verification_codes (user_id, code, email, expires_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET code = $2, expires_at = $4, used = false, created_at = NOW()`,
            [user_id, code, email, expiresAt]
        );

        try {
            await transporter.sendMail({
                from: `"Библиотека" <${EMAIL_CONFIG.auth.user}>`,
                to: email,
                subject: '📚 Новый код подтверждения',
                text: `Ваш новый код: ${code}`,
                html: `<h1 style="color:#667eea;letter-spacing:10px;">${code}</h1>`
            });
        } catch (mailError) {
            console.error('❌ Ошибка отправки:', mailError.message);
        }

        res.json({ message: "Код отправлен повторно" });
    } catch (error) {
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: ВХОД =====
// ============================================================
app.post("/login", async (req, res) => {
    const { login, password } = req.body;
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
            return res.status(403).json({ message: "Аккаунт не активирован" });
        }

        res.json(user);
    } catch (error) {
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: ПОЛЬЗОВАТЕЛИ (только библиотекарь) =====
// ============================================================
app.get("/users", async (req, res) => {
    const { user_login } = req.query;
    if (user_login !== 'librarian') {
        return res.status(403).json({ message: "Доступ запрещён. Только библиотекарь." });
    }
    try {
        const result = await pool.query(
            `SELECT id, login, email, name, surname, phonenumber, is_active
             FROM reader 
             ORDER BY id`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("❌ Get users error:", error);
        res.json([]);
    }
});

// ===== API: БЛОКИРОВКА / РАЗБЛОКИРОВКА ПОЛЬЗОВАТЕЛЯ =====
app.put("/users/:id/status", async (req, res) => {
    const userId = parseInt(req.params.id);
    const { user_login, is_active } = req.body;
    if (user_login !== 'librarian') {
        return res.status(403).json({ message: "Доступ запрещён" });
    }

    try {
        const userExists = await pool.query("SELECT id FROM reader WHERE id = $1", [userId]);
        if (userExists.rows.length === 0) {
            return res.status(404).json({ message: "Пользователь не найден" });
        }

        const librarianRes = await pool.query("SELECT id FROM reader WHERE login = 'librarian'");
        if (librarianRes.rows.length > 0 && librarianRes.rows[0].id === userId) {
            return res.status(400).json({ message: "Нельзя изменить статус библиотекаря" });
        }

        const result = await pool.query(
            "UPDATE reader SET is_active = $1 WHERE id = $2 RETURNING id, login, is_active",
            [is_active, userId]
        );

        const user = result.rows[0];
        res.json({
            message: `Пользователь ${user.login} ${is_active ? 'разблокирован' : 'заблокирован'}`,
            user: user
        });
    } catch (error) {
        console.error("❌ Update user status error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: КНИГИ =====
// ============================================================
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
                return { ...book, "Количество экземпляров": availableCount, available: availableCount > 0 };
            })
        );
        res.json(booksWithCount);
    } catch (error) {
        console.error("❌ Get books error:", error);
        res.json([]);
    }
});

app.get("/books/:id", async (req, res) => {
    const bookId = parseInt(req.params.id);
    try {
        const result = await pool.query(`SELECT * FROM books WHERE id = $1`, [bookId]);
        if (result.rows.length === 0) return res.status(404).json({ message: "Книга не найдена" });
        
        const book = result.rows[0];
        book["Количество экземпляров"] = await getAvailableCount(bookId);
        res.json(book);
    } catch (error) {
        console.error("❌ Get book by id error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: БРОНИРОВАНИЕ =====
// ============================================================
app.post("/reserve", async (req, res) => {
    const { user_id, book_id, reservation_date } = req.body;
    try {
        if (!user_id || !book_id || !reservation_date) {
            return res.status(400).json({ message: "Не все поля заполнены" });
        }

        // Проверка активности пользователя
        const active = await isUserActive(user_id);
        if (!active) {
            return res.status(403).json({ message: "❌ Ваш аккаунт заблокирован. Обратитесь к библиотекарю." });
        }

        const existingReservation = await pool.query(
            `SELECT id FROM book_reservations WHERE user_id = $1 AND book_id = $2 AND status = 'active'`,
            [user_id, book_id]
        );
        if (existingReservation.rows.length > 0) {
            return res.status(400).json({ message: "Вы уже забронировали эту книгу" });
        }

        const expiresAt = new Date(reservation_date);
        expiresAt.setDate(expiresAt.getDate() + 3);
        expiresAt.setHours(23, 59, 59, 999);

        await pool.query(
            `INSERT INTO book_reservations (book_id, user_id, reservation_date, expires_at) VALUES ($1, $2, $3, $4)`,
            [book_id, user_id, reservation_date, expiresAt]
        );

        await pool.query(
            `UPDATE books SET "Количество экземпляров" = "Количество экземпляров" - 1 WHERE id = $1`,
            [book_id]
        );

        res.json({ message: "✅ Книга забронирована" });
    } catch (error) {
        console.error("❌ Reserve error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

app.get("/my-reservations/:id", async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId || userId <= 0 || isNaN(userId)) {
        return res.status(400).json({ message: "Неверный ID пользователя" });
    }
    // Проверка активности
    const active = await isUserActive(userId);
    if (!active) {
        return res.status(403).json({ message: "❌ Ваш аккаунт заблокирован." });
    }
    try {
        const result = await pool.query(
            `SELECT books.id, books.title, books.author, books.image_url, 
                    COALESCE(AVG(br.rating), 0) as avg_rating, 
                    COUNT(br.id) as reviews_count, 
                    book_reservations.id as reservation_id, 
                    book_reservations.reservation_date, 
                    book_reservations.expires_at 
             FROM book_reservations 
             INNER JOIN books ON book_reservations.book_id = books.id 
             LEFT JOIN book_reviews br ON books.id = br.book_id 
             WHERE book_reservations.user_id = $1 AND book_reservations.status = 'active' 
             GROUP BY books.id, book_reservations.id`,
            [userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("❌ Get my reservations error:", error);
        res.json([]);
    }
});

app.post("/cancel-reservation", async (req, res) => {
    const { reservation_id } = req.body;
    try {
        const reservationResult = await pool.query(
            `SELECT user_id, book_id FROM book_reservations WHERE id = $1 AND status = 'active'`,
            [reservation_id]
        );
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({ message: "Бронь не найдена" });
        }

        const userId = reservationResult.rows[0].user_id;
        const active = await isUserActive(userId);
        if (!active) {
            return res.status(403).json({ message: "Ваш аккаунт заблокирован" });
        }

        const book_id = reservationResult.rows[0].book_id;
        await pool.query(`UPDATE book_reservations SET status = 'cancelled' WHERE id = $1`, [reservation_id]);
        await pool.query(
            `UPDATE books SET "Количество экземпляров" = "Количество экземпляров" + 1 WHERE id = $1`,
            [book_id]
        );

        res.send("Бронь отменена");
    } catch (error) {
        console.error("❌ Cancel reservation error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: ВЗЯТЬ/ВЕРНУТЬ КНИГУ =====
// ============================================================
app.post("/borrow", async (req, res) => {
    const { user_id, book_id } = req.body;
    try {
        if (!user_id || !book_id) {
            return res.status(400).json({ message: "Не все поля заполнены" });
        }
        const active = await isUserActive(user_id);
        if (!active) {
            return res.status(403).json({ message: "Ваш аккаунт заблокирован" });
        }
        // ПРОВЕРКА: не выдана ли уже эта книга пользователю
        const existing = await pool.query(
            "SELECT id FROM book_distribution WHERE book_id=$1 AND reader_id=$2 AND date_return IS NULL",
            [book_id, user_id]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: "Эта книга уже выдана этому пользователю" });
        }

        const bookResult = await pool.query("SELECT id, title FROM books WHERE id=$1", [book_id]);
        if (bookResult.rows.length === 0) return res.status(404).json({ message: "Книга не найдена" });
        await pool.query(
            `INSERT INTO book_distribution (book_id, book_title, reader_id, date_issue, planned_return_date)
             VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + INTERVAL '14 days')`,
            [book_id, bookResult.rows[0].title, user_id]
        );
        await pool.query(
            `UPDATE books SET "Количество экземпляров" = "Количество экземпляров" - 1 WHERE id=$1`,
            [book_id]
        );
        res.send("Книга выдана");
    } catch (error) {
        console.error("❌ Borrow error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

app.post("/return", async (req, res) => {
    const { distribution_id } = req.body;
    try {
        const distributionResult = await pool.query(
            `SELECT book_id FROM book_distribution WHERE id = $1 AND date_return IS NULL`,
            [distribution_id]
        );
        if (distributionResult.rows.length === 0) return res.status(404).json({ message: "Не найдена" });

        const book_id = distributionResult.rows[0].book_id;
        await pool.query(`UPDATE book_distribution SET date_return = CURRENT_DATE WHERE id = $1`, [distribution_id]);
        await pool.query(
            `UPDATE books SET "Количество экземпляров" = "Количество экземпляров" + 1 WHERE id=$1`,
            [book_id]
        );
        res.send("Книга возвращена");
    } catch (error) {
        console.error("❌ Return error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: МОИ КНИГИ / ПРОФИЛЬ =====
// ============================================================
app.get("/mybooks/:id", async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId || userId <= 0 || isNaN(userId)) {
        return res.status(400).json({ message: "Неверный ID пользователя" });
    }
    const active = await isUserActive(userId);
    if (!active) {
        return res.status(403).json({ message: "Ваш аккаунт заблокирован" });
    }
    try {
        const result = await pool.query(
            `SELECT 
                b.id as book_id, 
                b.title, 
                b.author, 
                b.image_url,              -- <--- ДОБАВЛЕНО!
                bd.id as distribution_id,
                bd.date_issue, 
                bd.planned_return_date,
                CASE WHEN bd.planned_return_date < CURRENT_DATE THEN true ELSE false END as is_overdue
             FROM book_distribution bd
             INNER JOIN books b ON bd.book_id = b.id
             WHERE bd.reader_id = $1 AND bd.date_return IS NULL
             ORDER BY bd.planned_return_date ASC`,
            [userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("❌ Get my books error:", error);
        res.json([]);
    }
});

app.put("/profile/:id", async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId || userId <= 0 || isNaN(userId)) {
        return res.status(400).json({ message: "Неверный ID пользователя" });
    }
    const active = await isUserActive(userId);
    if (!active) {
        return res.status(403).json({ message: "Ваш аккаунт заблокирован" });
    }

    const { login, password, name, surname, phonenumber } = req.body;
    try {
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (login) {
            updates.push(`login = $${paramIndex}`);
            values.push(login);
            paramIndex++;
        }
        if (password) {
            updates.push(`password = $${paramIndex}`);
            values.push(password);
            paramIndex++;
        }
        if (name !== undefined) { updates.push(`name = $${paramIndex}`); values.push(name); paramIndex++; }
        if (surname !== undefined) { updates.push(`surname = $${paramIndex}`); values.push(surname); paramIndex++; }
        if (phonenumber !== undefined) { updates.push(`phonenumber = $${paramIndex}`); values.push(phonenumber); paramIndex++; }

        if (updates.length === 0) return res.status(400).json({ message: "Нет данных" });

        values.push(userId);
        const result = await pool.query(
            `UPDATE reader SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, login, email, name, surname, phonenumber`,
            values
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error("❌ Update profile error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: ОТЗЫВЫ =====
// ============================================================
app.get("/books/:id/reviews", async (req, res) => {
    const bookId = parseInt(req.params.id);
    try {
        const result = await pool.query(
            `SELECT br.id, br.rating, br.comment, br.created_at, r.login, r.name, r.surname 
             FROM book_reviews br 
             JOIN reader r ON br.user_id = r.id 
             WHERE br.book_id = $1 
             ORDER BY br.created_at DESC`,
            [bookId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("❌ Get reviews error:", error);
        res.json([]);
    }
});

app.post("/books/:id/reviews", async (req, res) => {
    const bookId = parseInt(req.params.id);
    const { user_id, rating, comment } = req.body;
    try {
        if (!user_id) {
            return res.status(400).json({ message: "Не передан ID пользователя" });
        }
        const active = await isUserActive(user_id);
        if (!active) {
            return res.status(403).json({ message: "Ваш аккаунт заблокирован" });
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
        console.error("❌ Submit review error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: ПЕРСОНАЛЬНЫЕ СПИСКИ =====
// ============================================================
app.post("/books/:id/status", async (req, res) => {
    const bookId = parseInt(req.params.id);
    const { user_id, status } = req.body;
    try {
        if (!user_id) {
            return res.status(400).json({ message: "Не передан ID пользователя" });
        }
        const active = await isUserActive(user_id);
        if (!active) {
            return res.status(403).json({ message: "Ваш аккаунт заблокирован" });
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
    const userId = Number(req.params.id);
    if (!userId || userId <= 0 || isNaN(userId)) {
        return res.status(400).json({ message: "Неверный ID пользователя" });
    }
    const active = await isUserActive(userId);
    if (!active) {
        return res.status(403).json({ message: "Ваш аккаунт заблокирован" });
    }
    try {
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
        res.json({});
    }
});

// ============================================================
// ===== API: ДОБАВЛЕНИЕ КНИГИ С ФОТО =====
// ============================================================
app.post("/books/add", upload.single('cover'), async (req, res) => {
    console.log('📥 ===== ЗАПРОС НА ДОБАВЛЕНИЕ КНИГИ =====');
    console.log('📋 Body:', req.body);
    console.log('📎 File:', req.file);
    console.log('===========================================');

    const { isbn, title, author, publisher, year, genre, stock, user_login } = req.body;
    const coverFile = req.file;

    if (user_login !== 'librarian') {
        return res.status(403).json({ message: "Только библиотекарь может добавлять книги" });
    }

    if (!isbn || !title || !author || !publisher || !year || !stock) {
        return res.status(400).json({ message: "❌ Заполните все поля" });
    }

    try {
        let coverPath = null;
        if (coverFile) {
            coverPath = '/uploads/' + coverFile.filename;
            console.log('✅ Обложка сохранена:', coverPath);
        }
         
        const query = `
            INSERT INTO books (
                title, author, yearofrelease, isbn, publisher, genre, 
                 "Количество экземпляров", available, image_url, description
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
        `;
        
        const values = [
            title, author, parseInt(year), isbn, publisher, genre,
            parseInt(stock), true, coverPath,
            `Жанр: ${genre}. Издательство: ${publisher}.`
        ];
        
        const result = await pool.query(query, values);
        console.log(`✅ Книга добавлена (ID: ${result.rows[0].id})`);
        res.json({ 
            message: `✅ Книга "${title}" добавлена`,
            book_id: result.rows[0].id
        });
    } catch (error) {
        console.error("❌ Add book error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: ПРОВЕРКА ПЕРЕД УДАЛЕНИЕМ =====
// ============================================================
app.get("/books/:id/can-delete", async (req, res) => {
    const bookId = parseInt(req.params.id);
    try {
        const activeReservations = await pool.query(
            `SELECT COUNT(*) FROM book_reservations WHERE book_id = $1 AND status = 'active'`,
            [bookId]
        );
        if (parseInt(activeReservations.rows[0].count) > 0) {
            return res.status(400).json({ message: "❌ Есть активные брони" });
        }

        const activeBorrows = await pool.query(
            `SELECT COUNT(*) FROM book_distribution WHERE book_id = $1 AND date_return IS NULL`,
            [bookId]
        );
        if (parseInt(activeBorrows.rows[0].count) > 0) {
            return res.status(400).json({ message: "❌ Книга выдана читателям" });
        }
        
        res.json({ message: "Можно удалить", canDelete: true });
    } catch (error) {
        console.error("❌ Can delete check error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: УДАЛЕНИЕ КНИГИ =====
// ============================================================
app.post("/books/delete", async (req, res) => {
    const { book_id, user_login } = req.body;
    console.log(`🗑️ Удаление: book_id=${book_id}`);
    
    if (user_login !== 'librarian') {
        return res.status(403).json({ message: "Только библиотекарь" });
    }

    try {
        const bookCheck = await pool.query("SELECT title FROM books WHERE id = $1", [book_id]);
        if (bookCheck.rows.length === 0) return res.status(404).json({ message: "Не найдена" });
        
        const bookTitle = bookCheck.rows[0].title;
        
        await pool.query("DELETE FROM book_reviews WHERE book_id = $1", [book_id]);
        await pool.query("DELETE FROM user_book_statuses WHERE book_id = $1", [book_id]);
        await pool.query("DELETE FROM book_reservations WHERE book_id = $1", [book_id]);
        await pool.query("DELETE FROM books WHERE id = $1", [book_id]);
        
        console.log(`✅ Удалена: "${bookTitle}"`);
        res.json({ message: `✅ Книга "${bookTitle}" удалена` });
    } catch (error) {
        console.error("❌ Delete book error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: ОБНОВЛЕНИЕ ОБЛОЖКИ КНИГИ =====
// ============================================================
app.post("/books/:id/update-cover", upload.single('cover'), async (req, res) => {
    const bookId = parseInt(req.params.id);
    const { user_login } = req.body;
    const coverFile = req.file;
    console.log(`📷 Запрос на смену обложки книги ID: ${bookId}`);

    if (user_login !== 'librarian') {
        return res.status(403).json({ message: "Только библиотекарь может менять обложки" });
    }

    if (!coverFile) {
        return res.status(400).json({ message: "Файл не выбран" });
    }

    try {
        const bookCheck = await pool.query("SELECT id FROM books WHERE id = $1", [bookId]);
        if (bookCheck.rows.length === 0) {
            return res.status(404).json({ message: "Книга не найдена" });
        }

        const newImageUrl = '/uploads/' + coverFile.filename;
        await pool.query("UPDATE books SET image_url = $1 WHERE id = $2", [newImageUrl, bookId]);
        
        console.log(`✅ Обложка книги ${bookId} обновлена: ${newImageUrl}`);
        res.json({ 
            message: "Обложка обновлена", 
            newImageUrl: newImageUrl 
        });
        
    } catch (error) {
        console.error("❌ Update cover error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== API: ОБНОВЛЕНИЕ ДАННЫХ КНИГИ (БЕЗ updated_at) =====
// ============================================================
app.put("/books/:id", async (req, res) => {
    const bookId = parseInt(req.params.id);
    const {
        title, author, year, stock, room, shelf,
        isbn, publisher, genre, description, user_login
    } = req.body;
    console.log(`✏️ Обновление книги ID: ${bookId}`);

    if (user_login !== 'librarian') {
        return res.status(403).json({ message: "Только библиотекарь может редактировать книги" });
    }

    try {
        const bookCheck = await pool.query("SELECT id FROM books WHERE id = $1", [bookId]);
        if (bookCheck.rows.length === 0) {
            return res.status(404).json({ message: "Книга не найдена" });
        }
        
        const query = `
            UPDATE books SET 
                title = $1, 
                author = $2, 
                yearofrelease = $3, 
                 "Количество экземпляров" = $4, 
                roomnumber = $5, 
                shelfnumber = $6,
                isbn = $7,
                publisher = $8,
                genre = $9,
                description = $10
             WHERE id = $11
            RETURNING id
        `;
        
        const values = [
            title, author, year, stock, 
            room || null, shelf || null,
            isbn || null, publisher || null,
            genre || null, description || null,
            bookId
        ];
        
        await pool.query(query, values);
        
        console.log(`✅ Книга "${title}" обновлена`);
        res.json({ message: `✅ Книга "${title}" успешно обновлена` });
        
    } catch (error) {
        console.error("❌ Update book error:", error);
        res.status(500).json({ message: "Ошибка: " + error.message });
    }
});

// ============================================================
// ===== НОВЫЕ МАРШРУТЫ ДЛЯ ВЫДАЧ И ПРОДЛЕНИЯ =====
// ============================================================

// API: ПОДТВЕРЖДЕНИЕ ВЫДАЧИ (БИБЛИОТЕКАРЬ)
app.post("/confirm-reservation", async (req, res) => {
    const { reservation_id, user_login } = req.body;
    if (user_login !== 'librarian') return res.status(403).json({ message: "Только библиотекарь" });
    try {
        // Находим активную бронь
        const r = await pool.query(
            "SELECT user_id, book_id FROM book_reservations WHERE id=$1 AND status='active'",
            [reservation_id]
        );
        if (r.rows.length === 0) return res.status(404).json({ message: "Бронь не найдена" });
        
        const { user_id, book_id } = r.rows[0];
        
        // ПРОВЕРКА: не выдана ли уже эта книга пользователю (активная выдача)
        const existing = await pool.query(
            "SELECT id FROM book_distribution WHERE book_id=$1 AND reader_id=$2 AND date_return IS NULL",
            [book_id, user_id]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: "❌ Эта книга уже выдана этому пользователю" });
        }
        
        // Получаем название книги
        const b = await pool.query("SELECT title FROM books WHERE id=$1", [book_id]);
        const bookTitle = b.rows[0]?.title || 'Неизвестная книга';
        
        // Получаем имя читателя
        const u = await pool.query("SELECT COALESCE(NULLIF(name,''), login) as reader_name FROM reader WHERE id=$1", [user_id]);
        const readerName = u.rows[0]?.reader_name || 'Читатель';
        
        // Создаем запись о выдаче (14 дней)
        await pool.query(
            `INSERT INTO book_distribution 
             (book_id, book_title, reader_id, reader_name, date_issue, planned_return_date) 
             VALUES ($1,$2,$3,$4,CURRENT_DATE,CURRENT_DATE+INTERVAL '14 days')`,
            [book_id, bookTitle, user_id, readerName]
        );
        
        // Меняем статус брони на completed
        await pool.query("UPDATE book_reservations SET status='completed' WHERE id=$1", [reservation_id]);
        
        res.json({ message: "✅ Книга выдана!" });
    } catch (e) {
        console.error("❌ Confirm reservation error:", e);
        res.status(500).json({ message: e.message });
    }
});

// API: ПРОДЛЕНИЕ КНИГИ
app.post("/extend-book", async (req, res) => {
    const { distribution_id, user_id } = req.body;
    try {
        await pool.query(
            "UPDATE book_distribution SET planned_return_date=planned_return_date+INTERVAL '14 days' WHERE id=$1 AND reader_id=$2 AND date_return IS NULL", 
            [distribution_id, user_id]
        );
        res.json({ message: "✅ Продлено на 14 дней!" });
    } catch (e) { 
        res.status(500).json({ message: e.message }); 
    }
});

// API: СПИСОК БРОНЕЙ ДЛЯ БИБЛИОТЕКАРЯ
app.get("/admin/reservations", async (req, res) => {
    if (req.query.user_login !== 'librarian') return res.status(403).json([]);
    try {
        const r = await pool.query(`
            SELECT br.id as reservation_id, br.reservation_date, br.expires_at,
                   r.id as user_id, r.name, r.surname, r.login as user_login,
                   b.title as book_title, b.author as book_author
            FROM book_reservations br
            JOIN reader r ON br.user_id=r.id JOIN books b ON br.book_id=b.id
            WHERE br.status='active' ORDER BY br.reservation_date DESC`);
        res.json(r.rows);
    } catch (e) { 
        res.status(500).json({ message: e.message }); 
    }
});

// ИСПРАВЛЕННЫЙ /my-list-books (с DISTINCT ON чтобы не дублировались)
app.get("/my-list-books", async (req, res) => {
    const userId = Number(req.query.user_id);
    const status = req.query.status || 'all';
    if (!userId) return res.status(400).json([]);
    try {
        let q = `SELECT DISTINCT ON (b.id) b.*, COALESCE(AVG(br.rating) OVER (PARTITION BY b.id),0) as avg_rating, COUNT(br.id) OVER (PARTITION BY b.id) as reviews_count, s.status as user_status
                 FROM user_book_statuses s JOIN books b ON s.book_id=b.id LEFT JOIN book_reviews br ON b.id=br.book_id WHERE s.user_id=$1`;
        const p = [userId];
        if (status !== 'all') { q += ` AND s.status=$2`; p.push(status); }
        q += ` ORDER BY b.id, s.created_at DESC`;
        const r = await pool.query(q, p);
        res.json(r.rows);
    } catch (e) { 
        res.status(500).json({ message: e.message }); 
    }
});

// ============================================================
// ===== ОБРАБОТКА ОШИБОК MULTER И ГЛОБАЛЬНАЯ =====
// ============================================================
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        console.error('❌ Multer error:', err);
        return res.status(400).json({ message: "❌ Ошибка загрузки: " + err.message });
    } else if (err) {
        console.error('❌ Error:', err);
        return res.status(400).json({ message: "❌ " + err.message });
    }
    next();
});

app.use((err, req, res, next) => {
    console.error('❌ GLOBAL ERROR:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({
        message: "Ошибка сервера",
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// ============================================================
// ===== ЗАПУСК СЕРВЕРА =====
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server started on port ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});