require('dotenv').config();
// const express = require('express');
const jsonServer = require('json-server');
const auth = require('json-server-auth');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid'); // 載入 UUID 套件
const nodemailer = require('nodemailer'); // 載入 郵件套件

const server = jsonServer.create();


const isProduction = process.env.NODE_ENV === 'production' || !!process.env.PORT;
const dbPath = isProduction ? '/data/db.json': path.join(__dirname, 'db.json');
console.log(`目前使用的資料庫路徑: ${dbPath}`);

const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();

// 設定參數
const PORT = process.env.PORT || 3001;
const SECRET_KEY = process.env.SECRET_KEY;
const EXPIRES_IN = process.env.EXPIRES_IN;
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS);


// 綁定資料庫以便 auth 模組存取 users
server.db = router.db;

// 啟用 CORS (允許前端跨網域請求)
server.use(cors());
server.use(middlewares);
server.use(jsonServer.bodyParser);

//產生token
function createToken(payload) {
  return jwt.sign(payload, SECRET_KEY, { expiresIn: EXPIRES_IN });
}

// 產生 6 位數隨機驗證碼(用於帳號驗證)
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 生成 7 位數隨機密碼(用於忘記密碼)
function generateResetPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < 7; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  } 
  return password;
}


// nodemailer 設定
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 發送驗證碼郵件
async function sendVerificationEmail(email, code) {
  try {
    await transporter.sendMail({
    from: `"Zonama-Ecommerce" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '✅ 會員註冊驗證碼',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1F749B;">歡迎註冊Zonama電商!</h2>
        <p>您的驗證碼是:</p>
        <div style="background: #f3f4f6; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
          ${code}
        </div>
        <p style="color: #6b7280;">此驗證碼將在 30 分鐘後失效。</p>
      </div>
    `
    });
    console.log('驗證碼郵件已發送至:', email);
    return { success: true };
  } catch (error) {
    console.error('郵件發送失敗:', error);
    return { success: false, error: error.message };
  }
}

//發送重設密碼郵件
async function sendResetPasswordEmail(email,code) {
  try {
    await transporter.sendMail({
      from: `"Zonama-Ecommerce" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '🔐 密碼重設驗證碼',
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1F749B;">Zonama電商 - 密碼重設請求</h2>
        <p>我們收到了您的密碼重設請求，請使用以下驗證碼：</p>
        <div style="background: #f3f4f6; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
          ${code}
        </div>
        <p style="color: #6b7280;">此驗證碼將在 30 分鐘後失效。</p>
      </div>
      `
    })
    
  } catch (error) {
    
  }
}



/* 註冊API */
server.post('/api/register', async (req,res) => {
  console.log('[Custom Register] 觸發自定義註冊邏輯...'); 
  const { email, password, username } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "請提供 Email 和密碼" });
  }

  if (password.length < 6) {
      return res.status(400).json({ message: "密碼至少需要 6 個字元"});
  }

  const userExists = router.db.get('users').find({ email }).value();
  if (userExists === email) {
    return res.status(400).json({ message: "此 Email 已被註冊" });
  }

  try {
    //密碼加密
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    //產生驗證碼
    const verificationCode = generateVerificationCode();

    //建立newUser
    const newUser = {
      id: uuidv4(),
      email,
      password: hashedPassword, // 存入 Hash
      username: username || 'User',
      role: 'user',
      isVerified: false, // 初始狀態
      verificationCode: verificationCode //儲存真實驗證碼
    };

 
    //寫入資料庫
    router.db.get('users').push(newUser).write();
    console.log('✅ 註冊成功，使用者已寫入資料庫:', newUser.id);

    try {
      //發送驗證信
      console.log(`準備發送驗證碼到 ${email}`);
      await sendVerificationEmail(email, verificationCode);
      console.log('✅ 郵件發送成功');

      res.status(200).json({
        message: '註冊成功，驗證碼已發送至您的信箱',
        data: { email: newUser.email, id: newUser.id }
      });
    } catch (mailError) {
      console.log(`[開發模式備援]郵件發送失敗，您的驗證碼是：\x1b[33m${verificationCode}\x1b[0m`);
      res.status(500).json({ message: "郵件發送失敗", error: mailError.message });
      
    }

    //註冊成功，引導去驗證
    return res.status(201).json({ message: "註冊成功，驗證碼已發送至您的信箱", email });


  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "註冊失敗", error: error.message });
  }
});


/* 帳號驗證API */
server.post('/api/verify', (req, res) => {
  const { email, code } = req.body;
  
  try {
  //比對user
  const user = router.db.get('users').find({ email }).value();
  if (!user) {
    return res.status(404).json({ message: "找不到此帳號" });
  }

  //比對驗證碼
  if (user.verificationCode !== code) {
    return res.status(400).json({ message: "驗證碼錯誤" });
  }

  //驗證成功：更新狀態並清除驗證碼
  router.db.get('users')
    .find({ email })
    .assign({ isVerified: true, verificationCode: null })
    .write();
    
    console.log('✅ 帳號驗證成功');
    res.status(200).json({ message: '帳號驗證成功!' });

  } catch (error) {
    console.error('驗證錯誤:', error);
    res.status(500).json({ message: "驗證失敗" });
  }
  
});


/* 重新發送驗證碼API */
server.post('/api/resend-verification', async (req, res) => {
  const { email } = req.body;

  //比對email
  const user = router.db.get('users').find({ email }).value();
  if (!user) {
    return res.status(404).json({ message: "找不到此信箱註冊資料" });
  }

  if (user.isVerified) {
    return res.status(400).json({ message: "此帳號已驗證過，請直接登入" });
  }

  const newCode = generateVerificationCode();

  try {

    //寫入新驗證碼
    router.db.get('users')
      .find('email')
      .assign({ verificationCode: newCode })
      .write();

    console.log(`準備發送驗證碼到 ${email}`);
    await sendVerificationEmail(email, newCode);
    console.log('✅ 郵件發送成功');
    return res.status(200).json({ message: "驗證碼已重新發送" });

  } catch (error) {
    console.error('郵件發送失敗:', error);
    console.log(`[開發模式備援] 新驗證碼：\x1b[33m${newCode}\x1b[0m`);

    //即使寄信失敗，依然寫入新驗證碼
    router.db.get('users')
      .find('email')
      .assign({ verificationCode: newCode })
      .write();
    
    res.status(500).json({ message: "驗證碼已更新 (郵件發送失敗，請查看後端 Console)" })   
  }
})


/* 登入檢查 Email API */
// 提供前端在輸入時即時檢查，避免重複註冊或登入不存在的帳號

server.post('/api/check-email', (req, res) => {
  const { email } = req.body;

  const user = router.db.get('users').find({ email }).value();
  console.log('✅ 此帳號存在');
  
  // 回傳是否存在 (exists: true/false)
  res.status(200).json({ exists: !!user });
});


/* 登入API */
// 比對密碼 hash，成功則回傳 JWT
server.post('/api/login', async (req, res) => {
  
  const { email, password } = req.body;
  const user = router.db.get('users').find({ email }).value();
  console.log(user);

  if (!user) {
    console.log('找不到此帳號');
    return res.status(400).json({ message: "找不到此帳號" });
  }
  
  try {
    // bcrypt 比對密碼
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log('密碼錯誤');
      return res.status(400).json({ message: "密碼錯誤，請重新輸入密碼" });
    }
    
    if (!user.isVerified) {
      console.log('帳號尚未驗證');
      return res.status(403).json({ message: "您的帳號尚未驗證，請先完成驗證流程" });
    }

    //產生token
    const accessToken = createToken({ email, id: user.id });
    
    //白名單剔除法
    const { password: _, verificationCode: __, ...userSafe } = user;

    console.log('✅ 登入成功! ');
    return res.status(200).json({ accessToken, user: userSafe });

  } catch (error) {
    console.log('登入驗證失敗', error);
    return res.status(500).json({ message: "登入驗證錯誤" });
  }
});


/* 忘記密碼API */
server.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    console.log('請提供信箱');
    return res.status(400).json({error: true, message: '請提供信箱'})
  }

  const user = router.db.get('users').find({ email }).value();
  if (!user) {
    return res.status(404).json({error:true, message: '此 Email 未註冊'})
  }

  const newCode = generateResetPassword();

  try {
    await sendResetPasswordEmail(email, newCode);
    console.log('✅ 郵件發送成功');

    //更新資料庫會員驗證碼
    router.db.get('users').find({ email }).assign({ verificationCode: newCode }).write();

    res.status(200).json({ message: "重設驗證碼已寄出" });
  } catch (error) {
    res.status(500).json({ message: "郵件發送失敗" });
  }
});

/* 重設密碼API */
server.post('/api/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  const user = router.db.get('users').find({ email }).value();

  if (!user) {
    return res.status(404).json({ message: "找不到此帳號" });
  }

  if (user.verificationCode !== code) {
    return res.status(400).json({ message: "驗證碼錯誤或已過期" });
  }

  try {
    //新密碼加密
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    //寫入資料庫
    router.db.get('users')
      .find({ email })
      .assign({ password: hashedPassword, verificationCode: null })
      .write();

    console.log('✅ 密碼重設成功');
    res.status(200).json({ message: "密碼重設成功" });
  } catch (error) {
    console.log('密碼重設失敗');
    res.status(500).json({ message: "密碼重設失敗" });
  }
})

//先掛載「自定義 Router」到 /auth 路徑
// server.use('/auth', authPouter);

// 設定權限規則
server.use(auth.rewriter({
  "/users*": "/600/users$1",
  "/orders*": "/660/orders$1",
  "/products*": "/444/products$1"
}));

// 啟用登入驗證 Middleware
server.use(auth);

//載入預設路由
server.use(router);

server.listen(PORT, () => {
  console.log(`🚀 Upgraded Server Running on Port ${PORT}`);
  console.log(`📧 Email Service: ${process.env.EMAIL_SERVICE}`);
});

