console.clear();

require("dotenv").config();
const express = require("express");
const Chzzk = require("./chzzk");
const axiosForWebhook = require("axios");
const compression = require("compression");
const timeout = require("connect-timeout");
const axios = require("axios");
const cors = require("cors");
const { param, query, validationResult } = require("express-validator");
const { ipValidator, domainValidator, corsOptions, basicAuth } = require("./middleware/security");

const port = 3000;
const app = express();
module.exports = app;

app.use(cors(corsOptions));
app.use(ipValidator);
app.use(domainValidator);

app.use(timeout("10s"));
app.use(compression());
app.disable("x-powered-by");
app.use(express.json({ strict: true }));
app.use(express.urlencoded({ extended: true }));

app.use(["/auth/login", "/me"], basicAuth);

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
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

app.use((req, res, next) => {
  if (req.path === "/favicon.ico" || req.path === "/favicon.png") {
    res.status(204).end();
    return;
  }
  next();
});

app.get("/", (req, res) => {
  res.json("Hello, world!");
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
      res
        .status(400)
        .json({ ok: false, message: "액세스 토큰을 가져오는 데 실패했습니다.", data: null });
    }
  } catch (error) {
    console.error("토큰 발급 중 오류:", error);
    res.status(500).json({ ok: false, message: "토큰 발급에 실패했습니다.", data: null });
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
    res.status(500).json({ ok: false, message: "사용자 정보를 가져오는 데 실패했습니다.", data: null });
  }
});

// 유효성 검사 결과를 처리하는 미들웨어
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      ok: false,
      message: "입력값이 올바르지 않습니다.",
      data: errors.array(),
    });
  }
  next();
};

app.get(
  "/game/search",
  [
    query("categoryName").notEmpty().withMessage("카테고리 이름이 필요합니다."),
    query("size").isInt({ min: 1, max: 50 }).withMessage("크기(size)는 필수이며 양수여야 합니다."),
    validate,
  ],
  async (req, res) => {
    const { categoryName, size } = req.query;
    try {
      const result = await chzzk.searchCategory(query, size);
      const categories = result?.content?.data ?? [];
      const gameCategories = categories.filter((category) => category.categoryType === "GAME");
      res.json({ ok: true, message: null, data: gameCategories.length > 0 ? gameCategories : null });
    } catch (error) {
      console.error("카테고리 검색 중 오류:", error);
      res.status(500).json({ ok: false, message: "카테고리 검색에 실패했습니다.", data: null });
    }
  }
);

app.get(
  "/game/info/:categoryId",
  [param("categoryId").notEmpty().withMessage("categoryId가 필요합니다."), validate],
  async (req, res) => {
    const { categoryId } = req.params;
    try {
      const result = await chzzk.getCategoryInfo(categoryId);
      const categoryInfo = result?.content || null;
      if (!categoryInfo) {
        return res.status(404).json({ ok: false, message: "카테고리를 찾을 수 없습니다.", data: null });
      }
      res.json({
        ok: true,
        message: null,
        data: {
          categoryId: categoryInfo.categoryId,
          categoryValue: categoryInfo.categoryValue,
          posterImageUrl: categoryInfo.posterImageUrl,
          tags: categoryInfo.tags || [],
          existLounge: categoryInfo.existLounge,
        },
      });
    } catch (error) {
      console.error("카테고리 정보 가져오기 중 오류:", error);
      res
        .status(500)
        .json({ ok: false, message: "카테고리 정보를 가져오는 데 실패했습니다.", data: null });
    }
  }
);

app.get(
  "/lounge/info/:loungeId",
  [param("loungeId").notEmpty().withMessage("loungeId가 필요합니다."), validate],
  async (req, res) => {
    const { loungeId } = req.params;
    try {
      const result = await chzzk.getLoungeInfo(loungeId);
      const loungeInfo = result?.content || null;
      if (!loungeInfo) {
        return res.status(404).json({ ok: false, message: "라운지를 찾을 수 없습니다.", data: null });
      }
      res.json({
        ok: true,
        message: null,
        data: {
          originalLoungeId: loungeInfo.originalLoungeId,
          loungeId: loungeInfo.loungeId,
          gameId: loungeInfo.gameId,
          loungeName: loungeInfo.loungeName,
          loungeEnglishName: loungeInfo.loungeEnglishName,
          officialLounge: loungeInfo.officialLounge,
          backgroundImageUrl: loungeInfo.backgroundImageUrl,
          backgroundMobileImageUrl: loungeInfo.backgroundMobileImageUrl,
          logoImageSquareUrl: loungeInfo.logoImageSquareUrl,
          pcBgColor: loungeInfo.pcBgColor,
          mobileBgColor: loungeInfo.mobileBgColor,
          genrePlatforms: loungeInfo.genrePlatforms,
          topBgColor: loungeInfo.topBgColor,
        },
      });
    } catch (error) {
      console.error("라운지 정보 가져오기 중 오류:", error);
      res
        .status(500)
        .json({ ok: false, message: "라운지 정보를 가져오는 데 실패했습니다.", data: null });
    }
  }
);

app.get(
  "/game/sites/:gameId",
  [param("gameId").notEmpty().withMessage("gameId가 필요합니다."), validate],
  async (req, res) => {
    const { gameId } = req.params;
    try {
      const result = await chzzk.getGameSites(gameId);
      const sites = result?.sites || [];
      res.json({ ok: true, message: null, data: sites });
    } catch (error) {
      console.error("게임 사이트 가져오기 중 오류:", error);
      res
        .status(500)
        .json({ ok: false, message: "게임 사이트를 가져오는 데 실패했습니다.", data: null });
    }
  }
);

app.get(
  "/game/auto_complete",
  [query("query").notEmpty().withMessage("검색어(query)가 필요합니다."), validate],
  async (req, res) => {
    const { query } = req.query;
    try {
      const result = await chzzk.searchCategory(query, 10);
      const categories = result?.content?.data ?? [];
      const gameCategories = categories.filter((category) => category.categoryType === "GAME");
      res.json({ ok: true, message: null, data: gameCategories.length > 0 ? gameCategories : null });
    } catch (error) {
      console.error("게임 자동완성 검색 중 오류:", error);
      res.status(500).json({ ok: false, message: "게임 검색에 실패했습니다.", data: null });
    }
  }
);

app.get(
  "/game/find/:categoryName",
  [param("categoryName").notEmpty().withMessage("카테고리 이름이 필요합니다."), validate],
  async (req, res) => {
    const { categoryName } = req.params;
    try {
      const result = await chzzk.findCategory(categoryName);
      if (!result) {
        return res.status(404).json({ ok: false, message: "카테고리를 찾을 수 없습니다.", data: null });
      }
      res.json({
        ok: true,
        message: null,
        data: {
          categoryId: result.categoryId,
          categoryValue: result.categoryValue,
          posterImageUrl: result.posterImageUrl,
          tags: result.tags || [],
          existLounge: result.existLounge,
        },
      });
    } catch (error) {
      console.error("카테고리 검색 중 오류:", error);
      res.status(500).json({ ok: false, message: "카테고리 검색에 실패했습니다.", data: null });
    }
  }
);

app.get(
  "/game/googleplay/:packageName",
  [param("packageName").notEmpty().withMessage("packageName이 필요합니다."), validate],
  async (req, res) => {
    const { packageName } = req.params;
    try {
      const response = await axios.post(
        "https://www.mobileindex.com/api/app/market_info",
        { packageName },
        {
          headers: {
            "secret-key": "hihauyu",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8;",
            Origin: "https://www.mobileindex.com",
          },
        }
      );

      const data = response.data;
      res.json({
        ok: true,
        message: null,
        data: {
          package_name: data.package_name,
          apple_id: data.apple_id,
          description: data.description,
          market_info: data.data?.market_info,
          screenshot: data.data?.screenshot,
          google_rating: data.data?.google_rating,
        },
      });
    } catch (error) {
      console.error("Google Play 정보 가져오기 중 오류:", error);
      res.status(500).json({
        ok: false,
        message: "Google Play 정보를 가져오는 데 실패했습니다.",
        data: null,
      });
    }
  }
);

app.get(
  "/game/detail/:categoryId",
  [param("categoryId").notEmpty().withMessage("categoryId가 필요합니다."), validate],
  async (req, res) => {
    const { categoryId } = req.params;
    try {
      // 1. 카테고리 기본 정보 가져오기
      const categoryResult = await chzzk.getCategoryInfo(categoryId);
      const categoryInfo = categoryResult?.content || null;

      if (!categoryInfo) {
        return res.status(404).json({ ok: false, message: "카테고리를 찾을 수 없습니다.", data: null });
      }

      const response = {
        categoryId: categoryInfo.categoryId,
        categoryValue: categoryInfo.categoryValue,
        posterImageUrl: categoryInfo.posterImageUrl,
        tags: categoryInfo.tags || [],
        naverLounge: null,
        gameSites: null,
      };

      // 2. 라운지 정보가 있는 경우 가져오기
      if (categoryInfo.existLounge) {
        const loungeResult = await chzzk.getLoungeInfo(categoryId);
        const loungeInfo = loungeResult?.content || null;

        if (loungeInfo) {
          response.naverLounge = {
            originalLoungeId: loungeInfo.originalLoungeId,
            loungeId: loungeInfo.loungeId,
            gameId: loungeInfo.gameId,
            loungeName: loungeInfo.loungeName,
            loungeEnglishName: loungeInfo.loungeEnglishName,
            officialLounge: loungeInfo.officialLounge,
            backgroundImageUrl: loungeInfo.backgroundImageUrl,
            backgroundMobileImageUrl: loungeInfo.backgroundMobileImageUrl,
            logoImageSquareUrl: loungeInfo.logoImageSquareUrl,
            pcBgColor: loungeInfo.pcBgColor,
            mobileBgColor: loungeInfo.mobileBgColor,
            genrePlatforms: loungeInfo.genrePlatforms,
            topBgColor: loungeInfo.topBgColor,
          };

          // 3. 게임 ID가 있는 경우 게임 사이트 정보 가져오기
          if (loungeInfo.gameId) {
            const gameSitesResult = await chzzk.getGameSites(loungeInfo.gameId);
            response.gameSites = gameSitesResult?.content?.sites || [];

            // Google Play 정보 가져오기
            const googlePlaySite = response.gameSites.find((site) => site.type === "google");
            if (googlePlaySite) {
              const packageName = googlePlaySite.siteUrl.match(/id=([^&]+)/)?.[1];
              if (packageName) {
                try {
                  const googlePlayResponse = await axios.post(
                    "https://www.mobileindex.com/api/app/market_info",
                    { packageName },
                    {
                      headers: {
                        "secret-key": "hihauyu",
                        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8;",
                        Origin: "https://www.mobileindex.com",
                      },
                    }
                  );
                  response.googlePlay = {
                    package_name: googlePlayResponse.data.package_name,
                    apple_id: googlePlayResponse.data.apple_id,
                    description: googlePlayResponse.data.description,
                    market_info: googlePlayResponse.data.data?.market_info,
                    screenshot: googlePlayResponse.data.data?.screenshot,
                    google_rating: googlePlayResponse.data.data?.google_rating,
                  };
                } catch (error) {
                  console.error("Google Play 정보 가져오기 중 오류:", error);
                  response.googlePlay = null;
                }
              }
            }
          }
        }
      }

      res.json({ ok: true, message: null, data: response });
    } catch (error) {
      console.error("카테고리 상세 정보 가져오기 중 오류:", error);
      res.status(500).json({
        ok: false,
        message: "카테고리 상세 정보를 가져오는 데 실패했습니다.",
        data: null,
      });
    }
  }
);

// 404 에러 핸들러
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: "요청하신 페이지를 찾을 수 없습니다.",
    data: null,
  });
});
