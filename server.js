const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const USERS_PATH = path.join(__dirname, 'users.json');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const sessions = new Map();
const defaultAllowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://grizzdle.com',
  'https://www.grizzdle.com'
];

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || defaultAllowedOrigins.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function sanitizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function sanitizeAnswersByDate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const cleaned = {};
  for (const [date, choice] of Object.entries(value)) {
    if (typeof date !== 'string' || typeof choice !== 'string') {
      continue;
    }

    const normalizedDate = date.trim();
    const normalizedChoice = choice.trim();
    if (!normalizedDate || !normalizedChoice) {
      continue;
    }

    cleaned[normalizedDate] = normalizedChoice;
  }

  return cleaned;
}

async function loadQuestionByDate(date) {
  const questionPath = path.join(__dirname, 'data', `${date}.json`);

  try {
    const raw = await fs.readFile(questionPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function deriveCountsFromAnswers(answersByDate) {
  const normalizedAnswers = sanitizeAnswersByDate(answersByDate);
  let correctCount = 0;
  let incorrectCount = 0;

  const entries = Object.entries(normalizedAnswers);
  for (const [date, selectedChoice] of entries) {
    const question = await loadQuestionByDate(date);
    if (!question || typeof question.answer !== 'string') {
      continue;
    }

    if (selectedChoice === question.answer) {
      correctCount += 1;
    } else {
      incorrectCount += 1;
    }
  }

  return {
    correctCount,
    incorrectCount
  };
}

async function hydrateUserCounts(user) {
  const answersByDate = sanitizeAnswersByDate(user.answersByDate);
  const derivedCounts = await deriveCountsFromAnswers(answersByDate);

  const previousAnswers = sanitizeAnswersByDate(user.answersByDate);
  const previousCorrect = sanitizeCount(user.correctCount);
  const previousIncorrect = sanitizeCount(user.incorrectCount);

  const answersChanged = JSON.stringify(previousAnswers) !== JSON.stringify(answersByDate);
  const countsChanged = previousCorrect !== derivedCounts.correctCount || previousIncorrect !== derivedCounts.incorrectCount;

  user.answersByDate = answersByDate;
  user.correctCount = derivedCounts.correctCount;
  user.incorrectCount = derivedCounts.incorrectCount;

  return {
    user,
    changed: answersChanged || countsChanged
  };
}

async function readUsers() {
  try {
    const raw = await fs.readFile(USERS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function writeUsers(users) {
  await fs.writeFile(USERS_PATH, JSON.stringify(users, null, 2), 'utf8');
}

function getTokenFromHeader(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return '';
  }

  return authHeader.slice('Bearer '.length).trim();
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    username,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

function authRequired(req, res, next) {
  const token = getTokenFromHeader(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token.' });
  }

  const session = sessions.get(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session.' });
  }

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Session expired.' });
  }

  req.auth = {
    token,
    username: session.username
  };

  return next();
}

app.post('/api/register', async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    const answersByDate = sanitizeAnswersByDate(req.body?.answersByDate);

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    if (username.length > 32) {
      return res.status(400).json({ error: 'Username must be 32 characters or less.' });
    }

    if (password.length < 3) {
      return res.status(400).json({ error: 'Password must be at least 3 characters.' });
    }

    const users = await readUsers();
    const existing = users.find((user) => user.username === username);
    if (existing) {
      return res.status(409).json({ error: 'Username already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const derivedCounts = await deriveCountsFromAnswers(answersByDate);
    const newUser = {
      username,
      passwordHash,
      correctCount: derivedCounts.correctCount,
      incorrectCount: derivedCounts.incorrectCount,
      answersByDate
    };

    users.push(newUser);
    await writeUsers(users);

    const token = createSession(username);
    return res.status(201).json({
      token,
      username,
      correctCount: newUser.correctCount,
      incorrectCount: newUser.incorrectCount,
      answersByDate
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Unable to register right now.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const users = await readUsers();
    const user = users.find((entry) => entry.username === username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const hydration = await hydrateUserCounts(user);
    if (hydration.changed) {
      await writeUsers(users);
    }

    const token = createSession(username);
    return res.json({
      token,
      username,
      correctCount: user.correctCount,
      incorrectCount: user.incorrectCount,
      answersByDate: sanitizeAnswersByDate(user.answersByDate)
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to log in right now.' });
  }
});

app.post('/api/logout', authRequired, (req, res) => {
  sessions.delete(req.auth.token);
  return res.json({ ok: true });
});

app.get('/api/stats', authRequired, async (req, res) => {
  try {
    const users = await readUsers();
    const user = users.find((entry) => entry.username === req.auth.username);
    if (!user) {
      sessions.delete(req.auth.token);
      return res.status(401).json({ error: 'Session user does not exist.' });
    }

    const hydration = await hydrateUserCounts(user);
    if (hydration.changed) {
      await writeUsers(users);
    }

    return res.json({
      username: user.username,
      correctCount: user.correctCount,
      incorrectCount: user.incorrectCount
    });
  } catch (error) {
    console.error('Stats read error:', error);
    return res.status(500).json({ error: 'Unable to load stats right now.' });
  }
});

app.post('/api/stats', authRequired, async (req, res) => {
  try {
    const users = await readUsers();
    const userIndex = users.findIndex((entry) => entry.username === req.auth.username);
    if (userIndex === -1) {
      sessions.delete(req.auth.token);
      return res.status(401).json({ error: 'Session user does not exist.' });
    }

    const hydration = await hydrateUserCounts(users[userIndex]);
    if (hydration.changed) {
      await writeUsers(users);
    }

    return res.json({
      username: users[userIndex].username,
      correctCount: users[userIndex].correctCount,
      incorrectCount: users[userIndex].incorrectCount
    });
  } catch (error) {
    console.error('Stats write error:', error);
    return res.status(500).json({ error: 'Unable to save stats right now.' });
  }
});

app.get('/api/answers', authRequired, async (req, res) => {
  try {
    const users = await readUsers();
    const user = users.find((entry) => entry.username === req.auth.username);
    if (!user) {
      sessions.delete(req.auth.token);
      return res.status(401).json({ error: 'Session user does not exist.' });
    }

    const hydration = await hydrateUserCounts(user);
    if (hydration.changed) {
      await writeUsers(users);
    }

    const answersByDate = sanitizeAnswersByDate(user.answersByDate);
    return res.json({
      username: user.username,
      answersByDate
    });
  } catch (error) {
    console.error('Answers read error:', error);
    return res.status(500).json({ error: 'Unable to load answers right now.' });
  }
});

app.post('/api/answers', authRequired, async (req, res) => {
  try {
    const date = String(req.body?.date || '').trim();
    const choice = String(req.body?.choice || '').trim();

    if (!date || !choice) {
      return res.status(400).json({ error: 'Date and choice are required.' });
    }

    const users = await readUsers();
    const userIndex = users.findIndex((entry) => entry.username === req.auth.username);
    if (userIndex === -1) {
      sessions.delete(req.auth.token);
      return res.status(401).json({ error: 'Session user does not exist.' });
    }

    const answersByDate = sanitizeAnswersByDate(users[userIndex].answersByDate);
    answersByDate[date] = choice;
    users[userIndex].answersByDate = answersByDate;
    await hydrateUserCounts(users[userIndex]);
    await writeUsers(users);

    return res.json({
      username: users[userIndex].username,
      answersByDate,
      correctCount: users[userIndex].correctCount,
      incorrectCount: users[userIndex].incorrectCount
    });
  } catch (error) {
    console.error('Answers write error:', error);
    return res.status(500).json({ error: 'Unable to save answer right now.' });
  }
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Grizzdle server running on http://localhost:${PORT}`);
});
