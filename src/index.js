console.clear();

require("dotenv").config();
const express = require("express");
const Chzzk = require("./chzzk");
const axiosForWebhook = require("axios");
const compression = require("compression");
const timeout = require("connect-timeout");
const axios = require("axios");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const { param, query, validationResult } = require("express-validator");
const { ipValidator, domainValidator, corsOptions, basicAuth } = require("./middleware/security");

const port = 3000;
const app = express();
module.exports = app;

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Chzzk API Wrapper",
      version: "1.0.0",
      description: "치지직 API 래퍼 서비스",
    },
    servers: [
      {
        url: "https://ludus-api.shatter.seishun.work",
        description: "운영 서버",
      },
      {
        url: `http://localhost:${port}`,
        description: "개발 서버",
      },
    ],
  },
  apis: ["./src/index.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Swagger UI 정적 파일 제공
app.use("/swagger-ui", express.static("dist/swagger-ui"));

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

/**
 * @swagger
 * /:
 *   get:
 *     summary: 서버 상태 확인
 *     description: 서버가 정상적으로 동작하는지 확인합니다.
 *     responses:
 *       200:
 *         description: 서버가 정상 동작 중입니다.
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: Hello, world!
 */
app.get("/", (req, res) => {
  res.json("Hello, world!");
});

/**
 * @swagger
 * /auth/login:
 *   get:
 *     summary: 치지직 로그인
 *     description: 치지직 로그인 페이지로 리다이렉트합니다.
 *     responses:
 *       302:
 *         description: 치지직 로그인 페이지로 리다이렉트됩니다.
 */
app.get("/auth/login", (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  const authUrl = chzzk.getAuthorizationCodeUrl(CHZZK_REDIRECT_URI, state);
  res.redirect(authUrl);
});

/**
 * @swagger
 * /auth/callback:
 *   get:
 *     summary: 치지직 로그인 콜백
 *     description: 치지직 로그인 후 콜백을 처리합니다.
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         required: true
 *         description: 인증 코드
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         required: true
 *         description: 상태 값
 *     responses:
 *       200:
 *         description: 로그인 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       400:
 *         description: 로그인 실패
 *       500:
 *         description: 서버 오류
 */
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

/**
 * @swagger
 * /me:
 *   get:
 *     summary: 사용자 정보 조회
 *     description: 현재 로그인한 사용자의 정보를 조회합니다.
 *     security:
 *       - basicAuth: []
 *     responses:
 *       200:
 *         description: 사용자 정보 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       401:
 *         description: 인증 실패
 *       500:
 *         description: 서버 오류
 */
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

/**
 * @swagger
 * /game/search:
 *   get:
 *     summary: 게임 카테고리 검색
 *     description: 게임 카테고리를 검색합니다.
 *     parameters:
 *       - in: query
 *         name: categoryName
 *         schema:
 *           type: string
 *         required: true
 *         description: 검색할 카테고리 이름
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *         required: true
 *         description: 검색 결과 크기
 *     responses:
 *       200:
 *         description: 검색 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */
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

/**
 * @swagger
 * /game/info/{categoryId}:
 *   get:
 *     summary: 게임 카테고리 정보 조회
 *     description: 특정 게임 카테고리의 상세 정보를 조회합니다.
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         schema:
 *           type: string
 *         required: true
 *         description: 카테고리 ID
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       404:
 *         description: 카테고리를 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
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

/**
 * @swagger
 * /lounge/info/{loungeId}:
 *   get:
 *     summary: 라운지 정보 조회
 *     description: 특정 라운지의 상세 정보를 조회합니다.
 *     parameters:
 *       - in: path
 *         name: loungeId
 *         schema:
 *           type: string
 *         required: true
 *         description: 라운지 ID
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       404:
 *         description: 라운지를 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
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

/**
 * @swagger
 * /game/sites/{gameId}:
 *   get:
 *     summary: 게임 사이트 정보 조회
 *     description: 특정 게임의 관련 사이트 정보를 조회합니다.
 *     parameters:
 *       - in: path
 *         name: gameId
 *         schema:
 *           type: string
 *         required: true
 *         description: 게임 ID
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: 서버 오류
 */
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

/**
 * @swagger
 * /game/auto_complete:
 *   get:
 *     summary: 게임 자동완성 검색
 *     description: 게임 이름으로 자동완성 검색을 수행합니다.
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         required: true
 *         description: 검색어
 *     responses:
 *       200:
 *         description: 검색 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       id:
 *                         type: string
 *       500:
 *         description: 서버 오류
 */
app.get(
  "/game/auto_complete",
  [query("query").notEmpty().withMessage("검색어(query)가 필요합니다."), validate],
  async (req, res) => {
    const { query } = req.query;
    try {
      const result = await chzzk.searchCategory(query, 10);
      const categories = result?.content?.data ?? [];
      const gameCategories = categories.filter((category) => category.categoryType === "GAME");
      res.json({
        ok: true,
        message: null,
        data: gameCategories.map((category) => ({
          name: category.categoryName,
          id: category.categoryId,
        })),
      });
    } catch (error) {
      console.error("게임 자동완성 검색 중 오류:", error);
      res.status(500).json({ ok: false, message: "게임 검색에 실패했습니다.", data: null });
    }
  }
);

/**
 * @swagger
 * /game/find/{categoryName}:
 *   get:
 *     summary: 카테고리 검색
 *     description: 카테고리 이름으로 정확한 매칭 검색을 수행합니다.
 *     parameters:
 *       - in: path
 *         name: categoryName
 *         schema:
 *           type: string
 *         required: true
 *         description: 카테고리 이름
 *     responses:
 *       200:
 *         description: 검색 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       404:
 *         description: 카테고리를 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
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

/**
 * @swagger
 * /game/googleplay/{packageName}:
 *   get:
 *     summary: Google Play 정보 조회
 *     description: Google Play 스토어의 앱 정보를 조회합니다.
 *     parameters:
 *       - in: path
 *         name: packageName
 *         schema:
 *           type: string
 *         required: true
 *         description: 패키지 이름
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       500:
 *         description: 서버 오류
 */
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

/**
 * @swagger
 * /game/detail/{categoryId}:
 *   get:
 *     summary: 게임 상세 정보 조회
 *     description: 게임의 모든 상세 정보를 조회합니다.
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         schema:
 *           type: string
 *         required: true
 *         description: 카테고리 ID
 *     responses:
 *       200:
 *         description: 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       404:
 *         description: 카테고리를 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
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
