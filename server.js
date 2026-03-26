require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "mysecret123";

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN in .env");
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const sessions = {};

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

app.post("/chat/send", async (req, res) => {
  try {
    const { sessionId, text } = req.body;

    if (!sessionId || !text) {
      return res.status(400).json({
        ok: false,
        error: "Missing sessionId or text"
      });
    }

    if (!sessions[sessionId]) {
      sessions[sessionId] = { messages: [] };
    }

    sessions[sessionId].messages.push({
      from: "customer",
      text
    });

    if (ADMIN_CHAT_ID) {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: ADMIN_CHAT_ID,
          text: `💬 New message\nSession: ${sessionId}\n\n${text}\n\nReply:\n/reply ${sessionId} your message`
        })
      });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/chat/messages", (req, res) => {
  const { sessionId } = req.query;
  const messages = sessions[sessionId]?.messages || [];
  res.json({ ok: true, messages });
});

app.post(`/telegram/webhook/${WEBHOOK_SECRET}`, (req, res) => {
  try {
    const message = req.body.message;

    if (message && message.text) {
      const text = message.text;

      if (text.startsWith("/reply ")) {
        const parts = text.split(" ");
        const sessionId = parts[1];
        const replyText = parts.slice(2).join(" ");

        if (!sessions[sessionId]) {
          sessions[sessionId] = { messages: [] };
        }

        sessions[sessionId].messages.push({
          from: "admin",
          text: replyText
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});