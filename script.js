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

  return window.location.origin;
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

async function deriveGuestCountsFromAnswers(answersByDate) {
  const normalizedAnswers = sanitizeAnswersByDate(answersByDate);
  const dates = Object.keys(normalizedAnswers);

  if (dates.length === 0) {
    return {
      correctCount: 0,
      incorrectCount: 0
    };
  }

  const dayResults = await Promise.all(
    dates.map(async (date) => {
      try {
        const response = await fetch(`./data/${date}.json`);
        if (!response.ok) {
          return null;
        }

        const dayData = await response.json();
        if (typeof dayData.answer !== 'string') {
          return null;
        }

        return normalizedAnswers[date] === dayData.answer ? 'correct' : 'incorrect';
      } catch {
        return null;
      }
    })
  );

  let correctCount = 0;
  let incorrectCount = 0;

  dayResults.forEach((result) => {
    if (result === 'correct') {
      correctCount += 1;
    } else if (result === 'incorrect') {
      incorrectCount += 1;
    }
  });

  return {
    correctCount,
    incorrectCount
  };
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
      message = 'API endpoint is not accepting this method right now.';
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
    const guestAnswers = getGuestAnswers();
    const derivedCounts = await deriveGuestCountsFromAnswers(guestAnswers);
    setLocalCounts(derivedCounts.correctCount, derivedCounts.incorrectCount);
    return derivedCounts;
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

      if (isLoginPage()) {
        goToGamePage();
        return;
      }

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

      if (isLoginPage()) {
        goToGamePage();
        return;
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

    if (isLoginPage()) {
      goToGamePage();
      return;
    }

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

async function getArchiveAnswersByDate() {
  if (!authState.token) {
    return getGuestAnswers();
  }

  try {
    return sanitizeAnswersByDate(await syncAnswersFromServer());
  } catch (error) {
    if (error.status === 401) {
      clearAuthSession();
    }

    return getGuestAnswers();
  }
}

async function getArchiveOutcomeByDate(availableDates, answersByDate) {
  const normalizedAnswers = sanitizeAnswersByDate(answersByDate);
  const answeredDates = availableDates.filter((date) => normalizedAnswers[date]);
  const outcomeByDate = {};

  await Promise.all(
    answeredDates.map(async (date) => {
      try {
        const response = await fetch(`./data/${date}.json`);
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        outcomeByDate[date] = normalizedAnswers[date] === data.answer ? 'correct' : 'wrong';
      } catch {
        // Skip styling if this day's question cannot be loaded.
      }
    })
  );

  return outcomeByDate;
}

async function loadArchive() {
  const archiveList = document.getElementById('archive-list');
  if (!archiveList) {
    return;
  }

  try {
    const response = await fetch('dates.json');
    if (!response.ok) {
      throw new Error('Could not load archive dates.');
    }

    const dates = await response.json();
    const availableDates = Array.isArray(dates)
      ? dates.filter((date) => typeof date === 'string' && date <= today).sort((a, b) => b.localeCompare(a))
      : [];

    const answersByDate = await getArchiveAnswersByDate();
    const outcomeByDate = await getArchiveOutcomeByDate(availableDates, answersByDate);

    archiveList.innerHTML = '';
    availableDates.forEach((date) => {
      const link = document.createElement('a');
      link.href = `index.html?date=${date}`;
      link.classList.add('archive-day-button');

      if (outcomeByDate[date] === 'correct') {
        link.classList.add('archive-day-correct');
      } else if (outcomeByDate[date] === 'wrong') {
        link.classList.add('archive-day-wrong');
      }

      link.textContent = new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      archiveList.appendChild(link);
    });
  } catch {
    archiveList.innerHTML = '<p>Unable to load archive dates.</p>';
  }
}

function getCurrentPageName() {
  return window.location.pathname.split('/').pop() || 'index.html';
}

function isArchivePage() {
  return getCurrentPageName() === 'archive.html';
}

function isLoginPage() {
  return getCurrentPageName() === 'login.html';
}

function goToGamePage() {
  const params = new URLSearchParams(window.location.search);
  const date = params.get('date');
  window.location.href = date ? `index.html?date=${encodeURIComponent(date)}` : 'index.html';
}

function navigateToDate(date) {
  const params = new URLSearchParams(window.location.search);

  if (date === today) {
    params.delete('date');
  } else {
    params.set('date', date);
  }

  const query = params.toString();
  window.location.href = query ? `index.html?${query}` : 'index.html';
}

function wireDayNavigation() {
  const prevButton = document.getElementById('prev-day-button');
  const nextButton = document.getElementById('next-day-button');

  if (!prevButton || !nextButton) {
    return;
  }

  prevButton.disabled = true;
  nextButton.disabled = true;

  fetch('dates.json')
    .then((res) => {
      if (!res.ok) {
        throw new Error('Could not load dates.');
      }

      return res.json();
    })
    .then((dates) => {
      const availableDates = Array.isArray(dates)
        ? dates
            .filter((date) => typeof date === 'string' && date <= today)
            .sort((a, b) => a.localeCompare(b))
        : [];

      const timeline = Array.from(new Set([...availableDates, selectedDate])).sort((a, b) => a.localeCompare(b));
      const currentIndex = timeline.indexOf(selectedDate);

      if (currentIndex === -1) {
        return;
      }

      const prevDate = timeline[currentIndex - 1];
      const nextDate = timeline[currentIndex + 1];

      prevButton.disabled = !prevDate;
      nextButton.disabled = !nextDate;

      if (prevDate) {
        prevButton.addEventListener('click', () => navigateToDate(prevDate));
      }

      if (nextDate) {
        nextButton.addEventListener('click', () => navigateToDate(nextDate));
      }
    })
    .catch(() => {
      prevButton.disabled = true;
      nextButton.disabled = true;
    });
}

async function initializeApp() {
  if (isArchivePage()) {
    loadArchive();
    return;
  }

  wireDayNavigation();
  wireAuthHandlers();

  if (isLoginPage()) {
    if (authState.token) {
      try {
        await syncCountsFromServer();
      } catch {
        clearAuthSession();
        showToast('Session expired. Please log in again.');
      }
    }

    refreshAuthControls();
    const local = getLocalCounts();
    updateCountDisplay(local.correctCount, local.incorrectCount);
    return;
  }

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