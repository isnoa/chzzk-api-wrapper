const expressBasicAuth = require("express-basic-auth");

const createErrorResponse = (message) => ({
  ok: false,
  message,
  data: null,
});

const ipValidator = (req, res, next) => {
  if (!process.env.ALLOWED_IPS) {
    console.error("환경 변수 ALLOWED_IPS가 설정되지 않았습니다.");
    return res.status(500).json(createErrorResponse("Internal Server Error"));
  }

  const ALLOWED_IPS = process.env.ALLOWED_IPS.split(",").filter((ip) => ip.trim());

  if (ALLOWED_IPS.length === 0) {
    console.error("ALLOWED_IPS에 유효한 IP가 없습니다.");
    return res.status(500).json(createErrorResponse("Internal Server Error"));
  }

  const clientIP = req.ip || req.connection.remoteAddress;
  if (ALLOWED_IPS.includes(clientIP)) {
    return next();
  }

  // IP가 허용되지 않은 경우, 도메인 검사로 넘어갑니다
  req.ipNotAllowed = true;
  next();
};

const domainValidator = (req, res, next) => {
  // IP가 이미 허용된 경우 바로 통과
  if (!req.ipNotAllowed) {
    return next();
  }

  if (!process.env.ALLOWED_ORIGINS) {
    console.error("환경 변수 ALLOWED_ORIGINS가 설정되지 않았습니다.");
    return res.status(500).json(createErrorResponse("Internal Server Error"));
  }

  const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS.split(",").filter((origin) => origin.trim());

  if (ALLOWED_ORIGINS.length === 0) {
    console.error("ALLOWED_ORIGINS에 유효한 도메인이 없습니다.");
    return res.status(500).json(createErrorResponse("Internal Server Error"));
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // Origin이나 Referer 중 하나라도 허용된 도메인이면 통과
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return next();
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
      if (ALLOWED_ORIGINS.includes(refererOrigin)) {
        return next();
      }
    } catch (error) {
      console.error(`잘못된 Referer URL: ${referer}`);
    }
  }

  // IP도 허용되지 않고 도메인도 허용되지 않은 경우
  const clientIP = req.ip || req.connection.remoteAddress;
  console.error(
    `접근 거부: IP(${clientIP})와 도메인(${origin || referer || "없음"})이 모두 허용되지 않았습니다.`
  );
  return res.status(403).json(createErrorResponse("Forbidden"));
};

const corsOptions = {
  origin: (origin, callback) => {
    if (!process.env.ALLOWED_ORIGINS) {
      return callback(new Error("CORS 설정 오류"));
    }

    const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS.split(",").filter((origin) => origin.trim());

    if (ALLOWED_ORIGINS.length === 0) {
      return callback(new Error("CORS 설정 오류"));
    }

    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Forbidden"));
    }
  },
  methods: ["GET"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

const basicAuth = expressBasicAuth({
  challenge: true,
  users: {
    [process.env.LOGIN_USERNAME]: process.env.LOGIN_PASSWORD,
  },
});

const tokenValidator = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json(createErrorResponse("Unauthorized"));
  }
  next();
};

module.exports = {
  ipValidator,
  domainValidator,
  corsOptions,
  basicAuth,
  tokenValidator,
};
