// const express = require('express');
const jsonServer = require('json-server');
const server = jsonServer.create();
const auth = require('json-server-auth');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
require('dotenv').config();
const cors = require('cors');
const { v4: uuidv4 } = require('uuid'); // 載入 UUID 套件
const nodemailer = require('nodemailer'); // 載入 郵件套件
//匯入Newebpay結帳工具
const {
  MerchantID,
  Version,
  createAesEncrypt,
  createShaEncrypt,
  createAesDecrypt,
  verifyTradeSha
} = require('./utils/newebpayUtils');

//資料庫連結check: production or development
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.PORT;
const dbPath = isProduction ? '/data/db.json': path.join(__dirname, 'db.json');

// Dev Mode使用
// const dbPath = path.join(__dirname, 'db.json');

console.log(`目前使用的資料庫路徑: ${dbPath}`);

const router = jsonServer.router(dbPath);
// const router = jsonServer.router('db.json');

// 設定參數
const PORT = process.env.PORT || 3001;
const SECRET_KEY = process.env.SECRET_KEY;
const EXPIRES_IN = process.env.EXPIRES_IN;
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS);

// 藍新金流網址
const NEWEBPAY_URL = process.env.NEWEBPAY_ENV === 'production'
  ? 'https://core.newebpay.com/MPG/mpg_gateway'
  : 'https://ccore.newebpay.com/MPG/mpg_gateway'; // 測試環境

// 前端 ReturnURL（付款完成後藍新導回前端）
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'https://overcleanly-postdiphtherial-willie.ngrok-free.dev';


// 綁定資料庫以便 auth 模組存取 users
server.db = router.db;

// 關閉內建 bodyParser，避免重複解析
const middlewares = jsonServer.defaults({ bodyParser: false });

// 啟用 CORS (允許前端跨網域請求)
server.use(cors());
server.use(middlewares);
server.use(bodyParser.json());
server.use(bodyParser.urlencoded({ extended: true }));
// server.use(jsonServer.bodyParser);

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
        <p style="color: #6b7280;">此驗證碼將在 10 分鐘後失效。</p>
      </div>
      `
    })
    console.log('重設密碼郵件已發送至:', email);
    return { success: true };
  } catch (error) {
    console.error('重設密碼郵件發送失敗:', error);
  }
};

// 訂單確認付款通知信
async function sendOrderConfirmEmail(email, orderNo, total) {
  try {
    await transporter.sendMail({
      from: `"Zonama-Ecommerce" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `🛍️ 訂單付款確認通知 - ${orderNo}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #2f8fbc; text-align: center;">
          <h2 style="color: #1F749B; border-bottom: 1px solid #1F749B; padding-bottom: 10px;">Zonama電商 - 訂單付款確認通知</h2>
          <h2 style="color: #051116;">您的訂單已完成付款！</h2>
          <p>訂單編號：<strong>${orderNo}</strong></p>
          <p>應付金額：<strong>NT$${Number(total).toLocaleString()}</strong></p>
          <p>我們已收到您的付款，感謝您的購買！</p>
        </div>
      `
    });
    console.log('訂單確認信發送成功');
  } catch (error) {
    console.error('訂單確認信發送失敗:', error);
  }
};


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
  if (userExists) {
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

      return res.status(201).json({
        message: '註冊成功，驗證碼已發送至您的信箱',
        data: { email: newUser.email, id: newUser.id }
      });
    } catch (mailError) {
      console.log(`[開發模式備援]郵件發送失敗，您的驗證碼是：\x1b[33m${verificationCode}\x1b[0m`);
      res.status(500).json({ message: "郵件發送失敗", error: mailError.message });    
    }

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
      .find({ email })
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


/* ─── 藍新金流 API ─── */
/** 
 * POST /api/payment/create-order
 * 藍新金流結帳流程：
 * 1.從前端接收訂單資訊和收件資訊
 * 2.後端存入db.json的orders，狀態Pending
 * 3.用AES/SHA256加密，產生TradeInfo和TradeSha
 * 4.回傳前端，前端用表單POST到藍新(藍新需要的資訊：MerchantID、TradeInfo、TradeSha、Version)
 * 5.藍新處理後回傳結果到 /api/payment/notify，後端更新訂單狀態
 * 6.前端更新訂單狀態
 * 注意：需登入 && 後端驗證JWT
*/

server.post('/api/payment/create-order', (req, res) => {
  const {
    merchantOrderNo,
    items,
    subtotal,
    shippingFee,
    total,
    receiverName,
    phone,
    email,
    address,
    paymentMethod,
    shippingMethod,
    paymentStatus = 'PENDING', // PENDING || SUCCESS || FAILED
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString()
  } = req.body;
  console.log('接收到訂單資訊:', req.body);

  // 透過前端傳入的paymentMethod動態組裝付款參數
  function buildPaymentParams(paymentMethod) {
    switch (paymentMethod) {
      case 'CREDIT':      return { CREDIT: 1 };
      case 'CREDIT_INST': return { CREDIT: 1, InstFlag: '3,6,12' };
      case 'WEBATM':      return { WEBATM: 1 };
      case 'VACC':        return { VACC: 1 };
      case 'CVS':         return { CVS: 1 };
      default:            return { CREDIT: 1 };
    };
  };

  const paymentParams = buildPaymentParams(paymentMethod);
  
  // 驗證JWT
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: '請先登入，缺少 Token' });
  }

  let currentUser;
  try {
    currentUser = jwt.verify(token, SECRET_KEY);
  } catch (err) {
    return res.status(401).json({ message: 'Token 無效或已過期' });
  }

  // 表單欄位驗證
  if (!merchantOrderNo || !receiverName || !total || !address || !phone) {
    return res.status(400).json({ message: '缺少必要欄位' });
  }

  // 防止重複建立訂單
  const existingOrder = router.db.get('orders').find({ merchantOrderNo }).value();
  if (existingOrder) {
    return res.status(409).json({ message: '此訂單編號已存在' });
  }

  // 建立新訂單
  const newOrder = {
    id: uuidv4(),
    merchantOrderNo,
    userId: currentUser.id, // 從JWT取得用戶ID
    items: items || [],
    subtotal: subtotal || 0,
    shippingFee: shippingFee || 0,
    total,
    receiverName,
    phone,
    email,
    address,
    paymentMethod,
    shippingMethod,
    paymentStatus,
    createdAt,
    updatedAt
  };

  // order存入資料庫
  router.db.get('orders').push(newOrder).write();
  console.log('✅ 訂單已建立，等待付款:', newOrder.id);

  // 藍新TradeInfo所需參數
  const tradeInfo = {
    MerchantID,
    RespondType: 'JSON',
    TimeStamp: Math.floor(Date.now() / 1000).toString(),
    Version,
    MerchantOrderNo: merchantOrderNo,
    Amt: total,
    ItemDesc: items?.map(i => i.name).join(',').slice(0, 50) || '商品購買',
    Email: email,
    LoginType: 0,
    // 付款完成後藍新POST回後端（非同步通知）
    NotifyURL: `${BACKEND_URL}/api/payment/notify`,
    ReturnURL:   `${FRONTEND_URL}/z-client/index.html#/payment-complete`,
    CustomerURL: `${FRONTEND_URL}/z-client/index.html#/payment-complete`,
    ...paymentParams,
  };

  const aesEncrypted = createAesEncrypt(tradeInfo);
  const shaEncrypted = createShaEncrypt(aesEncrypted);

  console.log('NotifyURL:', `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/payment/notify`);
  console.log(`藍新加密完成: ${merchantOrderNo}`);
  res.status(200).json({
    MerchantID,
    TradeInfo: aesEncrypted,
    TradeSha: shaEncrypted,
    Version,
    PaymentUrl: NEWEBPAY_URL
  });
});

/**
 * POST /api/payment/notify
 * 藍新非同步回呼（NotifyURL）
 * 藍新以POST方式回傳訂單結果(成功/失敗)
 * 後端驗證TradeSha，更新訂單狀態
 * 注意：此路由不可要求JWT，藍新無法帶Token
*/

server.post('/api/payment/notify', async (req, res) => {
  console.log('收到藍新回呼:', req.body);
  const { TradeInfo, Status } = req.body;

  if (!TradeInfo) {
    console.log('缺少TradeInfo');
    return res.status(400).json({ message: '缺少TradeInfo' });
  }

  // 驗證是否為本店商家 ID
  const {MerchantID: receivedMID} = req.body;
  console.log('收到 MerchantID:', receivedMID, '| 本店 MerchantID:', MerchantID);
  if (receivedMID !== MerchantID) {
    console.error('MerchantID 不符，疑似偽造請求');
    return res.status(400).send('ERROR');
  }

  try {

    const { TradeSha } = req.body;

    // Step 1：先用 TradeSha 驗證此請求確實來自藍新
    // 若 TradeSha 驗證失敗代表 key 不符，解密也必然失敗
    const isValid = verifyTradeSha(TradeInfo, TradeSha);
    if (!isValid) {
      console.error('[Newebpay Notify] TradeSha 驗證失敗 → HashKey/HashIV 與藍新後台不一致！');
      return res.status(400).send('ERROR');
    }

    // Step 2：TradeSha 驗證通過才解密
    const tradeResult = createAesDecrypt(TradeInfo);
    console.log('[Newebpay Notify] 解密成功:', tradeResult);
    const { MerchantOrderNo, Amt, PaymentType, BankCode, CodeNo } = tradeResult;


    if (Status === 'SUCCESS') {
      // 更新訂單狀態為已付款
      router.db.get('orders')
        .find({ merchantOrderNo: MerchantOrderNo })
        .assign({
          paymentStatus: 'SUCCESS',
          paymentType: PaymentType,
          paidAmt: Number(Amt),
          paidAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .write();
      console.log(`✅ 訂單付款成功: ${MerchantOrderNo}`);

      // 發送訂單付款確認信（非同步，不阻塞回應）
      const order = router.db.get('orders').find({ merchantOrderNo: MerchantOrderNo }).value();
      if (order.email) {
        await sendOrderConfirmEmail(order.email, MerchantOrderNo, Amt).catch(console.error);
      };

    } else {
      // 更新訂單狀態為付款失敗
      router.db.get('orders')
        .find({ merchantOrderNo: MerchantOrderNo })
        .assign({
          paymentStatus: 'FAILED',
          paymentType: PaymentType,
          paidAmt: Number(Amt),
          paidAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .write();
      console.log(`❌ 訂單付款失敗: ${MerchantOrderNo}`);
    }

    // 必須回傳 OK 讓藍新知道已收到通知
    return res.status(200).send('OK');

  } catch (error) {
    console.log('[Newebpay Notify] 處理失敗:', error);
    return res.status(500).send('Error');
  }
});


// ⚠️ 僅開發測試用，上線前移除
// 模擬藍新 notify 回呼，產生可直接貼到 Postman 的測試資料
// GET /api/dev/mock-notify/:orderNo?status=SUCCESS&paymentType=CREDIT
// GET /api/dev/mock-notify/:orderNo?status=VACC&paymentType=VACC   (模擬ATM取號)
// GET /api/dev/mock-notify/:orderNo?status=CVS&paymentType=CVS     (模擬超商取號)
server.get('/api/dev/mock-notify/:orderNo', (req, res) => {
  const { orderNo } = req.params;
  const status = req.query.status || 'SUCCESS'; // ?status=FAILED 可測試失敗
  const paymentType = req.query.paymentType || 'CREDIT';

  // 查詢訂單取得實際金額
  const order = router.db.get('orders').find({ merchantOrderNo: orderNo }).value();
  const amt   = order?.total || 999;

  // 模擬藍新真實回呼的 JSON 格式（v2.0）
  // 藍新實際回呼：先組 Result 物件，再包一層 { Status, Message, Result }，最後 AES 加密
  const resultData = {
    MerchantID,
    Amt: amt,
    TradeNo: `NEWEBPAY${Date.now()}`,
    MerchantOrderNo: orderNo,
    RespondType: 'JSON',
    PaymentType: paymentType,
    PayTime: new Date().toISOString(),
    ...(paymentType === 'VACC' ? { BankCode: '004', CodeNo: 'TestAccount12345' } : {}),
    ...(paymentType === 'CVS'  ? { CodeNo: 'TEST123456789' } : {}),
  };

  const tradeInfoObj = {
    Status:  status,
    Message: status === 'SUCCESS' ? '授權成功' : status,
    Result:  resultData,
  };

  // 用 setAutoPadding(false) 對應解密方式，手動加 PKCS7 padding
  const crypto  = require('crypto');
  const HashKey = process.env.NEWEBPAY_HASH_KEY;
  const HashIV  = process.env.NEWEBPAY_HASH_IV;

  const plainText  = JSON.stringify(tradeInfoObj);
  const blockSize  = 16;
  const padLen     = blockSize - (Buffer.byteLength(plainText) % blockSize);
  const padded     = Buffer.concat([Buffer.from(plainText), Buffer.alloc(padLen, padLen)]);

  const cipher     = crypto.createCipheriv('aes-256-cbc', HashKey, HashIV);
  cipher.setAutoPadding(false);
  const encrypted  = Buffer.concat([cipher.update(padded), cipher.final()]).toString('hex');

  // 產生對應的 TradeSha
  const TradeSha = require('crypto')
    .createHash('sha256')
    .update(`HashKey=${HashKey}&${encrypted}&HashIV=${HashIV}`)
    .digest('hex')
    .toUpperCase();

  res.json({
    hint: `將以下欄位貼到 Postman → POST /api/payment/notify → Body → x-www-form-urlencoded`,
    fields: {
      Status: status,
      PaymentType: paymentType,
      MerchantID,
      TradeInfo: encrypted,
      TradeSha,
    }
  });
});


/**
 * GET /api/orders?merchantOrderNo=ZNM-xxxx
 * 前端查詢特定訂單狀態
 * 注意：需登入 && 只能查詢自己的訂單 && 後端驗證JWT和訂單所屬用戶
*/
server.get('/api/orders', (req, res) => {
  const { merchantOrderNo } = req.query;

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: '請先登入，缺少 Token' });
  }

  let currentUser;
  try {
    currentUser = jwt.verify(token, SECRET_KEY);
  } catch (err) {
    return res.status(401).json({ message: 'Token 無效或已過期' });
  }

  console.log('查詢訂單 - userId:', currentUser.id, '| merchantOrderNo:', merchantOrderNo || '（查全部）');

  // 查找單筆訂單
  if (merchantOrderNo) {
    const order = router.db.get('orders').find({ merchantOrderNo: merchantOrderNo }).value();
    if (!order) {
      return res.status(404).json({ message: '找不到此訂單' });
    }
    if (order.userId !== currentUser.id) {
      return res.status(403).json({ message: '無權限查看此訂單' });
    }
    return res.status(200).json([order]);
  }

  // 回傳此使用者所有訂單(依建立時間倒序）
  const orders = router.db.get('orders')
    .filter({ userId: currentUser.id })
    .value()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.status(200).json(orders);

});

// 測試解密路由
server.get('/api/dev/test-decrypt', (req, res) => {
  const TradeInfo = '1fb500ab07c0d5f6a666eca7b97b4170e2173526d47862d264b396fb93cfae49871fd830f94813fa35957cce9aaf4b418339fbac225369fa96e139254dee1b65516ecc1d907659fa8294dd521d3edc84c7eff43f150ccac15c7b813c768152dc0e9fc43ebb463a6b9aa960d3538d858e46056b36f2d782b2ae7349ee31aa1a183720e13cbc92cf1a7c65eeb80f6b412dc24ea7a31394a3fdea7f2fb00f6e24c13d5237263564ff0b33a162a065ebdea296b417cbac33bf7224c6653cc365de33d8e510d7505a4202840a4b211d03ce94beff2c880b8fe42c1ad8212c4482af13175f1504819070ebf937e680acace729f531726dfd3b20918b0910367baec516bfa0f7d89c2e93e700105a5ab78d3367571c1ab6a7e70e96529b2db17fa4cd2e5e1e66a0976131b68b9e078ac661a527bc9959a2e1adce8def25c92999010516c11098357f70c5dd1366416ee37db339f95dac0b1d5b337eff44fd1189eeeb4825bfc1cede807805b0b6f2ae683ce4b9f3d0f1370bc3f4e896a93cd0ae07a0604d32f286decc9ed4ca328d6f0c9b3f7d159a5e04e688bc8247896fcd46496db2d3e2327e94d54a4bcf3305ab5487da9d7755b432fce4ead2c79f07f40d8dcedde5530f81043db3c96f68acf23ade23c6bb0a99b1bbc301b6f69a19b89925ef9b155583ff4ffd3951ea8597dfcb8ccae90ce9ebd068fa14d9a3e89610f18daffd'; // 貼上剛才的 TradeInfo
  try {
    const result = createAesDecrypt(TradeInfo);
    res.json({ success: true, result });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});



//先掛載「自定義 Router」到 /auth 路徑
// server.use('/auth', authPouter);

// 設定權限規則
server.use(auth.rewriter({
  "/users*": "/600/users$1",
  // "/orders*": "/660/orders$1",
  "/products*": "/444/products$1"
}));

// 啟用登入驗證Middleware
server.use(auth);

//掛載資料庫路由
server.use(router);

server.listen(PORT, () => {
  console.log(`🚀 Upgraded Server Running on Port ${PORT}`);
  console.log(`📧 Email Service: ${process.env.EMAIL_SERVICE}`);
  console.log(`NewebPay MerchantID: ${MerchantID}`);
  console.log(`Payment route is now PROTECTED by authentication.`);
});

