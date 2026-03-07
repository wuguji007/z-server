const crypto = require('crypto');

const MerchantID = process.env.NEWEBPAY_MERCHANT_ID || 'MERCHANT_ID';
const HashKey = process.env.NEWEBPAY_HASH_KEY || 'HASH_KEY';
const HashIV = process.env.NEWEBPAY_HASH_IV || 'HASH_IV';
const Version = '2.0';

/**
 * 將物件轉換為 Query String
 * e.g. { a: 1, b: 2 } => "a=1&b=2"
 */
function genDataChain(order) {
  return Object.entries(order)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/**
 * AES-256-CBC 加密（產生 TradeInfo）
 * @param {Object} TradeInfo - 交易資料物件
 * @returns {string} HEX 格式加密字串
 */
function createAesEncrypt(TradeInfo) {
  const cipher = crypto.createCipheriv('aes-256-cbc', HashKey, HashIV);
  const enc = cipher.update(genDataChain(TradeInfo), 'utf8', 'hex');
  return enc + cipher.final('hex');
}

/**
 * SHA256 雜湊（產生 TradeSha)
 * @param {string} aesInfo - 即createAesEncrypt回傳的HEX字串
 * @returns {string} 大寫 SHA256 字串
 */
function createShaEncrypt(aesInfo) {
  const plainText = `HashKey=${HashKey}&${aesInfo}&HashIV=${HashIV}`;
  return crypto.createHash('sha256').update(plainText).digest('hex').toUpperCase();
}



/*  ———————————————————— AES-256-CBC 解密 ————————————————————  */

/**
 * 驗證 TradeSha（確認回呼來自藍新，非偽造）
 * 藍新文件：HashKey + TradeInfo(AES加密後) + HashIV → SHA256 → 大寫
 */
function verifyTradeSha(tradeInfo, tradeSha) {
  const expected = createShaEncrypt(tradeInfo);
  const isValid  = expected === tradeSha;
  console.log('[verifyTradeSha] expected:', expected);
  console.log('[verifyTradeSha] received:', tradeSha);
  console.log('[verifyTradeSha] 驗證結果:', isValid ? '✅ 合法' : '❌ 不符');
  return isValid;
}

/**
 * AES-256-CBC 解密（用於解析藍新 NotifyURL 回傳的 TradeInfo）
 * @param {string} tradeInfoHex - HEX 格式加密字串
 * @returns {Object} 解密後的交易資料物件
 */
function createAesDecrypt(tradeInfoRaw) {
  // Step 1：清理 TradeInfo，移除可能的 URL encode 和空白
  const tradeInfoHex = decodeURIComponent(tradeInfoRaw)
    .replace(/\+/g, ' ')  // URL encode 的 + 還原成空格（但 hex 不應有空格，保險起見）
    .trim();

  console.log('[createAesDecrypt] TradeInfo 前10碼:', tradeInfoHex.substring(0, 10));
  console.log('[createAesDecrypt] TradeInfo 長度:', tradeInfoHex.length);
  
  // Step 2：AES 解密
  const decipher = crypto.createDecipheriv('aes-256-cbc', HashKey, HashIV);
  decipher.setAutoPadding(false); // 關閉自動 padding

  // let decrypted = decipher.update(tradeInfoHex, 'hex', 'utf8');
  // decrypted += decipher.final('utf8');
  let decrypted = decipher.update(tradeInfoRaw.trim(), 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  // 手動去除尾端 padding 字元（\x00 ~ \x10）
  // decrypted = decrypted.replace(/[\x00-\x10]+$/, '');

  // 找到最後一個 } 截斷，完全消除尾端 padding 殘留
  const lastBrace = decrypted.lastIndexOf('}');
  if (lastBrace !== -1) {
    decrypted = decrypted.substring(0, lastBrace + 1);
  }

  console.log('[createAesDecrypt] 解密後原始字串 (前100碼):', decrypted.substring(0, 100));

  // Step 3：解析
  // 藍新 v2.0 回呼格式：{ Status, Category, Message, Result: { MerchantOrderNo, Amt, ... } }
  if (decrypted.trim().startsWith('{')) {
    const parsed = JSON.parse(decrypted.trim());

    console.log('[createAesDecrypt] JSON 解析成功，Result:', parsed.Result);
    // 把頂層和 Result 合併，方便後續取值
    return parsed.Result
      ? { Status: parsed.Status, Message: parsed.Message, ...parsed.Result }
      : parsed;
  }


  // 舊版 query string fallback
  console.log('[createAesDecrypt] 非 JSON，改用 query string 解析');
  return Object.fromEntries(new URLSearchParams(decrypted));
}

module.exports = {
  MerchantID,
  Version,
  createAesEncrypt,
  createShaEncrypt,
  createAesDecrypt,
  verifyTradeSha,
};