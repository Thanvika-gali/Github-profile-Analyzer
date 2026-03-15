let profileData = null;
let repositoryData = [];
let languageChart = null;
let currentController = null;

const demoUsername = "torvalds";
const cacheTtlMs = 5 * 60 * 1000;

const elements = {
  username: document.getElementById("username"),
  analyzeButton: document.getElementById("analyzeButton"),
  loadDemoButton: document.getElementById("loadDemoButton"),
  shareProfileButton: document.getElementById("shareProfileButton"),
  themeToggle: document.getElementById("themeToggle"),
  statusMessage: document.getElementById("statusMessage"),
  loadingSection: document.getElementById("loadingSection"),
  overviewSection: document.getElementById("overviewSection"),
  metricsSection: document.getElementById("metricsSection"),
  analysisSection: document.getElementById("analysisSection"),
  repoSection: document.getElementById("repoSection"),
  avatar: document.getElementById("avatar"),
  name: document.getElementById("name"),
  login: document.getElementById("login"),
  bio: document.getElementById("bio"),
  profileType: document.getElementById("profileType"),
  profileMeta: document.getElementById("profileMeta"),
  followers: document.getElementById("followers"),
  following: document.getElementById("following"),
  publicRepos: document.getElementById("publicRepos"),
  developerScore: document.getElementById("developerScore"),
  profileLink: document.getElementById("profileLink"),
  blogLink: document.getElementById("blogLink"),
  totalStars: document.getElementById("totalStars"),
  totalForks: document.getElementById("totalForks"),
  totalWatchers: document.getElementById("totalWatchers"),
  mainLanguages: document.getElementById("mainLanguages"),
  insightChips: document.getElementById("insightChips"),
  summaryCards: document.getElementById("summaryCards"),
  activityList: document.getElementById("activityList"),
  repoSearch: document.getElementById("repoSearch"),
  languageFilter: document.getElementById("languageFilter"),
  sortSelect: document.getElementById("sortSelect"),
  repoContainer: document.getElementById("repoContainer"),
  repoCount: document.getElementById("repoCount")
};

document.addEventListener("DOMContentLoaded", () => {
  initializeTheme();
  bindEvents();
  hydrateFromUrl();
});

function initializeTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.body.classList.toggle("dark-mode", savedTheme === "dark");
  updateThemeButton();
}

function bindEvents() {
  elements.themeToggle.addEventListener("click", toggleTheme);
  elements.analyzeButton.addEventListener("click", fetchProfile);
  elements.loadDemoButton.addEventListener("click", () => {
    elements.username.value = demoUsername;
    fetchProfile();
  });
  elements.shareProfileButton.addEventListener("click", copyProfileLink);
  elements.repoSearch.addEventListener("input", renderRepositories);
  elements.languageFilter.addEventListener("change", renderRepositories);
  elements.sortSelect.addEventListener("change", renderRepositories);
  elements.username.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      fetchProfile();
    }
  });
}

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const username = params.get("user");

  if (username) {
    elements.username.value = username;
    fetchProfile();
  }
}

function toggleTheme() {
  const isDarkMode = document.body.classList.toggle("dark-mode");
  localStorage.setItem("theme", isDarkMode ? "dark" : "light");
  updateThemeButton();
  if (repositoryData.length) {
    renderLanguageChart(getLanguageCounts(repositoryData));
  }
}

function updateThemeButton() {
  elements.themeToggle.textContent = document.body.classList.contains("dark-mode") ? "Light mode" : "Dark mode";
}

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.style.color = isError ? "var(--danger)" : "";
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function createMetaItem(label, value) {
  return value ? `<span class="meta-item">${label}: ${value}</span>` : "";
}

async function fetchProfile() {
  const username = elements.username.value.trim();

  if (!username) {
    setStatus("Enter a GitHub username to start.", true);
    elements.username.focus();
    return;
  }

  abortCurrentRequest();
  currentController = new AbortController();
  const { signal } = currentController;

  resetSectionsForLoading();
  setLoadingState(true);
  setStatus("Loading profile...");

  const cached = readCache(username);
  if (cached) {
    applyProfilePayload(cached.profile);
    applyRepositoryPayload(cached.repos);
    applyActivityPayload(cached.events);
    showDashboardSections();
    showLoadingSkeleton(false);
    setStatus(`Loaded ${username} from cache.`);
    setLoadingState(false);
    return;
  }

  try {
    const profileResponse = await fetch(`https://api.github.com/users/${username}`, { signal });
    if (!profileResponse.ok) {
      throw new Error(profileResponse.status === 404 ? "GitHub user not found." : "GitHub profile request failed.");
    }

    profileData = await profileResponse.json();
    repositoryData = [];

    applyProfilePayload(profileData);
    showDashboardSections({ profileOnly: true });
    setStatus("Profile loaded. Fetching repositories and activity...");

    const [reposResult, eventsResult] = await Promise.allSettled([
      fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`, { signal }),
      fetch(`https://api.github.com/users/${username}/events/public?per_page=10`, { signal })
    ]);

    let repos = [];
    let events = [];

    if (reposResult.status === "fulfilled" && reposResult.value.ok) {
      repos = await reposResult.value.json();
    }

    if (eventsResult.status === "fulfilled" && eventsResult.value.ok) {
      events = await eventsResult.value.json();
    }

    applyRepositoryPayload(repos);
    applyActivityPayload(events);
    writeCache(username, { profile: profileData, repos, events });
    setStatus(`Loaded ${username}'s public profile.`);
    updateUrl(username);
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    hideDashboardSections();
    showLoadingSkeleton(false);
    setStatus(error.message || "Unable to load this GitHub profile.", true);
  } finally {
    if (!signal.aborted) {
      setLoadingState(false);
    }
  }
}

function abortCurrentRequest() {
  if (currentController) {
    currentController.abort();
  }
}

function resetSectionsForLoading() {
  showLoadingSkeleton(true);
  hideDashboardSections();
  elements.repoContainer.innerHTML = "";
  elements.activityList.innerHTML = "";
  elements.insightChips.innerHTML = "";
  elements.summaryCards.innerHTML = "";
  elements.repoSearch.value = "";
  elements.languageFilter.innerHTML = '<option value="all">All languages</option>';
  elements.repoCount.textContent = "0 repositories";
}

function setLoadingState(isLoading) {
  elements.analyzeButton.disabled = isLoading;
  elements.analyzeButton.textContent = isLoading ? "Loading..." : "Analyze Profile";
  document.body.classList.toggle("loading", isLoading);
}

function showLoadingSkeleton(visible) {
  elements.loadingSection.classList.toggle("hidden", !visible);
}

function showDashboardSections(options = {}) {
  const { profileOnly = false } = options;
  elements.overviewSection.classList.remove("hidden");

  if (!profileOnly) {
    elements.metricsSection.classList.remove("hidden");
    elements.analysisSection.classList.remove("hidden");
    elements.repoSection.classList.remove("hidden");
  }
}

function hideDashboardSections() {
  elements.overviewSection.classList.add("hidden");
  elements.metricsSection.classList.add("hidden");
  elements.analysisSection.classList.add("hidden");
  elements.repoSection.classList.add("hidden");
}

function applyProfilePayload(profile) {
  renderProfile(profile);
  showLoadingSkeleton(false);
}

function applyRepositoryPayload(repos) {
  repositoryData = repos;
  renderMetrics(repos);
  renderInsights(profileData, repos);
  populateLanguageFilter(repos);
  renderRepositories();
  renderLanguageChart(getLanguageCounts(repos));
  elements.metricsSection.classList.remove("hidden");
  elements.analysisSection.classList.remove("hidden");
  elements.repoSection.classList.remove("hidden");
}

function applyActivityPayload(events) {
  renderActivity(events);
  elements.analysisSection.classList.remove("hidden");
}

function renderProfile(profile) {
  const stars = repositoryData.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const developerScore = Math.round((profile.followers * 3) + (profile.public_repos * 2) + (stars * 0.8));

  elements.avatar.src = profile.avatar_url;
  elements.avatar.alt = `${profile.login} avatar`;
  elements.name.textContent = profile.name || profile.login;
  elements.login.textContent = `@${profile.login}`;
  elements.bio.textContent = profile.bio || "No public bio available.";
  elements.profileType.textContent = profile.type || "Profile";
  elements.followers.textContent = formatNumber(profile.followers);
  elements.following.textContent = formatNumber(profile.following);
  elements.publicRepos.textContent = formatNumber(profile.public_repos);
  elements.developerScore.textContent = formatNumber(developerScore);
  elements.profileLink.href = profile.html_url;

  const blogUrl = normalizeUrl(profile.blog);
  if (blogUrl) {
    elements.blogLink.href = blogUrl;
    elements.blogLink.classList.remove("hidden");
  } else {
    elements.blogLink.classList.add("hidden");
  }

  elements.profileMeta.innerHTML = [
    createMetaItem("Location", profile.location),
    createMetaItem("Company", profile.company),
    createMetaItem("Joined", formatDate(profile.created_at)),
    createMetaItem("Updated", formatDate(profile.updated_at))
  ].join("");
}

function renderMetrics(repos) {
  const languages = getLanguageCounts(repos);
  const topLanguages = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([language]) => language)
    .join(", ");

  const totals = repos.reduce((result, repo) => {
    result.stars += repo.stargazers_count;
    result.forks += repo.forks_count;
    result.watchers += repo.watchers_count;
    return result;
  }, { stars: 0, forks: 0, watchers: 0 });

  elements.totalStars.textContent = formatNumber(totals.stars);
  elements.totalForks.textContent = formatNumber(totals.forks);
  elements.totalWatchers.textContent = formatNumber(totals.watchers);
  elements.mainLanguages.textContent = topLanguages || "N/A";
  elements.developerScore.textContent = formatNumber(
    Math.round((profileData.followers * 3) + (profileData.public_repos * 2) + (totals.stars * 0.8))
  );
}

function renderInsights(profile, repos) {
  const languages = Object.entries(getLanguageCounts(repos)).sort((a, b) => b[1] - a[1]);
  const originalRepos = repos.filter((repo) => !repo.fork).length;
  const topRepo = [...repos].sort((a, b) => b.stargazers_count - a.stargazers_count)[0];
  const recentlyUpdated = repos.filter((repo) => {
    const updatedDate = new Date(repo.updated_at);
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - 30);
    return updatedDate >= threshold;
  }).length;

  const chips = [
    `${profile.followers > 100 ? "Strong" : "Growing"} audience`,
    `${languages[0]?.[0] || "Generalist"} focused`,
    `${recentlyUpdated} repos updated this month`,
    `${originalRepos} original projects`
  ];

  elements.insightChips.innerHTML = chips.map((chip) => `<span class="insight-chip">${chip}</span>`).join("");

  const summaryCards = [
    {
      title: "Top repo",
      value: topRepo ? topRepo.name : "N/A",
      note: topRepo ? `${formatNumber(topRepo.stargazers_count)} stars` : "No repositories found"
    },
    {
      title: "Primary stack",
      value: languages.slice(0, 2).map(([language]) => language).join(" + ") || "N/A",
      note: "Most common languages across public repos"
    },
    {
      title: "Activity pace",
      value: `${recentlyUpdated} active`,
      note: "Repositories updated in the last 30 days"
    },
    {
      title: "Repository mix",
      value: repos.length ? `${originalRepos}/${repos.length}` : "N/A",
      note: "Original vs total public repositories"
    }
  ];

  elements.summaryCards.innerHTML = summaryCards.map((card) => `
    <article class="summary-card">
      <p>${card.title}</p>
      <h3>${card.value}</h3>
      <p>${card.note}</p>
    </article>
  `).join("");
}

function populateLanguageFilter(repos) {
  const selected = elements.languageFilter.value;
  const languages = Object.keys(getLanguageCounts(repos)).sort();

  elements.languageFilter.innerHTML = '<option value="all">All languages</option>';

  languages.forEach((language) => {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    option.selected = language === selected;
    elements.languageFilter.appendChild(option);
  });
}

function renderRepositories() {
  const searchValue = elements.repoSearch.value.trim().toLowerCase();
  const languageValue = elements.languageFilter.value;
  const sortValue = elements.sortSelect.value;

  const filteredRepos = [...repositoryData]
    .filter((repo) => {
      const matchesSearch = repo.name.toLowerCase().includes(searchValue) ||
        (repo.description || "").toLowerCase().includes(searchValue);
      const matchesLanguage = languageValue === "all" || repo.language === languageValue;
      return matchesSearch && matchesLanguage;
    })
    .sort((a, b) => sortRepositories(a, b, sortValue));

  elements.repoCount.textContent = `${filteredRepos.length} repositories`;

  if (!filteredRepos.length) {
    elements.repoContainer.innerHTML = '<div class="empty-state">No repositories match the current filters.</div>';
    return;
  }

  elements.repoContainer.innerHTML = filteredRepos.map((repo) => `
    <article class="repo-card">
      <div class="repo-card-top">
        <div class="repo-card-title">
          <a href="${repo.html_url}" target="_blank" rel="noreferrer">
            <h3>${repo.name}</h3>
          </a>
          <div class="repo-card-meta">
            ${repo.language ? `<span class="language-badge">${repo.language}</span>` : ""}
            <span class="repo-stat">Updated ${formatDate(repo.updated_at)}</span>
          </div>
        </div>
      </div>
      <p>${repo.description || "No description available for this repository."}</p>
      <div class="repo-stats">
        <span class="repo-stat">Stars ${formatNumber(repo.stargazers_count)}</span>
        <span class="repo-stat">Forks ${formatNumber(repo.forks_count)}</span>
        <span class="repo-stat">Watchers ${formatNumber(repo.watchers_count)}</span>
        <span class="repo-stat">${repo.fork ? "Forked project" : "Original project"}</span>
      </div>
    </article>
  `).join("");
}

function sortRepositories(first, second, sortValue) {
  if (sortValue === "name") {
    return first.name.localeCompare(second.name);
  }
  if (sortValue === "forks") {
    return second.forks_count - first.forks_count;
  }
  if (sortValue === "updated") {
    return new Date(second.updated_at) - new Date(first.updated_at);
  }
  return second.stargazers_count - first.stargazers_count;
}

function renderActivity(events) {
  if (!events.length) {
    elements.activityList.innerHTML = '<div class="empty-state">No recent public activity was returned by GitHub.</div>';
    return;
  }

  elements.activityList.innerHTML = events.slice(0, 10).map((event) => `
    <article class="activity-item">
      <div class="activity-title">${mapEventType(event)}</div>
      <div class="activity-date">${formatDate(event.created_at)}</div>
    </article>
  `).join("");
}

function mapEventType(event) {
  const repoName = event.repo?.name || "a repository";

  switch (event.type) {
    case "PushEvent":
      return `Pushed new commits to ${repoName}`;
    case "CreateEvent":
      return `Created ${event.payload?.ref_type || "content"} in ${repoName}`;
    case "ForkEvent":
      return `Forked ${repoName}`;
    case "WatchEvent":
      return `Starred ${repoName}`;
    case "PullRequestEvent":
      return `Opened or updated a pull request in ${repoName}`;
    default:
      return `${event.type.replace(/Event$/, "")} activity in ${repoName}`;
  }
}

function getLanguageCounts(repos) {
  return repos.reduce((result, repo) => {
    if (repo.language) {
      result[repo.language] = (result[repo.language] || 0) + 1;
    }
    return result;
  }, {});
}

function renderLanguageChart(languages) {
  const labels = Object.keys(languages);
  const values = Object.values(languages);
  const canvas = document.getElementById("languageChart");

  if (languageChart) {
    languageChart.destroy();
  }

  if (!labels.length) {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const chartTextColor = getComputedStyle(document.body).getPropertyValue("--text").trim();

  languageChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        borderWidth: 0,
        hoverOffset: 8,
        backgroundColor: ["#e95d3d", "#255bd8", "#219ebc", "#1d9362", "#ffb703", "#8f6fff"]
      }]
    },
    options: {
      responsive: true,
      cutout: "68%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: chartTextColor,
            usePointStyle: true,
            padding: 18
          }
        }
      }
    }
  });
}

async function copyProfileLink() {
  if (!profileData?.html_url) {
    setStatus("Analyze a profile first to copy its GitHub link.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(profileData.html_url);
    setStatus("GitHub profile link copied to clipboard.");
  } catch {
    setStatus("Clipboard access failed. Copy the link manually from the profile card.", true);
  }
}

function updateUrl(username) {
  const url = new URL(window.location.href);
  url.searchParams.set("user", username);
  window.history.replaceState({}, "", url);
}

function normalizeUrl(value) {
  if (!value) {
    return "";
  }
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function readCache(username) {
  try {
    const raw = sessionStorage.getItem(getCacheKey(username));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > cacheTtlMs) {
      sessionStorage.removeItem(getCacheKey(username));
      return null;
    }

    profileData = parsed.profile;
    repositoryData = parsed.repos;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(username, payload) {
  try {
    sessionStorage.setItem(getCacheKey(username), JSON.stringify({
      ...payload,
      timestamp: Date.now()
    }));
  } catch {
    // Cache failure is non-blocking.
  }
}

function getCacheKey(username) {
  return `github-profile-analyzer:${username.toLowerCase()}`;
}
