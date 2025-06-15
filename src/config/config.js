const path = require("path");

module.exports = {
  tokenStorage: process.env.TOKEN_STORAGE || "json", // 'json' 또는 'mongodb'
  mongoUri: process.env.MONGODB_URI || "",
  tokenJsonPath: path.resolve(__dirname, "token.json"),
};
