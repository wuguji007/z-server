// ── 執行方式：在 server 目錄下執行 node test_decrypt.js ──
require('dotenv').config();
const crypto = require('crypto');

const HashKey = process.env.NEWEBPAY_HASH_KEY;
const HashIV  = process.env.NEWEBPAY_HASH_IV;

// 貼上最新一筆藍新回呼的 TradeInfo
const TradeInfo = '1fb500ab07c0d5f6a666eca7b97b4170e2173526d47862d264b396fb93cfae49871fd830f94813fa35957cce9aaf4b418339fbac225369fa96e139254dee1b65516ecc1d907659fa8294dd521d3edc84c7eff43f150ccac15c7b813c768152dc1cfdf2daf8a250e682e0750b31463b4116f6c4f352a31e79cbbca8a136257b532f8c4d6db0c7c66b3fa86fabc73f58b5d3468797441da7503b103a8927a4571d45577634853556384d03907536bd6058a47b025ed82a572847a052dcf345e7fe971ba4a0ed35f79415926609058773f489629632ba9f4eaa52fdf45d01d7c6b950eef85b3d85ad21aa3d337a6104977edfedede978864430cf317b0c8b5ddbea13adec70bd413952307f4c831624942e8d63b85cc4a33af643dfa63dbce601e7071d3223c74c7e9c9ad0ee16a3af6a1cd15eae536bd762b9f4472defef1d4811c3e208d1be974f886cd4544300f69b84c9676ba77496e6ba7657e0f3d61220d90f0b2d52ae51bd74f4ddddb650d1e69ae0fe4895c75764de5a034b86771306e50f216821030acd739e807871551189bd9ffe7a664e3a36755d17150b145b7f02d6638bc02946933235d03c6f28628b4dcfd2e7847884de8fe84a6e0f5bd7ff2cd9ece124ceccdea612347bf2758b6f90eab4ebebabee20f82a8c7fb7f0bb725c06c1837abc73b42f82136f16c47b8c6367f820e23c8d5541f3b4bf3402614d36';

console.log('HashKey:', HashKey);
console.log('HashKey 長度:', HashKey?.length);
console.log('HashIV:', HashIV);
console.log('HashIV 長度:', HashIV?.length);
console.log('');

// 方法一：直接用字串（目前的做法）
console.log('=== 方法一：字串直接解密 ===');
try {
  const d = crypto.createDecipheriv('aes-256-cbc', HashKey, HashIV);
  let result = d.update(TradeInfo, 'hex', 'utf8');
  result += d.final('utf8');
  console.log('✅ 成功:', result.substring(0, 200));
} catch (e) {
  console.log('❌ 失敗:', e.message);
}

// 方法二：Buffer 轉換後解密
console.log('\n=== 方法二：Buffer 解密 ===');
try {
  const keyBuf = Buffer.from(HashKey, 'utf8');
  const ivBuf  = Buffer.from(HashIV, 'utf8');
  const d = crypto.createDecipheriv('aes-256-cbc', keyBuf, ivBuf);
  let result = d.update(TradeInfo, 'hex', 'utf8');
  result += d.final('utf8');
  console.log('✅ 成功:', result.substring(0, 200));
} catch (e) {
  console.log('❌ 失敗:', e.message);
}

// 方法三：把 TradeInfo 當作 Base64 解碼後再解密
console.log('\n=== 方法三：TradeInfo 當 Base64 解碼後解密 ===');
try {
  const tradeInfoBuf = Buffer.from(TradeInfo, 'base64');
  const d = crypto.createDecipheriv('aes-256-cbc', HashKey, HashIV);
  let result = d.update(tradeInfoBuf);
  result = Buffer.concat([result, d.final()]);
  console.log('✅ 成功:', result.toString('utf8').substring(0, 200));
} catch (e) {
  console.log('❌ 失敗:', e.message);
}

// 方法四：setAutoPadding false
console.log('\n=== 方法四：關閉 AutoPadding ===');
try {
  const d = crypto.createDecipheriv('aes-256-cbc', HashKey, HashIV);
  d.setAutoPadding(false);
  let result = d.update(TradeInfo, 'hex', 'utf8');
  result += d.final('utf8');
  // 移除尾端控制字元
  const cleaned = result.replace(/[\x00-\x1F]+$/, '');
  console.log('✅ 結果 (前200碼):', cleaned.substring(0, 200));
} catch (e) {
  console.log('❌ 失敗:', e.message);
}