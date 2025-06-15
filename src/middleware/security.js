const expressBasicAuth = require("express-basic-auth");

const createErrorResponse = (message) => ({
  ok: false,
  message,
  data: null,
});

const normalizeIP = (ip) => {
  // IPv6 형식의 localhost를 IPv4 형식으로 변환
  if (ip === "::1" || ip === "::ffff:127.0.0.1") {
    return "127.0.0.1";
  }
  return ip;
};

const ipValidator = (req, res, next) => {
  const clientIP = normalizeIP(req.ip || req.connection.remoteAddress);
  const clientDomain = req.hostname;

  // localhost는 무조건 허용
  if (clientIP === "127.0.0.1" || clientDomain === "localhost") {
    return next();
  }

  if (!process.env.ALLOWED_IPS) {
    console.error("환경 변수 ALLOWED_IPS가 설정되지 않았습니다.");
    return res.status(500).json(createErrorResponse("Internal Server Error"));
  }

  const ALLOWED_IPS = process.env.ALLOWED_IPS.split(",").filter((ip) => ip.trim());

  if (ALLOWED_IPS.length === 0) {
    console.error("ALLOWED_IPS에 유효한 IP가 없습니다.");
    return res.status(500).json(createErrorResponse("Internal Server Error"));
  }

  if (ALLOWED_IPS.includes(clientIP) || ALLOWED_IPS.includes(clientDomain)) {
    return next();
  }

  req.notAllowed = true;
  next();
};

const domainValidator = (req, res, next) => {
  if (!req.notAllowed) {
    return next();
  }

  const clientIP = normalizeIP(req.ip || req.connection.remoteAddress);
  const clientDomain = req.hostname;

  // localhost는 무조건 허용
  if (clientIP === "127.0.0.1" || clientDomain === "localhost") {
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

  const userAgent = req.headers["user-agent"];
  if (!userAgent) {
    console.error("User-Agent가 없습니다.");
    return res.status(400).json(createErrorResponse("Bad Request"));
  }

  console.error(
    `접근 거부: IP(${clientIP}), 도메인(${clientDomain}), User-Agent(${userAgent})가 모두 허용되지 않았습니다.`
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
