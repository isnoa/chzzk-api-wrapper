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
const swaggerJSDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const swaggerDist = require("swagger-ui-dist");

const port = 3000;
const app = express();
module.exports = app;

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "치지직 API 래퍼",
    version: "1.0.0",
    description:
      "치지직 API를 중점으로 모바일인덱스, 구글 플레이의 정보를 래핑한 REST API 서비스입니다.",
  },
  servers: [
    {
      url: "https://ludus-api.shatter.seishun.work",
      description: "프로덕션 서버",
    },
    {
      url: `http://localhost:${port}`,
      description: "로컬 서버",
    },
  ],
};

const options = {
  swaggerDefinition,
  apis: ["./src/index.js"],
};

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerJSDoc(options), {
    customCssUrl: "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.8/swagger-ui.css",
  })
);

app.use("/swagger-ui", express.static(swaggerDist.getAbsoluteFSPath()));

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
 *     description: "서버가 정상적으로 동작하는지 확인합니다."
 *     responses:
 *       200:
 *         description: "서버가 정상 동작 중입니다."
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
 *     description: "치지직 로그인 페이지로 리다이렉트합니다. 본 서비스는 로그인 없이 사용 가능하지만, 일부 기능(예: 내 정보 조회)은 로그인이 필요합니다."
 *     responses:
 *       302:
 *         description: "치지직 로그인 페이지로 리다이렉트됩니다."
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
 *     description: "치지직 로그인 후 콜백을 처리합니다. 로그인 완료 후 이 API가 호출됩니다."
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         required: true
 *         description: "인증 코드"
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         required: true
 *         description: "상태 값"
 *     responses:
 *       200:
 *         description: "로그인 성공. API 서비스를 사용할 수 있습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   nullable: true
 *                   example: null
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
 *       400:
 *         description: "로그인 실패. 인증 코드 또는 상태 값이 올바르지 않습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "액세스 토큰을 가져오는 데 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
 *       500:
 *         description: "서버 오류. 토큰 발급 중 예상치 못한 오류가 발생했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "토큰 발급에 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
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
 *     description: "현재 로그인한 사용자의 정보를 조회합니다. `basicAuth` 인증이 필요합니다."
 *     security:
 *       - basicAuth: []
 *     responses:
 *       200:
 *         description: "사용자 정보 조회 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   nullable: true
 *                   example: null
 *                 data:
 *                   type: object
 *                   example: { "userId": "test1234", "nickname": "테스트사용자" }
 *       401:
 *         description: "인증 실패. 액세스 토큰이 없거나 유효하지 않습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "액세스 토큰이 누락되었습니다. 인증을 다시 진행하세요."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
 *       500:
 *         description: "서버 오류. 사용자 정보를 가져오는 중 예상치 못한 오류가 발생했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "사용자 정보를 가져오는 데 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
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
 *     description: "게임 카테고리를 검색합니다. 검색어와 결과 크기를 지정할 수 있습니다."
 *     parameters:
 *       - in: query
 *         name: categoryName
 *         schema:
 *           type: string
 *         required: true
 *         description: "검색할 카테고리 이름"
 *         example: "명일방주: 엔드필드"
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *         required: true
 *         description: "검색 결과 크기 (1-50)"
 *         example: 10
 *     responses:
 *       200:
 *         description: "검색 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   nullable: true
 *                   example: null
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       categoryId:
 *                         type: string
 *                         example: "12345"
 *                       categoryName:
 *                         type: string
 *                         example: "명일방주: 엔드필드"
 *                       categoryType:
 *                         type: string
 *                         example: "GAME"
 *                       posterImageUrl:
 *                         type: string
 *                         example: "https://example.com/lol.jpg"
 *       400:
 *         description: "잘못된 요청. 필수 파라미터가 누락되었거나 형식이 올바르지 않습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "입력값이 올바르지 않습니다."
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: "서버 오류. 카테고리 검색 중 예상치 못한 오류가 발생했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "카테고리 검색에 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
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
 *     description: "특정 게임 카테고리의 상세 정보를 조회합니다."
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         schema:
 *           type: string
 *         required: true
 *         description: "카테고리 ID"
 *         example: "12345"
 *     responses:
 *       200:
 *         description: "조회 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   nullable: true
 *                   example: null
 *                 data:
 *                   type: object
 *                   properties:
 *                     categoryId:
 *                       type: string
 *                       example: "12345"
 *                     categoryValue:
 *                       type: string
 *                       example: "League of Legends"
 *                     posterImageUrl:
 *                       type: string
 *                       example: "https://example.com/lol_poster.jpg"
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["MOBA", "Team Strategy"]
 *                     existLounge:
 *                       type: boolean
 *                       example: true
 *       404:
 *         description: "카테고리를 찾을 수 없음. 제공된 categoryId에 해당하는 카테고리가 존재하지 않습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "카테고리를 찾을 수 없습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
 *       500:
 *         description: "서버 오류. 카테고리 정보를 가져오는 중 예상치 못한 오류가 발생했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "카테고리 정보를 가져오는 데 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
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
 *     description: "특정 라운지의 상세 정보를 조회합니다."
 *     parameters:
 *       - in: path
 *         name: loungeId
 *         schema:
 *           type: string
 *         required: true
 *         description: "라운지 ID"
 *         example: "lounge_id_example"
 *     responses:
 *       200:
 *         description: "조회 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   nullable: true
 *                   example: null
 *                 data:
 *                   type: object
 *                   properties:
 *                     originalLoungeId:
 *                       type: string
 *                       example: "original_lounge_id_example"
 *                     loungeId:
 *                       type: string
 *                       example: "lounge_id_example"
 *                     gameId:
 *                       type: string
 *                       example: "game_id_example"
 *                     loungeName:
 *                       type: string
 *                       example: "게임 라운지"
 *                     loungeEnglishName:
 *                       type: string
 *                       example: "Game Lounge"
 *                     officialLounge:
 *                       type: boolean
 *                       example: true
 *                     backgroundImageUrl:
 *                       type: string
 *                       example: "https://example.com/bg.jpg"
 *                     backgroundMobileImageUrl:
 *                       type: string
 *                       example: "https://example.com/mobile_bg.jpg"
 *                     logoImageSquareUrl:
 *                       type: string
 *                       example: "https://example.com/logo.jpg"
 *                     pcBgColor:
 *                       type: string
 *                       example: "#FFFFFF"
 *                     mobileBgColor:
 *                       type: string
 *                       example: "#F0F0F0"
 *                     genrePlatforms:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["PC", "Mobile"]
 *                     topBgColor:
 *                       type: string
 *                       example: "#AAAAAA"
 *       404:
 *         description: "라운지를 찾을 수 없음. 제공된 loungeId에 해당하는 라운지가 존재하지 않습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "라운지를 찾을 수 없습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
 *       500:
 *         description: "서버 오류. 라운지 정보를 가져오는 중 예상치 못한 오류가 발생했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "라운지 정보를 가져오는 데 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
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
 *     description: "특정 게임의 관련 사이트 정보를 조회합니다. 게임 ID를 사용하여 게임 관련 외부 링크를 가져옵니다."
 *     parameters:
 *       - in: path
 *         name: gameId
 *         schema:
 *           type: string
 *         required: true
 *         description: "게임 ID"
 *         example: "game_id_example"
 *     responses:
 *       200:
 *         description: "조회 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   nullable: true
 *                   example: null
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                         example: "officalSite"
 *                       siteUrl:
 *                         type: string
 *                         example: "https://example.com"
 *                       title:
 *                         type: string
 *                         example: "공식 웹사이트"
 *       500:
 *         description: "서버 오류. 게임 사이트 정보를 가져오는 중 예상치 못한 오류가 발생했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "게임 사이트를 가져오는 데 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
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
 *     description: "게임 이름으로 자동완성 검색을 수행합니다. 입력된 쿼리와 일치하는 게임 카테고리를 반환합니다."
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         required: true
 *         description: "검색어"
 *         example: "스타크래프트"
 *     responses:
 *       200:
 *         description: "검색 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   nullable: true
 *                   example: null
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                         example: "스타크래프트: 리마스터"
 *                       id:
 *                         type: string
 *                         example: "98765"
 *       500:
 *         description: "서버 오류. 게임 자동완성 검색 중 예상치 못한 오류가 발생했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "게임 검색에 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
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
      res.json({ ok: true, message: null, data: gameCategories.length > 0 ? gameCategories : null });
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
 *     summary: 카테고리 검색 (정확한 매칭)
 *     description: "카테고리 이름으로 정확한 매칭 검색을 수행합니다. 제공된 이름과 정확히 일치하는 게임 카테고리를 반환합니다."
 *     parameters:
 *       - in: path
 *         name: categoryName
 *         schema:
 *           type: string
 *         required: true
 *         description: "카테고리 이름"
 *         example: "명일방주: 엔드필드"
 *     responses:
 *       200:
 *         description: "검색 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   nullable: true
 *                   example: null
 *                 data:
 *                   type: object
 *                   properties:
 *                     categoryId:
 *                       type: string
 *                       example: "12345"
 *                     categoryValue:
 *                       type: string
 *                       example: "League of Legends"
 *                     posterImageUrl:
 *                       type: string
 *                       example: "https://example.com/lol_poster.jpg"
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["MOBA"]
 *                     existLounge:
 *                       type: boolean
 *                       example: true
 *       404:
 *         description: "카테고리를 찾을 수 없음. 제공된 categoryName에 해당하는 카테고리가 존재하지 않습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "카테고리를 찾을 수 없습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
 *       500:
 *         description: "서버 오류. 카테고리 검색 중 예상치 못한 오류가 발생했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "카테고리 검색에 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
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
 *     description: "Google Play 스토어의 앱 정보를 조회합니다. 패키지 이름을 사용하여 앱의 상세 정보, 스크린샷, 평점 등을 가져옵니다."
 *     parameters:
 *       - in: path
 *         name: packageName
 *         schema:
 *           type: string
 *         required: true
 *         description: "패키지 이름"
 *         example: "com.some.game"
 *     responses:
 *       200:
 *         description: "조회 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   nullable: true
 *                   example: null
 *                 data:
 *                   type: object
 *                   properties:
 *                     package_name:
 *                       type: string
 *                       example: "com.some.game"
 *                     apple_id:
 *                       type: string
 *                       example: "123456789"
 *                     description:
 *                       type: string
 *                       example: "이것은 게임 설명입니다."
 *                     market_info:
 *                       type: object
 *                       example: { "genre": "RPG" }
 *                     screenshot:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["https://example.com/ss1.jpg"]
 *                     google_rating:
 *                       type: object
 *                       example: { "score": 4.5, "count": 1000 }
 *       500:
 *         description: "서버 오류. Google Play 정보를 가져오는 중 예상치 못한 오류가 발생했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Google Play 정보를 가져오는 데 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
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
 *     description: "게임의 모든 상세 정보를 조회합니다. 카테고리 정보, 라운지 정보, 게임 사이트, Google Play 정보 등을 포함합니다."
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         schema:
 *           type: string
 *         required: true
 *         description: "카테고리 ID"
 *         example: "12345"
 *     responses:
 *       200:
 *         description: "조회 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   nullable: true
 *                   example: null
 *                 data:
 *                   type: object
 *                   properties:
 *                     categoryId:
 *                       type: string
 *                       example: "12345"
 *                     categoryValue:
 *                       type: string
 *                       example: "League of Legends"
 *                     posterImageUrl:
 *                       type: string
 *                       example: "https://example.com/lol_poster.jpg"
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["MOBA"]
 *                     naverLounge:
 *                       type: object
 *                       nullable: true
 *                       example: { "loungeId": "lounge_id_example" }
 *                     gameSites:
 *                       type: array
 *                       items:
 *                         type: object
 *                       nullable: true
 *                       example: [{ "type": "officalSite" }]
 *                     googlePlay:
 *                       type: object
 *                       nullable: true
 *                       example: { "package_name": "com.some.game" }
 *       404:
 *         description: "카테고리를 찾을 수 없음. 제공된 categoryId에 해당하는 카테고리가 존재하지 않습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "카테고리를 찾을 수 없습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
 *       500:
 *         description: "서버 오류. 게임 상세 정보를 가져오는 중 예상치 못한 오류가 발생했습니다."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "카테고리 상세 정보를 가져오는 데 실패했습니다."
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   example: null
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
