const { MongoClient } = require("mongodb");

if (!process.env.MONGO_URI) {
  throw new Error("MONGO_URI가 설정되지 않았습니다.");
}

const uri = process.env.MONGO_URI;
const options = {
  connectTimeoutMS: 10000,
  socketTimeoutMS: 10000,
  serverSelectionTimeoutMS: 10000,
  maxPoolSize: 10,
  minPoolSize: 0,
  maxIdleTimeMS: 10000,
};

let client;
let clientPromise;

if (process.env.NODE_ENV === "dev") {
  // 개발 환경에서는 전역 변수에 클라이언트를 저장하지 않습니다.
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri, options);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  // 프로덕션 환경에서는 전역 변수에 클라이언트를 저장합니다.
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri, options);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
}

module.exports = clientPromise;
