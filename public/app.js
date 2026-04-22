const state = {
  tracks: [],
  filteredTracks: [],
  ranking: Array(15).fill(null),
  draggingTrackId: null,
};

const catalogList = document.querySelector("#catalog-list");
const rankingList = document.querySelector("#ranking-list");
const leaderboardList = document.querySelector("#leaderboard-list");
const searchInput = document.querySelector("#track-search");
const voteStatus = document.querySelector("#vote-status");
const catalogStatus = document.querySelector("#catalog-status");
const totalVotes = document.querySelector("#total-votes");
const totalTracks = document.querySelector("#total-tracks");
const submitVoteButton = document.querySelector("#submit-vote");
const catalogTemplate = document.querySelector("#catalog-item-template");

function formatTrackMeta(track) {
  return `${track.artist} • ${track.album}`;
}

function getTrackById(trackId) {
  return state.tracks.find((track) => track.id === trackId) || null;
}

function setCatalogStatus(message, isError = false) {
  catalogStatus.textContent = message;
  catalogStatus.style.color = isError ? "#9e3114" : "";
}

function setVoteStatus(message, isError = false) {
  voteStatus.textContent = message;
  voteStatus.style.color = isError ? "#9e3114" : "";
}

function applySearch() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    state.filteredTracks = [...state.tracks];
    renderCatalog();
    return;
  }

  state.filteredTracks = state.tracks.filter((track) => {
    const haystack = `${track.name} ${track.artist} ${track.album}`.toLowerCase();
    return haystack.includes(query);
  });

  renderCatalog();
}

function renderCatalog() {
  catalogList.innerHTML = "";
  const selectedIds = new Set(state.ranking.filter(Boolean).map((track) => track.id));
  const visibleTracks = state.filteredTracks.filter((track) => !selectedIds.has(track.id));

  if (!visibleTracks.length) {
    const empty = document.createElement("p");
    empty.className = "status-line";
    empty.textContent = "Aucune chanson ne correspond a votre recherche.";
    catalogList.append(empty);
    return;
  }

  for (const track of visibleTracks) {
    const fragment = catalogTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".track-card");
    const image = fragment.querySelector(".track-cover");
    const title = fragment.querySelector(".track-title");
    const meta = fragment.querySelector(".track-meta");
    const link = fragment.querySelector(".track-link");

    card.dataset.trackId = track.id;
    image.src = track.image || "";
    image.alt = `Pochette de ${track.name}`;
    title.textContent = track.name;
    meta.textContent = formatTrackMeta(track);
    link.href = track.spotifyUrl;

    card.addEventListener("dragstart", () => {
      state.draggingTrackId = track.id;
      card.classList.add("dragging");
    });

    card.addEventListener("dragend", () => {
      state.draggingTrackId = null;
      card.classList.remove("dragging");
    });

    card.addEventListener("dblclick", () => {
      const firstEmptyIndex = state.ranking.findIndex((slot) => slot === null);
      if (firstEmptyIndex >= 0) {
        placeTrack(track.id, firstEmptyIndex);
      }
    });

    catalogList.append(fragment);
  }
}

function placeTrack(trackId, targetIndex) {
  const track = getTrackById(trackId);
  if (!track) return;

  const existingIndex = state.ranking.findIndex((item) => item?.id === trackId);

  if (existingIndex >= 0) {
    state.ranking.splice(existingIndex, 1, null);
  }

  const displacedTrack = state.ranking[targetIndex];
  state.ranking[targetIndex] = track;

  if (displacedTrack && displacedTrack.id !== track.id) {
    const fallbackIndex = existingIndex >= 0 ? existingIndex : state.ranking.findIndex((slot) => slot === null);
    if (fallbackIndex >= 0) {
      state.ranking[fallbackIndex] = displacedTrack;
    }
  }

  renderRanking();
  renderCatalog();
}

function removeTrackFromRanking(index) {
  state.ranking[index] = null;
  renderRanking();
  renderCatalog();
}

function renderRanking() {
  rankingList.innerHTML = "";

  state.ranking.forEach((track, index) => {
    const slot = document.createElement("div");
    slot.className = "ranking-slot";
    slot.dataset.index = String(index);

    const rankBadge = document.createElement("div");
    rankBadge.className = "rank-badge";
    rankBadge.textContent = String(index + 1);

    const copy = document.createElement("div");
    copy.className = "track-copy";

    if (track) {
      const title = document.createElement("strong");
      title.className = "track-title";
      title.textContent = track.name;

      const meta = document.createElement("span");
      meta.className = "track-meta";
      meta.textContent = formatTrackMeta(track);

      copy.append(title, meta);
    } else {
      const empty = document.createElement("span");
      empty.className = "slot-empty";
      empty.textContent = "Deposez une chanson ici";
      copy.append(empty);
    }

    const actions = document.createElement("div");
    actions.className = "slot-actions";

    if (track) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "ghost-button";
      removeButton.textContent = "Retirer";
      removeButton.addEventListener("click", () => removeTrackFromRanking(index));
      actions.append(removeButton);

      slot.draggable = true;
      slot.addEventListener("dragstart", () => {
        state.draggingTrackId = track.id;
      });
      slot.addEventListener("dragend", () => {
        state.draggingTrackId = null;
      });
    }

    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      slot.classList.add("active-drop");
    });

    slot.addEventListener("dragleave", () => {
      slot.classList.remove("active-drop");
    });

    slot.addEventListener("drop", (event) => {
      event.preventDefault();
      slot.classList.remove("active-drop");
      if (state.draggingTrackId) {
        placeTrack(state.draggingTrackId, index);
      }
    });

    slot.append(rankBadge, copy, actions);
    rankingList.append(slot);
  });

  const filledCount = state.ranking.filter(Boolean).length;
  submitVoteButton.disabled = filledCount !== 15;
}

function renderLeaderboard(data) {
  totalVotes.textContent = String(data.totalVotes || 0);
  leaderboardList.innerHTML = "";

  if (!data.ranking || !data.ranking.length) {
    const empty = document.createElement("p");
    empty.className = "status-line";
    empty.textContent = "Aucun vote pour le moment. Le premier Top 15 lancera le classement consolide.";
    leaderboardList.append(empty);
    return;
  }

  data.ranking.slice(0, 20).forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "leaderboard-row";

    const rank = document.createElement("div");
    rank.className = "leaderboard-rank";
    rank.textContent = String(index + 1);

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.className = "leaderboard-title";
    title.textContent = entry.name;

    const meta = document.createElement("span");
    meta.className = "leaderboard-meta";
    meta.textContent = `${entry.artist} • ${entry.appearances} votes • rang moyen ${entry.averageRank}`;

    copy.append(title, meta);

    const points = document.createElement("div");
    points.className = "leaderboard-points";
    points.textContent = `${entry.totalPoints} pts`;

    row.append(rank, copy, points);
    leaderboardList.append(row);
  });
}

async function loadTracks() {
  setCatalogStatus("Chargement du catalogue Spotify...");

  try {
    const response = await fetch("/api/tracks");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "Erreur inconnue");
    }

    state.tracks = payload.tracks || [];
    state.filteredTracks = [...state.tracks];
    totalTracks.textContent = String(payload.total || state.tracks.length);
    setCatalogStatus(`${state.tracks.length} chansons chargees depuis Spotify.`);
    renderCatalog();
  } catch (error) {
    setCatalogStatus(`Erreur Spotify: ${error.message}`, true);
  }
}

async function loadLeaderboard() {
  const response = await fetch("/api/leaderboard");
  const payload = await response.json();
  renderLeaderboard(payload);
}

async function submitVote() {
  const rankedTracks = state.ranking.filter(Boolean);
  if (rankedTracks.length !== 15) {
    setVoteStatus("Le Top 15 doit etre complet avant l'envoi.", true);
    return;
  }

  setVoteStatus("Enregistrement du vote...");

  try {
    const response = await fetch("/api/votes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rankedTracks }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || payload.detail || "Erreur inconnue");
    }

    setVoteStatus("Vote enregistre. Le classement consolide a ete mis a jour.");
    renderLeaderboard(payload.leaderboard);
    state.ranking = Array(15).fill(null);
    renderRanking();
    renderCatalog();
  } catch (error) {
    setVoteStatus(`Impossible d'envoyer le vote: ${error.message}`, true);
  }
}

document.querySelector("#reload-tracks").addEventListener("click", loadTracks);
document.querySelector("#clear-ranking").addEventListener("click", () => {
  state.ranking = Array(15).fill(null);
  setVoteStatus("");
  renderRanking();
  renderCatalog();
});
document.querySelector("#submit-vote").addEventListener("click", submitVote);
searchInput.addEventListener("input", applySearch);

renderRanking();
loadTracks();
loadLeaderboard();
