const jsonServer = require('json-server');
const auth = require('json-server-auth');
const cors = require('cors');

const app = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();

// 綁定資料庫以便 auth 模組存取 users
app.db = router.db;

// 啟用 CORS (允許前端跨網域請求)
app.use(cors()); // 解決跨域問題
app.use(middlewares);

// 設定規則 (例如：/api/* 對應到 /)
app.use(jsonServer.rewriter({
  '/api/*': '/$1'
}));

// 啟用登入驗證 Middleware
app.use(auth);
app.use(router);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
