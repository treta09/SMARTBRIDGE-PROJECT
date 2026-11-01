(() => {
  "use strict";

  const STORAGE_KEY = "classroom-signal-v1";
  const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
  const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
  const SAMPLE_SECONDS = 30;
  const els = {
    video: document.querySelector("#videoFile"),
    audio: document.querySelector("#audioFile"),
    videoName: document.querySelector("#videoName"),
    audioName: document.querySelector("#audioName"),
    sessionTitle: document.querySelector("#sessionTitle"),
    analyze: document.querySelector("#analyzeButton"),
    progress: document.querySelector("#progressWrap"),
    progressLabel: document.querySelector("#progressLabel"),
    progressPercent: document.querySelector("#progressPercent"),
    progressBar: document.querySelector("#progressBar"),
    error: document.querySelector("#errorMessage"),
    movement: document.querySelector("#movementValue"),
    audioMetric: document.querySelector("#audioValue"),
    shifts: document.querySelector("#shiftValue"),
    duration: document.querySelector("#sessionDuration"),
    canvas: document.querySelector("#activityChart"),
    chartEmpty: document.querySelector("#chartEmpty"),
    chartLabels: document.querySelector("#chartLabels"),
    suggestions: document.querySelector("#suggestionList"),
    participant: document.querySelector("#participantCode"),
    attendanceForm: document.querySelector("#attendanceForm"),
    resetAttendance: document.querySelector("#resetAttendance"),
    roster: document.querySelector("#rosterList"),
    attendanceCount: document.querySelector("#attendanceCount"),
    history: document.querySelector("#historyList"),
    clearHistory: document.querySelector("#clearHistory"),
    today: document.querySelector("#todayLabel"),
    privacyDialog: document.querySelector("#privacyDialog")
  };

  let state = loadState();
  let currentSession = { series: [] };
  let videoObjectUrl = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        sessions: Array.isArray(saved.sessions) ? saved.sessions.slice(0, 10) : [],
        participants: Array.isArray(saved.participants) ? saved.participants.slice(0, 100) : []
      };
    } catch (error) {
      console.warn("Could not read local session data.", error);
      return { sessions: [], participants: [] };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      showError("Could not save this session in browser storage. Check available local storage space.");
      console.error("Could not persist session data.", error);
    }
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function clearError() {
    els.error.textContent = "";
    els.error.hidden = true;
  }

  function setProgress(label, percent) {
    els.progress.hidden = false;
    els.progressLabel.textContent = label;
    els.progressPercent.textContent = `${Math.round(percent)}%`;
    els.progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }

  function selectedFiles() {
    return { video: els.video.files[0] || null, audio: els.audio.files[0] || null };
  }

  function syncInputs() {
    const files = selectedFiles();
    els.videoName.textContent = files.video ? files.video.name : "Choose a file";
    els.audioName.textContent = files.audio ? files.audio.name : "Choose a file";
    els.analyze.disabled = !(files.video || files.audio);
    clearError();
  }

  function setFileInputMessage(file, maxBytes, label) {
    if (file && file.size > maxBytes) {
      showError(`${label} exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
      return false;
    }
    return true;
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  async function analyzeVideo(file) {
    if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    videoObjectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = videoObjectUrl;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("This video could not be opened by your browser. Try a supported MP4 or WebM recording."));
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out while opening the video. Try a shorter recording.")), 10000);
      video.onloadeddata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error("The video could not be decoded by your browser.")); };
    });

    const duration = Math.min(video.duration, 600);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("The video has no readable duration.");
    if (video.videoWidth === 0 || video.videoHeight === 0) throw new Error("The video has no readable image frames.");
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Your browser could not create a local video analysis surface.");
    const sampleCount = Math.max(2, Math.ceil(duration / 2));
    const frames = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const time = Math.min(duration - 0.05, index * duration / sampleCount);
      if (Math.abs(video.currentTime - time) > 0.001) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timed out while reading a video frame. Try a shorter recording.")), 10000);
          video.onseeked = () => { clearTimeout(timer); resolve(); };
          video.onerror = () => { clearTimeout(timer); reject(new Error("An unreadable frame was found in the video.")); };
          video.currentTime = time;
        });
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const gray = new Uint8Array(canvas.width * canvas.height);
      for (let pixel = 0, offset = 0; pixel < gray.length; pixel += 1, offset += 4) {
        gray[pixel] = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
      }
      frames.push({ time, gray });
      setProgress("Sampling video frames…", 5 + 65 * (index + 1) / sampleCount);
      await new Promise(requestAnimationFrame);
    }
    const series = [];
    const bucketCount = Math.ceil(duration / SAMPLE_SECONDS);
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const start = bucket * SAMPLE_SECONDS;
      const end = Math.min(duration, start + SAMPLE_SECONDS);
      const chunk = frames.filter((frame) => frame.time >= start && frame.time < end);
      const diffs = [];
      for (let i = 1; i < chunk.length; i += 1) {
        let diff = 0;
        for (let pixel = 0; pixel < chunk[i].gray.length; pixel += 1) {
          diff += Math.abs(chunk[i].gray[pixel] - chunk[i - 1].gray[pixel]);
        }
        diffs.push(diff / (chunk[i].gray.length * 255));
      }
      series.push({ time: start, movement: Math.round(Math.min(100, mean(diffs) * 500)), audio: null });
    }
    return { duration, series };
  }

  async function analyzeAudio(file, series, videoDuration) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser does not support local audio analysis. Use a recent browser or analyze video only.");
    const context = new AudioContextClass();
    try {
      const buffer = await file.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(buffer);
      const duration = Math.min(audioBuffer.duration, 600);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("The audio has no readable duration.");
      const bucketCount = Math.ceil(duration / SAMPLE_SECONDS);
      const rawLevels = [];
      const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
      for (let bucket = 0; bucket < bucketCount; bucket += 1) {
        const startSample = Math.floor(bucket * SAMPLE_SECONDS * audioBuffer.sampleRate);
        const endSample = Math.min(audioBuffer.length, Math.floor((bucket + 1) * SAMPLE_SECONDS * audioBuffer.sampleRate));
        let energy = 0;
        let count = 0;
        const stride = Math.max(1, Math.floor((endSample - startSample) / 50000));
        for (const channel of channels) {
          for (let i = startSample; i < endSample; i += stride) {
            energy += channel[i] * channel[i];
            count += 1;
          }
        }
        rawLevels.push(Math.sqrt(energy / Math.max(1, count)));
        setProgress("Measuring audio energy…", 70 + 25 * (bucket + 1) / bucketCount);
        await new Promise(requestAnimationFrame);
      }
      const peak = Math.max(...rawLevels, 0.0001);
      const floor = 0.005;
      const range = Math.max(peak - floor, 0.04);
      rawLevels.forEach((level, index) => {
        const pointTime = index * SAMPLE_SECONDS;
        let point = series.find((item) => Math.abs(item.time - pointTime) < SAMPLE_SECONDS);
        if (!point) {
          point = { time: pointTime, movement: null, audio: null };
          series.push(point);
        }
        point.audio = Math.round(Math.max(0, Math.min(100, ((level - floor) / range) * 100)));
      });
      return duration;
    } finally {
      await context.close();
    }
  }

  function deriveSuggestions(series) {
    const movement = series.map((item) => item.movement).filter(Number.isFinite);
    const audio = series.map((item) => item.audio).filter(Number.isFinite);
    const cues = [];
    if (movement.length && mean(movement) < 12) {
      cues.push("Movement stayed relatively steady in the sampled video. Consider checking in with the group or offering a brief stretch break; low movement alone does not indicate disengagement.");
    } else if (movement.length && mean(movement) > 40) {
      cues.push("There was frequent visual change in the recording. If useful, compare these moments with the lesson plan to see whether transitions or an activity explain the pattern.");
    }
    if (audio.length && mean(audio) < 15) {
      cues.push("Recorded sound energy was mostly low. You could invite questions or a short pair discussion if that fits the activity. This signal cannot tell speech from other sounds.");
    } else if (audio.length && mean(audio) > 55) {
      cues.push("Audio energy was often elevated. Consider checking whether discussion, group work, or background noise best explains those intervals.");
    }
    if (movement.length && audio.length) {
      const quiet = series.find((point) => point.movement !== null && point.audio !== null && point.movement < 10 && point.audio < 10);
      if (quiet) cues.push(`Both sampled signals were low around ${formatTime(quiet.time)}. It may be a useful moment to reflect on pacing or ask learners for feedback.`);
    }
    if (!cues.length) cues.push("No strong activity pattern stood out in these simple signals. Use your knowledge of the class and lesson context to interpret the recording.");
    return cues;
  }

  function drawChart(series) {
    const canvas = els.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const width = rect.width;
    const height = rect.height;
    const pad = { top: 12, right: 8, bottom: 8, left: 22 };
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const ctxFont = getComputedStyle(document.body).fontFamily;
    ctx.font = `9px ${ctxFont}`;
    ctx.strokeStyle = "#edf0ed";
    ctx.fillStyle = "#a0a9a3";
    ctx.lineWidth = 1;
    [0, 50, 100].forEach((value) => {
      const y = pad.top + chartHeight * (1 - value / 100);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(String(value), 2, y + 3);
    });
    const maxTime = Math.max(SAMPLE_SECONDS, ...series.map((point) => point.time));
    for (const [key, color] of [["movement", "#397858"], ["audio", "#df8d5d"]]) {
      const points = series.filter((point) => Number.isFinite(point[key]));
      if (!points.length) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = pad.left + chartWidth * point.time / maxTime;
        const y = pad.top + chartHeight * (1 - point[key] / 100);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    els.chartLabels.replaceChildren();
    const labels = series.length > 1 ? [series[0].time, series[Math.floor((series.length - 1) / 2)].time, series[series.length - 1].time] : [0];
    [...new Set(labels)].forEach((time) => {
      const label = document.createElement("span");
      label.textContent = formatTime(time);
      els.chartLabels.append(label);
    });
    els.chartEmpty.hidden = series.length > 0;
  }

  function updateResults(result) {
    const movement = result.series.map((point) => point.movement).filter(Number.isFinite);
    const audio = result.series.map((point) => point.audio).filter(Number.isFinite);
    const combined = result.series.map((point) => [point.movement, point.audio].filter(Number.isFinite)).filter((values) => values.length).map(mean);
    const shifts = combined.slice(1).filter((value, index) => Math.abs(value - combined[index]) >= 25).length;
    els.movement.textContent = movement.length ? Math.round(mean(movement)) : "—";
    els.audioMetric.textContent = audio.length ? Math.round(mean(audio)) : "—";
    els.shifts.textContent = combined.length ? shifts : "—";
    els.duration.textContent = result.duration ? `· ${formatTime(result.duration)}` : "";
    els.suggestions.replaceChildren();
    const list = document.createElement("ul");
    for (const cue of deriveSuggestions(result.series)) {
      const item = document.createElement("li");
      item.textContent = cue;
      list.append(item);
    }
    els.suggestions.append(list);
    drawChart(result.series);
  }

  function formatCheckIn(iso) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  }

  function renderRoster() {
    els.roster.replaceChildren();
    const present = state.participants.filter((participant) => participant.present);
    els.attendanceCount.textContent = String(present.length);
    if (!state.participants.length) {
      const empty = document.createElement("div");
      empty.className = "empty-roster";
      empty.innerHTML = '<span class="empty-mark">○</span><span>Add a participant code to start a local roll call.</span>';
      els.roster.append(empty);
      return;
    }
    state.participants.forEach((participant, index) => {
      const row = document.createElement("div");
      row.className = "roster-row";
      const person = document.createElement("div");
      person.className = "roster-person";
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = participant.code.slice(0, 2).toUpperCase();
      const details = document.createElement("span");
      const name = document.createElement("span");
      name.className = "person-name";
      name.textContent = participant.code;
      const time = document.createElement("span");
      time.className = "person-time";
      time.textContent = participant.present ? `CHECKED IN ${formatCheckIn(participant.checkedIn)}` : "NOT CHECKED IN";
      details.append(name, time);
      person.append(avatar, details);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = `present-toggle${participant.present ? "" : " absent"}`;
      toggle.textContent = participant.present ? "Present" : "Check in";
      toggle.setAttribute("aria-pressed", String(participant.present));
      toggle.addEventListener("click", () => {
        const current = state.participants[index];
        current.present = !current.present;
        current.checkedIn = current.present ? new Date().toISOString() : null;
        saveState();
        renderRoster();
      });
      els.resetAttendance.addEventListener("click", () => {
        state.participants.forEach((participant) => {
          participant.present = false;
          participant.checkedIn = null;
        });
        saveState();
        renderRoster();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-participant";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${participant.code} from roll call`);
      remove.addEventListener("click", () => {
        state.participants.splice(index, 1);
        saveState();
        renderRoster();
      });
      const actions = document.createElement("div");
      actions.className = "roster-actions";
      actions.append(toggle, remove);
      row.append(person, actions);
      els.roster.append(row);
    });
  }

  function renderHistory() {
    els.history.replaceChildren();
    if (!state.sessions.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "Completed sessions will be saved on this device only.";
      els.history.append(empty);
      return;
    }
    state.sessions.slice(0, 5).forEach((session) => {
      const item = document.createElement("div");
      item.className = "history-item";
      const name = document.createElement("div");
      name.className = "history-name";
      name.textContent = session.title;
      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.textContent = `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(session.savedAt))} · ${session.presentCount} checked in`;
      item.append(name, meta);
      els.history.append(item);
    });
  }

  async function runAnalysis() {
    clearError();
    const files = selectedFiles();
    if (!files.video && !files.audio) {
      showError("Choose at least one recording to analyze.");
      return;
    }
    if (!setFileInputMessage(files.video, MAX_VIDEO_BYTES, "Video") || !setFileInputMessage(files.audio, MAX_AUDIO_BYTES, "Audio")) return;
    els.analyze.disabled = true;
    currentSession.series = [];
    try {
      let videoDuration = 0;
      let audioDuration = 0;
      if (files.video) {
        const videoResult = await analyzeVideo(files.video);
        currentSession.series = videoResult.series;
        videoDuration = videoResult.duration;
      }
      if (files.audio) audioDuration = await analyzeAudio(files.audio, currentSession.series, videoDuration);
      currentSession.series.sort((a, b) => a.time - b.time);
      const duration = Math.max(videoDuration, audioDuration);
      const result = { duration, series: currentSession.series };
      updateResults(result);
      const session = {
        title: els.sessionTitle.value.trim() || "Untitled session",
        savedAt: new Date().toISOString(),
        duration,
        movement: els.movement.textContent,
        audio: els.audioMetric.textContent,
        presentCount: state.participants.filter((participant) => participant.present).length
      };
      state.sessions.unshift(session);
      state.sessions = state.sessions.slice(0, 10);
      saveState();
      renderHistory();
      setProgress("Analysis complete · media discarded", 100);
      window.setTimeout(() => { els.progress.hidden = true; }, 2500);
    } catch (error) {
      console.error("Session analysis failed.", error);
      showError(error instanceof Error ? error.message : "Analysis failed. Try another local recording.");
      els.progress.hidden = true;
    } finally {
      els.analyze.disabled = false;
      if (videoObjectUrl) { URL.revokeObjectURL(videoObjectUrl); videoObjectUrl = null; }
    }
  }

  els.video.addEventListener("change", syncInputs);
  els.audio.addEventListener("change", syncInputs);
  els.analyze.addEventListener("click", runAnalysis);
  els.attendanceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = els.participant.value.trim();
    if (!code) return;
    if (state.participants.some((participant) => participant.code.toLocaleLowerCase() === code.toLocaleLowerCase())) {
      showError("That participant code is already on the roll call.");
      els.participant.focus();
      return;
    }
    if (state.participants.length >= 100) {
      showError("The local roll call is limited to 100 participant codes.");
      return;
    }
    state.participants.push({ code, present: true, checkedIn: new Date().toISOString() });
    els.participant.value = "";
    clearError();
    saveState();
    renderRoster();
  });
  els.clearHistory.addEventListener("click", () => {
    state.sessions = [];
    saveState();
    renderHistory();
  });
  document.querySelector("#privacyButton").addEventListener("click", () => els.privacyDialog.showModal());
  document.querySelector("#closePrivacy").addEventListener("click", () => els.privacyDialog.close());
  document.querySelector("#closePrivacyButton").addEventListener("click", () => els.privacyDialog.close());
  window.addEventListener("resize", () => {
    if (currentSession.series.length) drawChart(currentSession.series);
  });

  els.today.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date()).toUpperCase();
  renderRoster();
  renderHistory();
})();
