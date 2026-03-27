const today = new Date().toLocaleDateString('en-CA', {
  timeZone: 'Australia/Perth'
});

const urlParams = new URLSearchParams(window.location.search);
const dateParam = urlParams.get('date');
const selectedDate = dateParam || today;
const correctDayShareMessage = 'I just proved that I am a true friend of Grizz!';
const incorrectDayShareMessage = 'I am a not a true friend of Grizz.';

const authState = {
  token: localStorage.getItem('authToken') || '',
  username: localStorage.getItem('authUsername') || '',
  answersByDate: null
};

function getApiBaseUrl() {
  const metaApiBase = document
    .querySelector('meta[name="grizzdle-api-base-url"]')
    ?.getAttribute('content')
    ?.trim();

  if (metaApiBase) {
    return metaApiBase.replace(/\/$/, '');
  }

  const configured = window.localStorage.getItem('apiBaseUrl');
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  const { protocol, hostname, port, origin } = window.location;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocalHost && protocol.startsWith('http') && port !== '3000') {
    return `${protocol}//${hostname}:3000`;
  }

  return origin;
}

const apiBaseUrl = getApiBaseUrl();

function toSafeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function getLocalCounts() {
  return {
    correctCount: toSafeCount(localStorage.getItem('correctCount')),
    incorrectCount: toSafeCount(localStorage.getItem('incorrectCount'))
  };
}

function updateCountDisplay(correctCount, incorrectCount) {
  const correctEl = document.getElementById('correctCount');
  const incorrectEl = document.getElementById('incorrectCount');

  if (correctEl) {
    correctEl.textContent = String(correctCount);
  }

  if (incorrectEl) {
    incorrectEl.textContent = String(incorrectCount);
  }
}

function setLocalCounts(correctCount, incorrectCount) {
  localStorage.setItem('correctCount', String(correctCount));
  localStorage.setItem('incorrectCount', String(incorrectCount));
  updateCountDisplay(correctCount, incorrectCount);
}

function setAuthSession(token, username) {
  authState.token = token;
  authState.username = username;
  authState.answersByDate = null;
  localStorage.setItem('authToken', token);
  localStorage.setItem('authUsername', username);
}

function clearAuthSession() {
  authState.token = '';
  authState.username = '';
  authState.answersByDate = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUsername');
}

function sanitizeAnswersByDate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const cleaned = {};
  Object.entries(value).forEach(([date, choice]) => {
    if (typeof date !== 'string' || typeof choice !== 'string') {
      return;
    }

    const safeDate = date.trim();
    const safeChoice = choice.trim();
    if (!safeDate || !safeChoice) {
      return;
    }

    cleaned[safeDate] = safeChoice;
  });

  return cleaned;
}

function getGuestAnswers() {
  const parsed = JSON.parse(localStorage.getItem('answers')) || {};
  return sanitizeAnswersByDate(parsed);
}

function setGuestAnswers(answersByDate) {
  localStorage.setItem('answers', JSON.stringify(sanitizeAnswersByDate(answersByDate)));
}

async function syncAnswersFromServer(force = false) {
  if (!authState.token) {
    return getGuestAnswers();
  }

  if (!force && authState.answersByDate) {
    return authState.answersByDate;
  }

  try {
    const payload = await apiRequest('/api/answers');
    authState.answersByDate = sanitizeAnswersByDate(payload.answersByDate);
    return authState.answersByDate;
  } catch (error) {
    // Backward compatibility: if server hasn't been restarted with /api/answers yet,
    // keep gameplay usable by falling back to device-local answers.
    if (error.status === 404) {
      const guestAnswers = getGuestAnswers();
      authState.answersByDate = guestAnswers;
      return guestAnswers;
    }

    throw error;
  }
}

async function persistAnswerByDate(date, choice) {
  if (!authState.token) {
    const guestAnswers = getGuestAnswers();
    guestAnswers[date] = choice;
    setGuestAnswers(guestAnswers);
    return guestAnswers;
  }

  const payload = await apiRequest('/api/answers', 'POST', {
    date,
    choice
  });

  authState.answersByDate = sanitizeAnswersByDate(payload.answersByDate);
  return authState.answersByDate;
}

async function mergeGuestAnswersIntoAccount() {
  if (!authState.token) {
    return {
      mergedDays: 0,
      addedCorrect: 0,
      addedIncorrect: 0
    };
  }

  const guestAnswers = getGuestAnswers();
  const serverAnswers = sanitizeAnswersByDate(await syncAnswersFromServer(true));
  const missingEntries = Object.entries(guestAnswers).filter(([date]) => !serverAnswers[date]);
  let addedCorrect = 0;
  let addedIncorrect = 0;

  for (const [date, choice] of missingEntries) {
    await persistAnswerByDate(date, choice);

    try {
      const response = await fetch(`./data/${date}.json`);
      if (!response.ok) {
        continue;
      }

      const dayData = await response.json();
      if (choice === dayData.answer) {
        addedCorrect += 1;
      } else {
        addedIncorrect += 1;
      }
    } catch {
      // Skip count updates for dates where question data cannot be loaded.
    }
  }

  return {
    mergedDays: missingEntries.length,
    addedCorrect,
    addedIncorrect
  };
}

async function apiRequest(path, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (authState.token) {
    headers.Authorization = `Bearer ${authState.token}`;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    let message = payload?.error || `Request failed with status ${response.status}`;
    if (response.status === 405) {
      message = 'API endpoint is not accepting this method. If testing locally, start the Node app with "npm start" and open http://localhost:3000.';
    }

    const err = new Error(message);
    err.status = response.status;
    err.apiUrl = `${apiBaseUrl}${path}`;
    err.method = method;
    throw err;
  }

  return payload;
}

function setAuthStatus(message) {
  const status = document.getElementById('auth-status');
  if (status) {
    status.textContent = message;
  }
}

function refreshAuthControls() {
  const registerBtn = document.getElementById('register-button');
  const loginBtn = document.getElementById('login-button');
  const logoutBtn = document.getElementById('logout-button');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const isLoggedIn = Boolean(authState.token);

  if (registerBtn) {
    registerBtn.disabled = isLoggedIn;
  }

  if (loginBtn) {
    loginBtn.disabled = isLoggedIn;
  }

  if (logoutBtn) {
    logoutBtn.classList.toggle('hidden', !isLoggedIn);
  }

  if (usernameInput) {
    usernameInput.disabled = isLoggedIn;
    if (isLoggedIn) {
      usernameInput.value = authState.username;
    }
  }

  if (passwordInput) {
    passwordInput.disabled = isLoggedIn;
    if (isLoggedIn) {
      passwordInput.value = '';
    }
  }

  if (isLoggedIn) {
    setAuthStatus(`Logged in as ${authState.username}. Progress now syncs across devices.`);
  } else {
    setAuthStatus('Not logged in. Progress saves on this device only.');
  }
}

async function syncCountsFromServer() {
  if (!authState.token) {
    const local = getLocalCounts();
    updateCountDisplay(local.correctCount, local.incorrectCount);
    return local;
  }

  const stats = await apiRequest('/api/stats');
  const correctCount = toSafeCount(stats.correctCount);
  const incorrectCount = toSafeCount(stats.incorrectCount);
  setLocalCounts(correctCount, incorrectCount);
  return { correctCount, incorrectCount };
}

async function persistCounts(correctCount, incorrectCount) {
  setLocalCounts(correctCount, incorrectCount);

  if (!authState.token) {
    return;
  }

  try {
    const stats = await apiRequest('/api/stats', 'POST', {
      correctCount,
      incorrectCount
    });

    setLocalCounts(toSafeCount(stats.correctCount), toSafeCount(stats.incorrectCount));
  } catch (error) {
    if (error.status === 401) {
      clearAuthSession();
      refreshAuthControls();
      showToast('Session expired. Please log in again.');
      return;
    }

    showToast('Could not sync score right now. Local save still works.');
  }
}

function normalizeCredentialValue(value) {
  return (value || '').trim();
}

function wireAuthHandlers() {
  const registerBtn = document.getElementById('register-button');
  const loginBtn = document.getElementById('login-button');
  const logoutBtn = document.getElementById('logout-button');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');

  if (!registerBtn || !loginBtn || !logoutBtn || !usernameInput || !passwordInput) {
    return;
  }

  registerBtn.onclick = async () => {
    const username = normalizeCredentialValue(usernameInput.value);
    const password = normalizeCredentialValue(passwordInput.value);

    if (!username || !password) {
      showToast('Username and password are required.');
      return;
    }

    const localCounts = getLocalCounts();
    const guestAnswers = getGuestAnswers();

    try {
      const payload = await apiRequest('/api/register', 'POST', {
        username,
        password,
        correctCount: localCounts.correctCount,
        incorrectCount: localCounts.incorrectCount,
        answersByDate: guestAnswers
      });

      setAuthSession(payload.token, payload.username);
      authState.answersByDate = sanitizeAnswersByDate(payload.answersByDate);
      setLocalCounts(toSafeCount(payload.correctCount), toSafeCount(payload.incorrectCount));
      refreshAuthControls();
      showToast('Account created. Your local score has been saved to your account.');
      await loadData(selectedDate);
    } catch (error) {
      showToast(error.message || 'Unable to register.');
    }
  };

  loginBtn.onclick = async () => {
    const username = normalizeCredentialValue(usernameInput.value);
    const password = normalizeCredentialValue(passwordInput.value);

    if (!username || !password) {
      showToast('Username and password are required.');
      return;
    }

    try {
      const payload = await apiRequest('/api/login', 'POST', {
        username,
        password
      });

      setAuthSession(payload.token, payload.username);
      const mergeSummary = await mergeGuestAnswersIntoAccount();

      const baseCorrect = toSafeCount(payload.correctCount);
      const baseIncorrect = toSafeCount(payload.incorrectCount);
      const mergedCorrect = baseCorrect + mergeSummary.addedCorrect;
      const mergedIncorrect = baseIncorrect + mergeSummary.addedIncorrect;

      await persistCounts(mergedCorrect, mergedIncorrect);
      refreshAuthControls();
      showToast('Logged in. Progress now syncs across devices.');
      if (mergeSummary.mergedDays > 0) {
        showToast(`Added ${mergeSummary.mergedDays} local day${mergeSummary.mergedDays === 1 ? '' : 's'} to this account.`);
      }
      await loadData(selectedDate);
    } catch (error) {
      showToast(error.message || 'Unable to log in.');
    }
  };

  logoutBtn.onclick = async () => {
    try {
      await apiRequest('/api/logout', 'POST');
    } catch {
      // Logout should still complete on client even if request fails.
    }

    clearAuthSession();
    refreshAuthControls();
    showToast('Logged out.');
    await loadData(selectedDate);
  };

  refreshAuthControls();
}

async function loadData(date) {
  const questionEl = document.getElementById('question');
  const choicesDiv = document.getElementById('options');
  const resultEl = document.getElementById('result');

  if (!questionEl || !choicesDiv || !resultEl) {
    return;
  }

  let data;
  try {
    const response = await fetch(`./data/${date}.json`);
    if (!response.ok) {
      throw new Error('Question file not found.');
    }

    data = await response.json();
  } catch {
    questionEl.textContent = "Oops, Grizz forgot to add today's question!";
    resultEl.textContent = 'Please berate him on discord to fix this issue!';
    choicesDiv.innerHTML = '';

    const shareContainer = document.getElementById('share-container');
    if (shareContainer) {
      shareContainer.classList.add('hidden');
    }

    return;
  }

  let savedAnswers = {};
  let correctCount = 0;
  let incorrectCount = 0;

  try {
    savedAnswers = authState.token
      ? sanitizeAnswersByDate(await syncAnswersFromServer())
      : getGuestAnswers();

    const currentCounts = await syncCountsFromServer();
    correctCount = currentCounts.correctCount;
    incorrectCount = currentCounts.incorrectCount;
  } catch (error) {
    if (error.status === 401) {
      clearAuthSession();
      refreshAuthControls();
      showToast('Session expired. Please log in again.');
      savedAnswers = getGuestAnswers();
      const local = getLocalCounts();
      correctCount = local.correctCount;
      incorrectCount = local.incorrectCount;
      updateCountDisplay(correctCount, incorrectCount);
    } else {
      showToast(error.message || 'Could not sync account data right now.');
      savedAnswers = getGuestAnswers();
      const local = getLocalCounts();
      correctCount = local.correctCount;
      incorrectCount = local.incorrectCount;
      updateCountDisplay(correctCount, incorrectCount);
    }
  }

  questionEl.textContent = data.question;
  choicesDiv.innerHTML = '';
  resultEl.textContent = '';

  const shareContainer = document.getElementById('share-container');
  if (shareContainer) {
    shareContainer.classList.add('hidden');
  }

  data.options.forEach((choice) => {
    const button = document.createElement('button');
    button.textContent = choice;
    button.classList.add('option-button');

    if (savedAnswers[date]) {
      button.disabled = true;
      button.classList.add('disabled');

      if (choice === savedAnswers[date]) {
        if (choice === data.answer) {
          resultEl.textContent = 'Correct!';
          button.classList.add('correct');
        } else {
          resultEl.textContent = `Wrong! The correct answer was: ${data.answer}`;
          button.classList.add('wrong');
        }

        setupShareButton(date, data, savedAnswers[date], correctCount, incorrectCount);
      }
    }

    button.onclick = async () => {
      if (savedAnswers[date]) {
        return;
      }

      try {
        await persistAnswerByDate(date, choice);
        savedAnswers[date] = choice;
      } catch (error) {
        if (error.status === 401) {
          clearAuthSession();
          refreshAuthControls();
        }

        showToast(error.message || 'Could not save your answer. Try again.');
        return;
      }

      if (choice === data.answer) {
        resultEl.textContent = 'Correct!';
        button.classList.add('correct');
        correctCount += 1;
      } else {
        resultEl.textContent = `Wrong! The correct answer was: ${data.answer}`;
        button.classList.add('wrong');
        incorrectCount += 1;
      }

      await persistCounts(correctCount, incorrectCount);
      updateCountDisplay(correctCount, incorrectCount);

      document.querySelectorAll('#options button').forEach((optionButton) => {
        optionButton.disabled = true;
        optionButton.classList.add('disabled');
      });

      setupShareButton(date, data, savedAnswers[date], correctCount, incorrectCount);
    };

    choicesDiv.appendChild(button);
  });
}

function getShareMessage(date, data, selectedChoice, correctCount, incorrectCount) {
  const wasCorrect = selectedChoice === data.answer;
  const dayResultText = wasCorrect ? '✅' : '❌';
  const customShareMessage = wasCorrect ? correctDayShareMessage : incorrectDayShareMessage;

  return [
    `https://www.grizzdle.com/ ${date}`,
    dayResultText,
    customShareMessage,
    `Overall: ${correctCount} correct | ${incorrectCount} incorrect`
  ].join('\n');
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  toast.addEventListener('animationend', () => toast.remove());
}

function setupShareButton(date, data, selectedChoice, correctCount, incorrectCount) {
  const shareContainer = document.getElementById('share-container');
  const shareButton = document.getElementById('share-button');

  if (!shareContainer || !shareButton || !selectedChoice) {
    return;
  }

  const shareText = getShareMessage(date, data, selectedChoice, correctCount, incorrectCount);
  shareContainer.classList.remove('hidden');

  shareButton.onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      showToast('Copied to clipboard!');
    } catch {
      showToast('Unable to copy result.');
    }
  };
}

function loadArchive() {
  fetch('dates.json')
    .then((res) => res.json())
    .then((dates) => {
      const archiveList = document.getElementById('archive-list');
      if (!archiveList) {
        return;
      }

      const availableDates = dates
        .filter((date) => date <= today)
        .sort((a, b) => b.localeCompare(a));

      availableDates.forEach((date) => {
        const link = document.createElement('a');
        link.href = `index.html?date=${date}`;
        link.textContent = new Date(date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        archiveList.appendChild(link);
      });
    })
    .catch(() => {
      const archiveList = document.getElementById('archive-list');
      if (archiveList) {
        archiveList.innerHTML = '<p>Unable to load archive dates.</p>';
      }
    });
}

async function initializeApp() {
  if (window.location.pathname.endsWith('archive.html')) {
    loadArchive();
    return;
  }

  wireAuthHandlers();

  if (authState.token) {
    try {
      await syncCountsFromServer();
      refreshAuthControls();
    } catch {
      clearAuthSession();
      refreshAuthControls();
      showToast('Session expired. Please log in again.');
    }
  } else {
    const local = getLocalCounts();
    updateCountDisplay(local.correctCount, local.incorrectCount);
  }

  await loadData(selectedDate);
}

initializeApp();