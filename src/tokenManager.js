const fs = require("fs");
const { MongoClient } = require("mongodb");
const config = require("./config/config");

const mongoOptions = {
  maxPoolSize: 50,
  minPoolSize: 10,
  maxIdleTimeMS: 60000,
  waitQueueTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 5000,
  retryWrites: true,
  retryReads: true,
  w: "majority",
  wtimeoutMS: 5000,
};

async function loadToken() {
  if (config.tokenStorage === "json") {
    if (!fs.existsSync(config.tokenJsonPath)) return null;
    const data = fs.readFileSync(config.tokenJsonPath, "utf-8");
    return JSON.parse(data);
  } else if (config.tokenStorage === "mongodb") {
    const client = new MongoClient(config.mongoUri, mongoOptions);
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
    const client = new MongoClient(config.mongoUri, mongoOptions);
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
