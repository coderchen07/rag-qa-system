/* eslint-disable no-console */
/**
 * Stress test for /ai/chat/session context compression.
 *
 * Verifies in one run:
 * 1) Long multi-turn chat (15+ rounds) still responds (no token overflow error).
 * 2) Long context preserves early fact recall (indirectly validates compression path works).
 * 3) Short chat stays under threshold baseline and behaves normally.
 *
 * Usage:
 *   node scripts/chat-context-stress-test.cjs
 *
 * Optional env:
 *   API_BASE_URL=http://127.0.0.1:3010
 *   TEST_USERNAME=admin
 *   TEST_PASSWORD=admin123
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:3010";
const TEST_USERNAME = process.env.TEST_USERNAME || "admin";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "admin123";

const LONG_ROUNDS = 16;
const LONG_CHUNK_REPEAT = 220; // intentionally large to exceed context threshold quickly

function estimateTokens(messages) {
  let total = 0;
  for (const message of messages) {
    const role = String(message.role || "");
    const content = String(message.content || "");
    let cjkChars = 0;
    let otherChars = 0;
    for (const ch of content) {
      if (/[\u3400-\u9fff]/.test(ch)) {
        cjkChars += 1;
      } else {
        otherChars += 1;
      }
    }
    total += cjkChars + Math.ceil(otherChars / 4) + Math.ceil(role.length / 4) + 2;
  }
  return total;
}

async function postJson(path, token, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore parse error
  }
  if (!response.ok) {
    const message = (json && json.message) || text || `${response.status}`;
    throw new Error(`POST ${path} failed (${response.status}): ${message}`);
  }
  return json;
}

async function login() {
  const payload = await postJson("/auth/login", null, {
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
  });
  const token = payload && payload.access_token;
  if (!token) {
    throw new Error("Login succeeded but access_token is missing.");
  }
  return token;
}

async function createSession(token, title) {
  const payload = await postJson("/conversation", token, { title });
  const session = payload && payload.data;
  if (!session || !session.id) {
    throw new Error("Create session returned invalid payload.");
  }
  return session.id;
}

async function sendMessageSSE(token, sessionId, content) {
  const response = await fetch(`${API_BASE_URL}/ai/chat/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      sessionId,
      message: { content },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`/ai/chat/session failed (${response.status}): ${text}`);
  }
  if (!response.body) {
    throw new Error("SSE response body is empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistant = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const eventBlock of events) {
      const lines = eventBlock
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const eventName = (lines.find((line) => line.startsWith("event:")) || "")
        .replace("event:", "")
        .trim();
      const data = (lines.find((line) => line.startsWith("data:")) || "")
        .replace("data:", "")
        .trim();
      if (!data) continue;
      if (eventName === "done" || data === "[DONE]") {
        return assistant;
      }
      if (eventName === "error") {
        let message = data;
        try {
          const parsed = JSON.parse(data);
          message = parsed.message || message;
        } catch {
          // ignore json parse error
        }
        throw new Error(`SSE error: ${message}`);
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed.content === "string") {
          if (!parsed.content.startsWith("🔧")) {
            assistant += parsed.content;
          }
        }
      } catch {
        // ignore malformed data
      }
    }
  }

  return assistant;
}

function buildLongMessage(round) {
  const seed =
    "请牢记：我们的项目代号是“蓝鲸-压力测试”，核心目标是验证聊天上下文压缩后仍保持对话连贯。";
  const fillerUnit =
    `第${round}轮扩展说明：本段用于增加上下文长度并模拟真实复杂对话，` +
    "请在理解后继续回答，不要省略关键设定。";
  const filler = new Array(LONG_CHUNK_REPEAT).fill(fillerUnit).join("");
  return `${seed}\n${filler}\n请简短确认你已接收第${round}轮信息。`;
}

async function main() {
  console.log(`API_BASE_URL=${API_BASE_URL}`);
  console.log(`Using account: ${TEST_USERNAME}`);

  const token = await login();
  console.log("1) Login ok");

  // Long conversation stress
  const longSessionId = await createSession(token, "stress-long-context");
  console.log(`2) Long session created: ${longSessionId}`);

  const sentMessages = [];
  let longConversationHadError = false;
  for (let i = 1; i <= LONG_ROUNDS; i += 1) {
    const userMessage = buildLongMessage(i);
    sentMessages.push({ role: "user", content: userMessage });
    process.stdout.write(`   - Round ${i}/${LONG_ROUNDS} sending... `);
    try {
      const reply = await sendMessageSSE(token, longSessionId, userMessage);
      sentMessages.push({ role: "assistant", content: reply });
      console.log(`ok (${reply.length} chars)`);
    } catch (error) {
      longConversationHadError = true;
      console.log("failed");
      console.error(`     ${error.message}`);
      break;
    }
  }

  const estimatedLongTokens = estimateTokens(sentMessages);
  console.log(`   Estimated long context tokens: ${estimatedLongTokens}`);

  let recallAnswer = "";
  if (!longConversationHadError) {
    recallAnswer = await sendMessageSSE(
      token,
      longSessionId,
      "请只用一句话回答：我们最开始约定的项目代号是什么？",
    );
    console.log(`3) Recall answer: ${recallAnswer.slice(0, 200)}`);
  }

  // Short conversation baseline
  const shortSessionId = await createSession(token, "stress-short-context");
  console.log(`4) Short session created: ${shortSessionId}`);
  const shortMessages = [
    "你好",
    "你是谁？",
    "请用一句话介绍你可以帮我做什么。",
  ];
  const shortTrack = [];
  for (const text of shortMessages) {
    shortTrack.push({ role: "user", content: text });
    const reply = await sendMessageSSE(token, shortSessionId, text);
    shortTrack.push({ role: "assistant", content: reply });
  }
  const estimatedShortTokens = estimateTokens(shortTrack);
  console.log(`5) Estimated short context tokens: ${estimatedShortTokens}`);

  const longNoOverflow = !longConversationHadError;
  const shortBelowThreshold = estimatedShortTokens < 4000;
  const recallLooksGood = /蓝鲸-压力测试|蓝鲸/.test(recallAnswer);

  console.log("\n=== RESULT ===");
  console.log(`- Trigger compression scenario (long context > 4000): ${estimatedLongTokens > 4000}`);
  console.log(`- No token overflow error in long chat: ${longNoOverflow}`);
  console.log(`- Early fact recall remains coherent: ${recallLooksGood}`);
  console.log(`- Short chat remains below threshold: ${shortBelowThreshold}`);
  if (longNoOverflow && shortBelowThreshold) {
    console.log("PASS: Stress test completed without token-limit failures.");
  } else {
    console.log("FAIL: Please inspect logs/output above.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FATAL:", error.message);
  process.exit(1);
});
