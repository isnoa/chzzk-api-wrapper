const fs = require("fs");
const config = require("./config/config");
const clientPromise = require("./lib/mongodb");

async function loadToken() {
  if (config.tokenStorage === "json") {
    if (!fs.existsSync(config.tokenJsonPath)) return null;
    const data = fs.readFileSync(config.tokenJsonPath, "utf-8");
    return JSON.parse(data);
  } else if (config.tokenStorage === "mongodb") {
    try {
      const client = await clientPromise;
      const db = client.db("chzzk");
      const token = await db.collection("tokens").findOne({ id: "default" });
      return token;
    } catch (error) {
      console.error("MongoDB 연결 오류:", error);
      return null;
    }
  }
  throw new Error("Unknown token storage type");
}

async function saveToken(token) {
  if (config.tokenStorage === "json") {
    fs.writeFileSync(config.tokenJsonPath, JSON.stringify(token, null, 2), "utf-8");
  } else if (config.tokenStorage === "mongodb") {
    try {
      const client = await clientPromise;
      const db = client.db("chzzk");
      await db
        .collection("tokens")
        .updateOne({ id: "default" }, { $set: { ...token, id: "default" } }, { upsert: true });
    } catch (error) {
      console.error("MongoDB 저장 오류:", error);
      throw error;
    }
  } else {
    throw new Error("Unknown token storage type");
  }
}

module.exports = { loadToken, saveToken };
