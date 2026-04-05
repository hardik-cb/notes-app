require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Redis = require("ioredis");
const path = require("path");

const app = express();
app.use(express.json({ limit: "50mb" })); // Since contenteditable can have base64 images
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const redis = new Redis(process.env.REDIS_URL, {
  tls: {
    rejectUnauthorized: false
  }
});

redis.on("error", (err) => console.error("Redis error:", err));
redis.on("connect", () => console.log("Connected to Upstash Redis"));

const TTL_30_DAYS = 30 * 24 * 60 * 60; // 30 days in seconds

// Helper to get merged data for a user
async function getUserFullData(username) {
  const loginKey = `login:${username}`;
  const dataKey = `data:${username}`;
  
  const [loginStr, dataStr] = await Promise.all([
    redis.get(loginKey),
    redis.get(dataKey)
  ]);
  
  let loginObj = loginStr ? JSON.parse(loginStr) : {};
  let dataObj = dataStr ? JSON.parse(dataStr) : { content: "", hash: "", activeTab: null };
  
  return { ...loginObj, ...dataObj };
}

// POST /api/login: Auth and fetch merged data
app.post("/api/login", async (req, res) => {
  const { username, passwordHash } = req.body;
  if (!username || !passwordHash) {
    return res.status(400).json({ error: "username and passwordHash required" });
  }

  try {
    const loginKey = `login:${username}`;
    let loginStr = await redis.get(loginKey);
    
    const metadata = {
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip,
      headers: req.headers,
      timestamp: new Date().toISOString()
    };

    if (loginStr) {
      let loginObj = JSON.parse(loginStr);
      if (loginObj.passwordHash !== passwordHash) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      // Remove legacy fields for separation if data already existed
      delete loginObj.content;
      delete loginObj.hash;
      delete loginObj.activeTab;
      
      // Update login metadata
      loginObj.metadata = metadata;
      await redis.set(loginKey, JSON.stringify(loginObj), "EX", TTL_30_DAYS);
      
      // Fetch separate editor data
      const dataKey = `data:${username}`;
      const dataStr = await redis.get(dataKey);
      const dataObj = dataStr ? JSON.parse(dataStr) : { content: "", hash: "", activeTab: null };
      if (dataStr) await redis.expire(dataKey, TTL_30_DAYS);
      
      return res.json({ success: true, ...loginObj, ...dataObj });
      
    } else {
      // Create user
      const newUserObj = { passwordHash, metadata, profilePhoto: null };
      await redis.set(loginKey, JSON.stringify(newUserObj), "EX", TTL_30_DAYS);
      return res.json({ success: true, ...newUserObj, content: "", hash: "", activeTab: null });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/hash/:userId: Fetch just the editor data hash
app.get("/api/hash/:userId", async (req, res) => {
  try {
    const dataKey = `data:${req.params.userId}`;
    const dataStr = await redis.get(dataKey);
    if (!dataStr) return res.json({ hash: "" });
    const { hash } = JSON.parse(dataStr);
    res.json({ hash: hash || "" });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch hash" });
  }
});

// GET /api/data/:userId: Fetch editor data explicitly
app.get("/api/data/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const dataKey = `data:${userId}`;
    const loginKey = `login:${userId}`;
    const [dataStr, loginStr] = await Promise.all([
      redis.get(dataKey),
      redis.get(loginKey)
    ]);

    let dataObj = dataStr ? JSON.parse(dataStr) : { content: "", hash: "", activeTab: null };
    let loginObj = loginStr ? JSON.parse(loginStr) : { profilePhoto: null };

    if (dataStr) await redis.expire(dataKey, TTL_30_DAYS);
    if (loginStr) await redis.expire(loginKey, TTL_30_DAYS);

    // Merge profile photo into response for automatic UI sync
    res.json({ ...dataObj, profilePhoto: loginObj.profilePhoto });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// POST /api/data/:userId: Save editor data
app.post("/api/data/:userId", async (req, res) => {
  const { userId } = req.params;
  const { content, hash, activeTab } = req.body;

  if (typeof content !== "string" || typeof hash !== "string") {
    return res.status(400).json({ error: "content and hash must be strings" });
  }

  try {
    const dataKey = `data:${userId}`;
    console.log(`[${new Date().toISOString()}] Saving EDITOR DATA to: ${dataKey}`);
    const dataObj = { content, hash, activeTab };
    await redis.set(dataKey, JSON.stringify(dataObj), "EX", TTL_30_DAYS);
    res.json({ success: true, message: "Editor content saved" });
  } catch (err) {
    res.status(500).json({ error: "Failed to save data" });
  }
});

// GET /api/profile/:userId: Fetch profile metadata
app.get("/api/profile/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const loginKey = `login:${userId}`;
    const loginStr = await redis.get(loginKey);
    if (!loginStr) return res.status(404).json({ error: "User not found" });
    
    const loginObj = JSON.parse(loginStr);
    res.json({ profilePhoto: loginObj.profilePhoto || null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// POST /api/profile/:userId: Save profile photo
app.post("/api/profile/:userId", async (req, res) => {
  const { userId } = req.params;
  const { profilePhoto } = req.body;

  try {
    const loginKey = `login:${userId}`;
    const loginStr = await redis.get(loginKey);
    if (!loginStr) return res.status(404).json({ error: "User not found" });

    let loginObj = JSON.parse(loginStr);
    
    // Ensure legacy fields are stripped
    delete loginObj.content;
    delete loginObj.hash;
    delete loginObj.activeTab;

    loginObj.profilePhoto = profilePhoto;
    console.log(`[${new Date().toISOString()}] Saving PROFILE DATA to: ${loginKey}`);
    await redis.set(loginKey, JSON.stringify(loginObj), "EX", TTL_30_DAYS);
    res.json({ success: true, message: "Profile photo saved" });
  } catch (err) {
    res.status(500).json({ error: "Failed to save profile" });
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
