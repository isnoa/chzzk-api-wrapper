const fs = require("fs");
const { MongoClient } = require("mongodb");
const config = require("./config/config");

async function loadToken() {
  if (config.tokenStorage === "json") {
    if (!fs.existsSync(config.tokenJsonPath)) return null;
    const data = fs.readFileSync(config.tokenJsonPath, "utf-8");
    return JSON.parse(data);
  } else if (config.tokenStorage === "mongodb") {
    const client = new MongoClient(config.mongoUri, {
      connectTimeoutMS: 10000,
      socketTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 0,
    });
    try {
      await client.connect(); 
      const db = client.db("chzzk");
      const token = await db.collection("tokens").findOne({ id: "default" });
      return token;
    } finally {
      await client.close();
    }
  }
  throw new Error("Unknown token storage type");
}

async function saveToken(token) {
  if (config.tokenStorage === "json") {
    fs.writeFileSync(config.tokenJsonPath, JSON.stringify(token, null, 2), "utf-8");
  } else if (config.tokenStorage === "mongodb") {
    const client = new MongoClient(config.mongoUri, {
      connectTimeoutMS: 60000,
      socketTimeoutMS: 60000,
      serverSelectionTimeoutMS: 60000,
    });
    try {
      await client.connect();
      const db = client.db("chzzk");
      await db
        .collection("tokens")
        .updateOne({ id: "default" }, { $set: { ...token, id: "default" } }, { upsert: true });
    } finally {
      await client.close();
    }
  } else {
    throw new Error("Unknown token storage type");
  }
}

module.exports = { loadToken, saveToken };
