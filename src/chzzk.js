const axios = require("axios");
const tokenManager = require("./tokenManager");

const BASE_URL = "https://openapi.chzzk.naver.com";
const AUTH_URL = "https://chzzk.naver.com/account-interlock";

function parseDuration(duration) {
  if (typeof duration === "number") return duration;
  const match = /^(\d+)(ms|s|m|h)?$/.exec(duration);
  if (!match)
    throw new Error(`Invalid duration format: "${duration}". Expected formats: "15m", "10s", etc.`);
  const value = parseInt(match[1], 10);
  const unit = match[2] || "ms";
  const unitMap = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  if (!unitMap[unit]) throw new Error(`Unknown duration unit: "${unit}". Use "ms", "s", "m", or "h".`);
  return value * unitMap[unit];
}

class Chzzk {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.clientId - Client ID for authentication
   * @param {string} options.clientSecret - Client Secret for authentication
   * @param {boolean} [options.autoRefreshToken=true] - Automatically refresh token when expired
   * @param {string|number} [options.tokenRefreshThresholdMs="15m"] - Threshold for token refresh in milliseconds or duration string (e.g., "15m")
   * @param {boolean} [options.tokenReissueLogger=false] - Log token reissue events
   */
  constructor({
    clientId,
    clientSecret,
    autoRefreshToken = true,
    tokenRefreshThresholdMs = "15m",
    tokenReissueLogger = false,
  }) {
    if (!clientId || !clientSecret) throw new Error("clientId and clientSecret are required.");
    if (tokenRefreshThresholdMs && !autoRefreshToken) {
      throw new Error("autoRefreshToken must be true to set tokenRefreshThresholdMs.");
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.autoRefreshToken = autoRefreshToken;
    this.tokenRefreshThresholdMs = parseDuration(tokenRefreshThresholdMs);
    this.tokenReissueLogger = tokenReissueLogger;

    this.http = axios.create({
      baseURL: BASE_URL,
      headers: { "Content-Type": "application/json" },
    });

    const RETRY_FLAG = Symbol("axiosRetry");

    this.http.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && this.autoRefreshToken && !originalRequest[RETRY_FLAG]) {
          originalRequest[RETRY_FLAG] = true;
          try {
            await this.refreshAccessToken();
            originalRequest.headers["Authorization"] = `Bearer ${this.accessToken}`;
            return this.http(originalRequest);
          } catch (refreshError) {
            return Promise.reject(refreshError);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async init() {
    await this._loadTokens();
    if (this.refreshToken) {
      this.refreshAccessToken().catch((error) => {
        console.error("Failed to issue access token during initialization:", error.message);
      });
    }
  }

  async _loadTokens() {
    const tokens = await tokenManager.loadToken();
    if (tokens) {
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      this.expiresIn = tokens.expiresIn;
      this.tokenType = tokens.tokenType;
      this.scope = tokens.scope;
    }
  }

  async _saveTokens(tokens) {
    if (tokens.scope) {
      let scopes = tokens.scope.split(", ").join(" ").split(" ");
      scopes = scopes.map((scope, index) => {
        if (scope === "조회" && index !== scopes.length - 1) {
          return "조회,";
        }
        return scope;
      });
      tokens.scope = scopes.join(" ");
    }
    await tokenManager.saveToken(tokens);
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.expiresIn = tokens.expiresIn;
    this.tokenType = tokens.tokenType;
    this.scope = tokens.scope ? tokens.scope.split(" ").join(", ") : tokens.scope;
  }

  async _checkAndRefreshToken() {
    if (!this.autoRefreshToken || !this.accessToken || !this.expiresIn) return;

    let modifiedTime = 0;
    if (process.env.TOKEN_STORAGE === "mongodb") {
      modifiedTime = Date.now() - (this.expiresIn * 1000 - this.tokenRefreshThresholdMs - 1000);
    } else {
      // json 파일 방식
      const config = require("./config/config");
      if (require("fs").existsSync(config.tokenJsonPath)) {
        const tokenStat = require("fs").statSync(config.tokenJsonPath);
        modifiedTime = tokenStat.mtimeMs;
      }
    }
    const now = Date.now();
    const expiresAt = modifiedTime + this.expiresIn * 1000;
    if (expiresAt - now < this.tokenRefreshThresholdMs) {
      await this.refreshAccessToken();
    }
  }

  getAuthorizationCodeUrl(redirectUri, state) {
    const params = new URLSearchParams({ clientId: this.clientId, redirectUri, state });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async issueAccessTokenByCode(code, state) {
    const tokens = await this._authTokenRequest({
      grantType: "authorization_code",
      code,
      state,
    });
    await this._saveTokens(tokens.content);
    return tokens.content;
  }

  async refreshAccessToken() {
    if (!this.refreshToken) throw new Error("refreshToken is missing.");
    const tokens = await this._authTokenRequest({
      grantType: "refresh_token",
      refreshToken: this.refreshToken,
    });
    await this._saveTokens(tokens.content);
    if (this.tokenReissueLogger) {
      console.log(`[${new Date().toLocaleString()}] Access token reissued due to expiration.`);
    }
    return tokens.content;
  }

  async revokeToken(token, tokenTypeHint = "access_token") {
    const res = await this.http.post("/auth/v1/token/revoke", {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      token,
      tokenTypeHint,
    });
    return res.data;
  }

  async _authTokenRequest(body) {
    const res = await this.http.post("/auth/v1/token", {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      ...body,
    });
    return res.data;
  }

  _requireAccessToken() {
    if (!this.accessToken) throw new Error("Access Token is required.");
  }

  _authHeader() {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  _clientHeader() {
    return {
      "Client-Id": this.clientId,
      "Client-Secret": this.clientSecret,
    };
  }

  async getMyUserInfo() {
    await this._checkAndRefreshToken();
    this._requireAccessToken();
    const res = await this.http.get("/open/v1/users/me", { headers: this._authHeader() });
    return res.data;
  }

  async getChannels(channelIds = []) {
    const params = new URLSearchParams();
    channelIds.forEach((id) => params.append("channelIds", id));
    const res = await this.http.get("/open/v1/channels", {
      headers: this._clientHeader(),
      params,
    });
    return res.data;
  }

  async searchCategory(query, size = 20) {
    const params = new URLSearchParams({ query, size });
    const res = await this.http.get("/open/v1/categories/search", {
      headers: this._clientHeader(),
      params,
    });
    return res.data;
  }

  async getLiveList(size = 20, nextCursor = "") {
    const params = new URLSearchParams({ size });
    if (nextCursor) params.append("next", nextCursor);
    const res = await this.http.get("/open/v1/lives", {
      headers: this._clientHeader(),
      params,
    });
    return res.data;
  }

  async getStreamKey() {
    await this._checkAndRefreshToken();
    this._requireAccessToken();
    const res = await this.http.get("/open/v1/streams/key", { headers: this._authHeader() });
    return res.data;
  }

  async getLiveSetting() {
    await this._checkAndRefreshToken();
    this._requireAccessToken();
    const res = await this.http.get("/open/v1/lives/setting", { headers: this._authHeader() });
    return res.data;
  }

  async updateLiveSetting(setting) {
    await this._checkAndRefreshToken();
    this._requireAccessToken();
    const res = await this.http.patch("/open/v1/lives/setting", setting, {
      headers: this._authHeader(),
    });
    return res.data;
  }

  async sendChatMessage(message) {
    await this._checkAndRefreshToken();
    this._requireAccessToken();
    const res = await this.http.post(
      "/open/v1/chats/send",
      { message },
      { headers: this._authHeader() }
    );
    return res.data;
  }

  async setChatNotice(payload) {
    await this._checkAndRefreshToken();
    this._requireAccessToken();
    const res = await this.http.post("/open/v1/chats/notice", payload, { headers: this._authHeader() });
    return res.data;
  }

  async getChatSettings() {
    await this._checkAndRefreshToken();
    this._requireAccessToken();
    const res = await this.http.get("/open/v1/chats/settings", { headers: this._authHeader() });
    return res.data;
  }

  async updateChatSettings(setting) {
    await this._checkAndRefreshToken();
    this._requireAccessToken();
    const res = await this.http.put("/open/v1/chats/settings", setting, { headers: this._authHeader() });
    return res.data;
  }

  async getDropsRewardClaims(filters = {}) {
    const params = new URLSearchParams();
    for (const key in filters) {
      if (filters[key]) {
        const paramKey = key.startsWith("page.") ? key : `page.${key}`;
        params.append(paramKey, filters[key]);
      }
    }
    const res = await this.http.get("/open/v1/drops/reward-claims", {
      headers: this._clientHeader(),
      params,
    });
    return res.data;
  }

  async updateDropsRewardClaims(claimIds, fulfillmentState) {
    const res = await this.http.put(
      "/open/v1/drops/reward-claims",
      {
        claimIds,
        fulfillmentState,
      },
      {
        headers: this._clientHeader(),
      }
    );
    return res.data;
  }
}

module.exports = Chzzk;
