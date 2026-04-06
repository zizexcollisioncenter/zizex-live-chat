require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { google } = require("googleapis");

const app = express();




const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

function getGoogleAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/business.manage"
    ]
  });
}



app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "mysecret123";

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN in .env");
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// in-memory store
const sessions = {};
const telegramToSessionMap = {};

app.get("/", (req, res) => {
  res.send("Server running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/debug/get-updates", async (req, res) => {
  try {
    const tgRes = await fetch(`${TELEGRAM_API}/getUpdates`);
    const data = await tgRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/debug/send-test", async (req, res) => {
  try {
    if (!ADMIN_CHAT_ID) {
      return res.status(400).json({
        ok: false,
        error: "ADMIN_CHAT_ID is empty"
      });
    }

    const tgRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: "Test message from backend ✅"
      })
    });

    const data = await tgRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// create session
app.post("/chat/start", (req, res) => {
  try {
    const { sessionId, name, phone } = req.body;

    if (!sessionId || !name || !phone) {
      return res.status(400).json({
        ok: false,
        error: "Missing sessionId, name or phone"
      });
    }

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        name,
        phone,
        messages: []
      };
    } else {
      sessions[sessionId].name = name;
      sessions[sessionId].phone = phone;
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 🔵 Start Google Auth
app.get("/auth/google", (req, res) => {
  const url = getGoogleAuthUrl();
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.status(400).send("Missing code");
    }

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log("=== GOOGLE TOKENS ===");
    console.log("REFRESH TOKEN:", tokens.refresh_token);
    console.log("ACCESS TOKEN:", tokens.access_token);

    res.send("Google connected. Check server logs.");
  } catch (err) {
    console.error("Google OAuth error:", err);
    res.status(500).send("OAuth failed");
  }
});
// 🔵 End Google Auth

// send customer message
app.post("/chat/send", async (req, res) => {
  try {
    const { sessionId, text, name, phone } = req.body;

    if (!sessionId || !text) {
      return res.status(400).json({
        ok: false,
        error: "Missing sessionId or text"
      });
    }

    if (!sessions[sessionId]) {
      if (!name || !phone) {
        return res.status(400).json({
          ok: false,
          error: "Missing customer info"
        });
      }

      sessions[sessionId] = {
        name,
        phone,
        messages: []
      };
    }

    if (name) sessions[sessionId].name = name;
    if (phone) sessions[sessionId].phone = phone;

    sessions[sessionId].messages.push({
      from: "customer",
      text
    });

    if (ADMIN_CHAT_ID) {
      const tgRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: ADMIN_CHAT_ID,
          text:
            `💬 ${sessions[sessionId].name || "Customer"}\n` +
            `📞 ${sessions[sessionId].phone || "-"}\n` +
            `🆔 ${sessionId}\n\n` +
            `${text}`
        })
      });

      const data = await tgRes.json();

      if (data.ok && data.result && data.result.message_id) {
        telegramToSessionMap[data.result.message_id] = sessionId;
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// get messages for one user only
app.get("/chat/messages", (req, res) => {
  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({
      ok: false,
      error: "Missing sessionId"
    });
  }

  const messages = sessions[sessionId]?.messages || [];
  res.json({ ok: true, messages });
});

// telegram webhook
app.post(`/telegram/webhook/${WEBHOOK_SECRET}`, (req, res) => {
  try {
    const message = req.body.message;

    if (!message || !message.text) {
      return res.sendStatus(200);
    }

    // only accept your admin chat replies
    if (String(message.chat.id) !== String(ADMIN_CHAT_ID)) {
      return res.sendStatus(200);
    }

    // must be reply to bot message
    if (!message.reply_to_message) {
      return res.sendStatus(200);
    }

    const repliedTelegramMessageId = message.reply_to_message.message_id;
    const sessionId = telegramToSessionMap[repliedTelegramMessageId];

    if (!sessionId) {
      return res.sendStatus(200);
    }

    if (!sessions[sessionId]) {
      return res.sendStatus(200);
    }

    sessions[sessionId].messages.push({
      from: "admin",
      text: message.text
    });

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});