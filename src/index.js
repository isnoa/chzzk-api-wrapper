console.clear();

require("dotenv").config();
const express = require("express");
const Chzzk = require("./chzzk");
const expressBasicAuth = require("express-basic-auth");
const axiosForWebhook = require("axios");
const axios = require("axios");

const app = express();
const port = 3000;

const LOGIN_USERNAME = process.env.LOGIN_USERNAME;
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

app.use(express.json());
app.disable("x-powered-by");
app.use(
  ["/auth/login", "/me"],
  expressBasicAuth({
    challenge: true,
    users: {
      [LOGIN_USERNAME]: LOGIN_PASSWORD,
    },
  })
);

const { CHZZK_CLIENT_ID, CHZZK_CLIENT_SECRET, CHZZK_REDIRECT_URI } = process.env;

const chzzk = new Chzzk({
  clientId: CHZZK_CLIENT_ID,
  clientSecret: CHZZK_CLIENT_SECRET,
  autoRefreshToken: true,
  // tokenRefreshThresholdMs: "5m", // optional, default is 15 minutes
  tokenReissueLogger: true,
});

async function sendDiscordAlert(message) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await axiosForWebhook.post(DISCORD_WEBHOOK_URL, { content: message });
  } catch (e) {
    console.error("[discord-webhook-error]", e.message);
  }
}

(async () => {
  await chzzk.init();
  console.log("[DEBUG] Loaded accessToken:", chzzk.accessToken);
  console.log("[DEBUG] Loaded refreshToken:", chzzk.refreshToken);
  if (!chzzk.refreshToken) {
    await sendDiscordAlert(
      `[chzzk-api-wrapper] refreshToken 이 누락되었습니다!\naccessToken: ${
        chzzk.accessToken || "(none)"
      }`
    );
  }
  app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
  });
})();

app.get("/", (req, res) => {
  res.send("Hello, world!");
});

app.get("/auth/login", (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  const authUrl = chzzk.getAuthorizationCodeUrl(CHZZK_REDIRECT_URI, state);
  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  try {
    const tokens = await chzzk.issueAccessTokenByCode(code, state);
    if (tokens.accessToken) {
      res.json({ ok: true, message: null, data: null });
    } else {
      res.status(400).json({ ok: false, message: "액세스 토큰을 가져오는 데 실패했습니다", data: null });
    }
  } catch (error) {
    console.error("토큰 발급 중 오류:", error);
    res.status(500).json({ ok: false, message: "토큰 발급에 실패했습니다", data: null });
  }
});

app.get("/me", async (req, res) => {
  try {
    if (!chzzk.accessToken) {
      return res.status(401).json({
        ok: false,
        message: "액세스 토큰이 누락되었습니다. 인증을 다시 진행하세요.",
        data: null,
      });
    }
    const userInfo = await chzzk.getMyUserInfo();
    res.json({ ok: true, message: null, data: userInfo ?? null });
  } catch (error) {
    console.error("사용자 정보 가져오기 중 오류:", error);
    if (error.message && error.message.includes("Access Token is required")) {
      return res.status(401).json({
        ok: false,
        message: "액세스 토큰이 누락되었습니다. 인증을 다시 진행하세요.",
        data: null,
      });
    }
    res.status(500).json({ ok: false, message: "사용자 정보를 가져오는 데 실패했습니다", data: null });
  }
});

app.get("/categories/search", async (req, res) => {
  const { query, size } = req.query;
  if (!query) {
    return res.status(400).json({ ok: false, message: "쿼리 매개변수가 필요합니다", data: null });
  } else if (!size || isNaN(size) || size <= 0) {
    return res
      .status(400)
      .json({ ok: false, message: "크기(size)는 필수이며 양수여야 합니다", data: null });
  }
  try {
    const result = await chzzk.searchCategory(query, size);
    const categories = result?.content?.data ?? [];
    const gameCategories = categories.filter((category) => category.categoryType === "GAME");
    res.json({ ok: true, message: null, data: gameCategories.length > 0 ? gameCategories : null });
  } catch (error) {
    console.error("카테고리 검색 중 오류:", error);
    res.status(500).json({ ok: false, message: "카테고리 검색에 실패했습니다", data: null });
  }
});

app.get("/game/info", async (req, res) => {
  const { categoryId } = req.query;
  if (!categoryId) {
    return res.status(400).json({ ok: false, message: "categoryId 매개변수가 필요합니다", data: null });
  }
  try {
    const infoRes = await axios.get(
      `https://api.chzzk.naver.com/service/v1/categories/GAME/${categoryId}/info`
    );
    res.json({ ok: true, message: null, data: infoRes.data?.content || null });
  } catch (error) {
    console.error("카테고리 정보 가져오기 중 오류:", error);
    res.status(500).json({ ok: false, message: "카테고리 정보를 가져오는 데 실패했습니다", data: null });
  }
});

app.get("/lounge/info", async (req, res) => {
  const { loungeId } = req.query;
  if (!loungeId) {
    return res.status(400).json({ ok: false, message: "loungeId 매개변수가 필요합니다", data: null });
  }
  try {
    const loungeRes = await axios.get(
      `https://comm-api.game.naver.com/nng_main/v1/lounge/info/${loungeId}`
    );
    res.json({ ok: true, message: null, data: loungeRes.data?.content || null });
  } catch (error) {
    console.error("라운지 정보 가져오기 중 오류:", error);
    res.status(500).json({ ok: false, message: "라운지 정보를 가져오는 데 실패했습니다", data: null });
  }
});

app.get("/game/sites", async (req, res) => {
  const { gameId } = req.query;
  if (!gameId) {
    return res.status(400).json({ ok: false, message: "gameId 매개변수가 필요합니다", data: null });
  }
  try {
    const siteRes = await axios.get(
      `https://comm-api.game.naver.com/nng_main/v1/game/site/download/${gameId}`
    );
    res.json({ ok: true, message: null, data: siteRes.data?.content?.sites || [] });
  } catch (error) {
    console.error("게임 사이트 가져오기 중 오류:", error);
    res.status(500).json({ ok: false, message: "게임 사이트를 가져오는 데 실패했습니다", data: null });
  }
});

module.exports = app;
