'use strict';

/* Text → Spotify · Vanilla JS / Spotify Web API / Authorization Code + PKCE.
   No client secret, backend or external dependency required. */

const $ = (id) => document.getElementById(id);
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_ROOT = 'https://api.spotify.com/v1';
const SCOPES = 'playlist-modify-private playlist-modify-public';
const REDIRECT_URI = location.origin + location.pathname;
const STORAGE = {
  client: 't2s_client_id', token: 't2s_tokens', verifier: 't2s_pkce_verifier',
  state: 't2s_oauth_state', redirect: 't2s_oauth_redirect', draft: 't2s_draft'
};
const state = {
  tokens: null, profile: null, rows: [], currentFilter: 'all', searching: false,
  creating: false, cancel: false, playlist: null, addedCount: 0
};
const example = [
  'Limp Bizkit — Nookie', 'Korn — Freak on a Leash', 'Slipknot — Wait and Bleed',
  'Incubus — Pardon Me', 'Placebo — Every You Every Me'
].join('\n');

function readJson(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}
function saveDraft() {
  try { sessionStorage.setItem(STORAGE.draft, JSON.stringify({
    name: $('playlistName').value, description: $('playlistDescription').value,
    songs: $('songs').value, isPublic: $('isPublic').checked
  })); } catch { /* Storage can be blocked, which is fine. */ }
}
function loadDraft() {
  const draft = readJson(STORAGE.draft);
  if (!draft) return;
  $('playlistName').value = draft.name || '';
  $('playlistDescription').value = draft.description || '';
  $('songs').value = draft.songs || '';
  $('isPublic').checked = !!draft.isPublic;
}
function setNotice(message, kind = '') {
  const notice = $('notice');
  notice.textContent = message;
  notice.className = 'notice' + (kind ? ' ' + kind : '');
  notice.hidden = !message;
}
function updateLineCount() {
  const count = parseLines($('songs').value).length;
  $('lineCount').textContent = `${count} ${plural(count, 'песня', 'песни', 'песен')}`;
}
function plural(num, one, few, many) {
  if (num % 10 === 1 && num % 100 !== 11) return one;
  if (num % 10 >= 2 && num % 10 <= 4 && (num % 100 < 12 || num % 100 > 14)) return few;
  return many;
}
function encodeBytes(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return encodeBytes(new Uint8Array(digest));
}
function newSecret(bytes = 48) { return encodeBytes(crypto.getRandomValues(new Uint8Array(bytes))); }
function clientId() { return $('clientId').value.trim(); }
function validateClientId() {
  if (!/^[a-zA-Z0-9]{20,64}$/.test(clientId())) {
    setNotice('Вставь действительный Spotify Client ID из Developer Dashboard.', 'warning');
    $('clientId').focus();
    return false;
  }
  return true;
}
async function connect() {
  if (!validateClientId()) return;
  localStorage.setItem(STORAGE.client, clientId());
  saveDraft();
  const verifier = newSecret();
  const authState = newSecret(20);
  sessionStorage.setItem(STORAGE.verifier, verifier);
  sessionStorage.setItem(STORAGE.state, authState);
  sessionStorage.setItem(STORAGE.redirect, REDIRECT_URI);
  const params = new URLSearchParams({
    client_id: clientId(), response_type: 'code', redirect_uri: REDIRECT_URI,
    scope: SCOPES, state: authState, code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier)
  });
  location.assign(`${AUTH_URL}?${params}`);
}
function setTokens(data) {
  state.tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || (state.tokens && state.tokens.refresh_token),
    expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000) - 60000
  };
  sessionStorage.setItem(STORAGE.token, JSON.stringify(state.tokens));
}
async function requestToken(payload) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || `Ошибка входа: ${response.status}`);
  setTokens(data);
}
async function finishCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) return;
  url.searchParams.delete('code'); url.searchParams.delete('error'); url.searchParams.delete('state');
  history.replaceState({}, '', url.toString());
  if (error) { setNotice('Spotify отказал в доступе: ' + error, 'error'); return; }
  const expectedState = sessionStorage.getItem(STORAGE.state);
  const callbackState = new URLSearchParams(window.__callbackSearch || '').get('state');
  const verifier = sessionStorage.getItem(STORAGE.verifier);
  const redirect = sessionStorage.getItem(STORAGE.redirect);
  if (!expectedState || !callbackState || callbackState !== expectedState || !verifier || redirect !== REDIRECT_URI) {
    setNotice('Сессия подключения устарела или проверка безопасности не прошла. Подключи Spotify заново.', 'error');
    return;
  }
  sessionStorage.removeItem(STORAGE.state);
  sessionStorage.removeItem(STORAGE.verifier);
  sessionStorage.removeItem(STORAGE.redirect);
  try {
    await requestToken({ client_id: clientId(), grant_type: 'authorization_code', code,
      redirect_uri: REDIRECT_URI, code_verifier: verifier });
    setNotice('Spotify подключён. Вставь список песен и запускай поиск.');
  } catch (e) { setNotice('Ошибка авторизации: ' + e.message, 'error'); }
}
async function refreshTokens() {
  if (!state.tokens?.refresh_token) throw new Error('Нужно заново подключить Spotify.');
  await requestToken({ grant_type: 'refresh_token', refresh_token: state.tokens.refresh_token,
    client_id: clientId() });
}
async function accessToken() {
  if (!state.tokens?.access_token) throw new Error('Сначала подключи Spotify.');
  if (Date.now() >= state.tokens.expires_at) await refreshTokens();
  return state.tokens.access_token;
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function spotify(path, options = {}, attempt = 0) {
  const token = await accessToken();
  const res = await fetch(API_ROOT + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  if (res.status === 401 && attempt < 1) { await refreshTokens(); return spotify(path, options, attempt + 1); }
  if (res.status === 429 && attempt < 4) {
    const header = Number(res.headers.get('Retry-After'));
    const delay = Number.isFinite(header) && header >= 0 ? Math.min(header * 1000, 60000) : Math.min(2000 * (2 ** attempt), 30000);
    setNotice(`Spotify ограничил частоту запросов. Повтор через ${Math.ceil(delay / 1000)} сек.`, 'warning');
    await sleep(delay);
    if (state.cancel) throw new Error('Поиск остановлен.');
    return spotify(path, options, attempt + 1);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const info = data?.error?.message || data?.error_description || (typeof data?.error === 'string' ? data.error : '') || `HTTP ${res.status}`;
    if (res.status === 403) throw new Error(`Spotify запретил запрос (403): ${info}. Проверь Premium, User Management и разрешения приложения.`);
    throw new Error(`Spotify: ${info}`);
  }
  return data;
}
function stripMarkup(text) { return text.replace(/\[(.*?)\]\([^)]*\)/g, '$1').replace(/\*\*|__/g, '').trim(); }
function parseLines(value) {
  const dedup = new Set();
  return value.split(/\r?\n/).map(raw => stripMarkup(raw).replace(/^\s*(?:\d{1,3}[.)]|[-*•])\s+/, '').trim())
    .filter(Boolean).map(line => {
      const direct = line.match(/(?:open\.spotify\.com\/track\/|spotify:track:)([A-Za-z0-9]{22})/);
      if (direct) return { original: line, id: direct[1], artist: '', song: '' };
      const split = line.match(/^(.+?)\s*[—–]\s*(.+)$/) || line.match(/^(.+?)\s+[-|]\s+(.+)$/) || line.match(/^(.+?)\t+(.+)$/);
      return { original: line, id: null, artist: split ? split[1].trim() : '', song: split ? split[2].trim() : line };
    }).filter(row => {
      const key = row.original.toLowerCase();
      if (dedup.has(key)) return false;
      dedup.add(key);
      return true;
    });
}
function clean(str) {
  return (str || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\((feat|ft|featuring|with|prod|remaster|remastered|radio edit)[^)]*\)/gi, ' ')
    .replace(/\[(feat|ft|featuring|with|prod|remaster|remastered|radio edit)[^\]]*\]/gi, ' ')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/i, ' ')
    .replace(/\s*[-–—]?\s*(?:\d{4}\s*)?(?:remastered?|radio edit|album version|original mix)(?:\s+\d{4})?\s*$/i, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function similarity(a, b) {
  a = clean(a); b = clean(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j-1]+1, prev[j]+1, prev[j-1]+(a[i-1] === b[j-1]?0:1));
    prev = next;
  }
  const dist = prev[b.length];
  const levenshtein = Math.max(0, 1 - dist / Math.max(a.length, b.length));
  const aWords = a.split(' '), bWords = new Set(b.split(' '));
  const overlap = aWords.filter(w => bWords.has(w)).length / Math.max(aWords.length, bWords.size);
  return 0.6 * levenshtein + 0.4 * overlap;
}
// Compare full song names, shortened beginnings, and partially typed words.
function looseSimilarity(input, candidate) {
  const wanted = clean(input), full = clean(candidate);
  if (!wanted || !full) return 0;
  if (wanted === full) return 1;
  const words = wanted.split(' ');
  if (full.startsWith(wanted + ' ')) return words.length >= 2 ? .96 : .87;
  // Handles partial last words: "No Sur" -> "No Surprises".
  if (full.startsWith(wanted) && wanted.length >= 5) return .90;
  const fullWords = full.split(' ');
  if (words.length <= fullWords.length &&
      words.every((word, i) => word.length >= 3 && fullWords[i].startsWith(word))) return .88;
  return similarity(wanted, full);
}

function score(row, track) {
  const artists = track.artists || [];
  let result;
  if (row.artist) {
    const titleScore = looseSimilarity(row.song, track.name);
    const artistScore = Math.max(0, ...artists.map(a => looseSimilarity(row.artist, a.name)));
    result = (.64 * titleScore + .36 * artistScore) * 100;
    // An artist mismatch must not win just because the song title is common.
    if (artistScore < .56) result = Math.min(result, 55);
    if (titleScore < .49) result = Math.min(result, 55);
  } else {
    // A line without a separator can still work: "Oasis Wonderwall".
    const titleScore = looseSimilarity(row.song || row.original, track.name);
    const combinedScore = Math.max(0, ...artists.map(a =>
      looseSimilarity(row.song || row.original, a.name + ' ' + track.name)));
    result = Math.max(titleScore, combinedScore) * 100;
  }
  if (/live|karaoke|tribute|cover/i.test(track.name) && !/live|karaoke|tribute|cover/i.test(row.song)) result -= 14;
  if (/remaster/i.test(track.name) && !/remaster/i.test(row.song)) result -= 4;
  return Math.min(100, Math.max(0, Math.round(result)));
}

function normalizeTracks(raw, row) {
  return (raw || []).filter(track => track && track.uri && track.type === 'track')
    .map(track => ({ track, confidence: score(row, track) }))
    .sort((a, b) => b.confidence - a.confidence);
}

async function getCandidates(row, custom = '') {
  if (row.id && !custom) {
    const track = await spotify('/tracks/' + encodeURIComponent(row.id));
    return [{ track, confidence: 100 }];
  }
  const search = async (query) => {
    const params = new URLSearchParams({ q: query, type: 'track', limit: '10' });
    const result = await spotify('/search?' + params.toString());
    return normalizeTracks(result.tracks?.items || [], row);
  };
  // Start precise and broaden the query if Spotify doesn't return a confident match.
  // This lets "Placebo — Every You" find "Every You Every Me".
  const queries = custom ? [custom] : row.artist ? [
    `track:"${row.song.replace(/"/g, '')}" artist:"${row.artist.replace(/"/g, '')}"`,
    `${row.artist} ${row.song}`,
    `${row.song} ${row.artist}`
  ] : [row.song];
  const unique = new Map();
  for (const query of [...new Set(queries.filter(Boolean))]) {
    for (const candidate of await search(query)) {
      const id = candidate.track.id || candidate.track.uri;
      if (!unique.has(id) || candidate.confidence > unique.get(id).confidence) unique.set(id, candidate);
    }
    const best = [...unique.values()].sort((a,b) => b.confidence - a.confidence);
    if (best.length && best[0].confidence >= 91) break;
  }
  return [...unique.values()].sort((a,b) => b.confidence - a.confidence).slice(0, 10);
}

function isPartialMatch(row, track) {
  const requested = clean(row.song || row.original);
  if (row.artist) {
    const actual = clean(track.name);
    return actual !== requested && actual.startsWith(requested) && requested.length >= 4;
  }
  return (track.artists || []).some(a => {
    const actual = clean(a.name + ' ' + track.name);
    return actual !== requested && actual.startsWith(requested) && requested.length >= 4;
  });
}
function setSearching(value) {
  state.searching = value;
  $('findButton').disabled = value || state.creating;
  $('cancelButton').hidden = !value;
  $('createButton').disabled = value || state.creating || !!state.playlist || !selectedRows().length;
}
function setProgress(current, total) {
  $('progressOuter').hidden = false;
  $('progressBar').style.width = `${(total ? current / total : 0) * 100}%`;
  $('progressText').textContent = `Обработано ${current} из ${total} ${plural(total, 'песни', 'песен', 'песен')}.`;
}
async function findSongs() {
  if (state.searching || state.creating) return;
  if (!state.tokens?.access_token) { setNotice('Сначала подключи Spotify через блок «Подключение Spotify».', 'warning'); $('clientId').focus(); return; }
  const parsed = parseLines($('songs').value);
  if (!parsed.length) { setNotice('Добавь хотя бы одну песню в поле списка.', 'warning'); $('songs').focus(); return; }
  if (parsed.length > 500) { setNotice('В первой версии поддерживается до 500 песен за один поиск.', 'warning'); return; }
  state.cancel = false;
  state.rows = parsed.map((entry, i) => ({ ...entry, index: i, candidates: [], chosen: null, expanded: false, manual: false, done: false, error: '' }));
  state.playlist = null; state.addedCount = 0;
  $('successSection').hidden = true;
  $('resultsSection').hidden = false;
  $('results').textContent = '';
  setNotice('');
  setSearching(true);
  setProgress(0, state.rows.length);
  for (let i = 0; i < state.rows.length; i++) {
    if (state.cancel) break;
    const row = state.rows[i];
    try {
      row.candidates = await getCandidates(row);
      row.chosen = row.candidates.length && row.candidates[0].confidence >= 62 ? row.candidates[0].track : null;
    } catch (e) {
      row.error = e.message;
      if (/403|401|Premium/i.test(e.message)) { state.cancel = true; setNotice(e.message, 'error'); }
    }
    row.done = true;
    setProgress(i + 1, state.rows.length);
    renderResults();
    if (!state.cancel) await sleep(130);
  }
  if (state.cancel && !state.rows.every(r => r.done)) setNotice('Поиск остановлен. Уже найденные песни можно проверить и сохранить.', 'warning');
  else if (!state.rows.every(r => !r.error)) setNotice('Часть песен не удалось проверить. Можно поискать их вручную.', 'warning');
  else setNotice('Поиск закончен. Проверь результаты перед созданием плейлиста.');
  setSearching(false);
  renderResults();
  $('resultsSection').scrollIntoView({ behavior:'smooth', block:'start' });
}
function selectedRows() { return state.rows.filter(r => r.chosen?.uri); }
function rowStatus(row) {
  if (!row.done) return 'review';
  if (!row.chosen) return 'missing';
  const selected = row.candidates.find(e => e.track.uri === row.chosen.uri);
  if (isPartialMatch(row, row.chosen)) return 'review';
  const ambiguous = row.candidates.some(other => other.track.uri !== row.chosen.uri &&
    clean(other.track.name) !== clean(row.chosen.name) &&
    other.confidence >= (selected?.confidence || 0) - 4);
  return selected?.confidence >= 82 && !ambiguous ? 'ok' : 'review';
}
function cover(track, size) {
  const img = track?.album?.images?.[track.album.images.length - 1]?.url;
  if (!img) { const div = document.createElement('div'); div.className = 'cover placeholder'; div.textContent = '♫'; return div; }
  const el = document.createElement('img'); el.className='cover'; el.src=img; el.alt=''; el.loading='lazy';
  if (size) { el.width=size; el.height=size; }
  return el;
}
function elem(tag, cls, text) {
  const item = document.createElement(tag);
  if (cls) item.className = cls;
  if (text !== undefined) item.textContent = text;
  return item;
}
function makeButton(text, fn, cls='tiny-link') {
  const b=elem('button',cls,text); b.type='button'; b.addEventListener('click',fn); return b;
}
function renderResults() {
  const matched = state.rows.filter(r => r.chosen).length;
  const reviewed = state.rows.filter(r => rowStatus(r) === 'review' && r.done).length;
  const missing = state.rows.filter(r => r.done && !r.chosen).length;
  $('stats').textContent = '';
  for (const [label, value, cls] of [['Выбрано',matched,'ok'],['Проверить',reviewed,'review'],['Без совпадения',missing,'missing']]) {
    const el=elem('div','stat '+cls); el.append(elem('strong','',value),elem('span','',label)); $('stats').append(el);
  }
  $('selectedCount').textContent = `${matched} ${plural(matched,'песня выбрана','песни выбраны','песен выбрано')}`;
  $('createButton').disabled = state.searching || state.creating || !!state.playlist || matched === 0;
  const results = $('results'); results.textContent = '';
  const frag = document.createDocumentFragment();
  for (const row of state.rows) {
    const status = rowStatus(row);
    if (state.currentFilter === 'review' && status !== 'review') continue;
    if (state.currentFilter === 'missing' && status !== 'missing') continue;
    const wrapper = elem('div', 'result');
    wrapper.append(elem('div','result-index',String(row.index+1).padStart(2,'0')));
    const body=elem('div','result-body');
    body.append(elem('div','original',row.original));
    const match=elem('div','match');
    match.append(cover(row.chosen));
    const meta=elem('div','songmeta');
    meta.append(elem('strong','',row.chosen ? row.chosen.name : (row.done ? 'Совпадение не выбрано' : 'Ищем…')));
    meta.append(elem('small','',row.chosen ? row.chosen.artists.map(a=>a.name).join(', ') + ' · ' + (row.chosen.album?.name || 'Альбом не указан') : (row.error || (row.done ? 'Можно поискать вручную' : ''))));
    match.append(meta);
    match.append(elem('span','tag '+status,status === 'ok' ? 'НАЙДЕНО' : status === 'review' ? 'ПРОВЕРИТЬ' : 'НЕ НАЙДЕНО'));
    body.append(match);
    const actions = elem('div','result-actions');
    if (row.chosen?.external_urls?.spotify) {
      const link=elem('a','spotify-link','Слушать ↗'); link.href=row.chosen.external_urls.spotify;
      link.target='_blank'; link.rel='noopener noreferrer'; actions.append(link);
      actions.append(makeButton('Убрать',()=>{ row.chosen=null; renderResults(); }));
    }
    if (row.candidates.length) actions.append(makeButton(row.expanded?'Скрыть варианты':'Другие версии',()=>{ row.expanded=!row.expanded; renderResults(); }));
    actions.append(makeButton(row.manual?'Скрыть ручной поиск':'Искать вручную',()=>{ row.manual=!row.manual; renderResults(); }));
    body.append(actions);
    if (row.expanded && row.candidates.length) {
      const options = elem('div','options');
      for (const candidate of row.candidates) {
        const choice = elem('button','option'); choice.type='button';
        choice.append(cover(candidate.track,35));
        const info=elem('div','songmeta');
        info.append(elem('strong','',candidate.track.name));
        info.append(elem('small','',candidate.track.artists.map(a=>a.name).join(', ') + ' · ' + (candidate.track.album?.name || '')));
        choice.append(info);
        choice.append(elem('span','option-check',row.chosen?.uri === candidate.track.uri ? '✓ Выбрано' : `${candidate.confidence}%`));
        choice.addEventListener('click',()=>{ row.chosen=candidate.track; row.expanded=false; renderResults(); });
        options.append(choice);
      }
      body.append(options);
    }
    if (row.manual) {
      const manual=elem('form','manual');
      const input=elem('input'); input.type='text'; input.placeholder='Артист и название песни'; input.value=row.artist ? row.song+' '+row.artist : row.song;
      input.setAttribute('aria-label','Запрос для ручного поиска');
      manual.append(input);
      const btn=makeButton('Искать',()=>{},'secondary'); btn.type='submit'; manual.append(btn);
      manual.addEventListener('submit',async event=>{
        event.preventDefault();
        if (!input.value.trim()) return;
        btn.disabled=true; btn.textContent='Ищем…';
        try {
          row.candidates=await getCandidates(row,input.value.trim());
          row.expanded=true;
          if (!row.candidates.length) setNotice('По этому запросу ничего не нашлось. Попробуй другое написание.', 'warning');
          else setNotice('Выбери нужную версию песни из найденных вариантов.');
        } catch(e) { setNotice(e.message,'error'); }
        renderResults();
      });
      body.append(manual);
    }
    wrapper.append(body); frag.append(wrapper);
  }
  results.append(frag);
}
function updateAccount() {
  const account=$('account'); account.textContent='';
  if (state.tokens?.access_token) {
    account.append(elem('b','',state.profile?.display_name || 'Spotify подключён'));
    account.append(makeButton('Выйти',()=>{
      state.tokens=null; state.profile=null; sessionStorage.removeItem(STORAGE.token); updateAccount();
      setNotice('Локальная сессия завершена. Чтобы подключиться снова, нажми «Подключить Spotify».');
    }));
    $('connectButton').textContent = 'Переподключить Spotify ↗';
  } else {
    account.append(elem('span','small-muted','Не подключён'));
    $('connectButton').textContent = 'Подключить Spotify ↗';
  }
}
async function loadProfile() {
  if (!state.tokens?.access_token) return;
  try { state.profile=await spotify('/me'); }
  catch(e) { setNotice(e.message, 'error'); }
  updateAccount();
}
async function createPlaylist() {
  if (state.creating || state.searching || state.playlist) return;
  const chosen=selectedRows();
  const name=$('playlistName').value.trim();
  if (!name) { setNotice('Введи название плейлиста.', 'warning'); $('playlistName').focus(); return; }
  if (!chosen.length) { setNotice('Нет выбранных песен. Проверь результаты поиска.', 'warning'); return; }
  state.creating=true;
  $('createButton').disabled=true;
  $('findButton').disabled=true;
  $('createButton').textContent='Создаём…';
  try {
    const payload={ name, description:$('playlistDescription').value.trim(), public:$('isPublic').checked };
    const playlist=await spotify('/me/playlists',{method:'POST',body:JSON.stringify(payload)});
    state.playlist=playlist;
    state.playlistUris=chosen.map(row=>row.chosen.uri);
    state.addedCount=0;
    $('successSection').hidden=false;
    $('playlistLink').href=playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${playlist.id}`;
    $('successTitle').textContent='Плейлист создан';
    $('successText').textContent='Добавляем треки…';
    $('retryAddButton').hidden=true;
    await addRemainingTracks();
  } catch(e) { setNotice((state.playlist ? 'Плейлист уже создан, но возникла ошибка: ' : 'Не получилось создать плейлист: ')+e.message,'error'); }
  finally { state.creating=false; $('findButton').disabled=false; $('createButton').textContent='Создать плейлист →'; renderResults(); }
}
async function addRemainingTracks() {
  if (!state.playlist) return;
  const uris = state.playlistUris || [];
  const link=$('playlistLink'); link.href=state.playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${state.playlist.id}`;
  try {
    for (let i=state.addedCount;i<uris.length;i+=100) {
      const batch=uris.slice(i,i+100);
      await spotify(`/playlists/${encodeURIComponent(state.playlist.id)}/items`,{
        method:'POST', body:JSON.stringify({ uris:batch })
      });
      state.addedCount=i+batch.length;
      $('successText').textContent=`Добавлено ${state.addedCount} из ${uris.length} песен…`;
    }
    $('successTitle').textContent='Готово!';
    $('successText').textContent=`В плейлист «${state.playlist.name}» добавлено ${uris.length} ${plural(uris.length,'песня','песни','песен')}.`;
    $('retryAddButton').hidden=true;
    setNotice('Плейлист готов и открыт для прослушивания в Spotify.');
    $('successSection').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e) {
    $('successTitle').textContent='Плейлист создан, но не все треки добавлены';
    $('successText').textContent=`Успели добавить ${state.addedCount} из ${uris.length}. ${e.message}`;
    $('retryAddButton').hidden=false;
    setNotice('Плейлист уже существует в Spotify. Не создавай повторный: можно повторить добавление.', 'warning');
    $('successSection').scrollIntoView({behavior:'smooth',block:'start'});
  }
}
async function retryAdd() {
  if (!state.playlist || state.creating) return;
  state.creating=true; $('retryAddButton').disabled=true;
  await addRemainingTracks();
  state.creating=false; $('retryAddButton').disabled=false;
}
async function init() {
  // Preserve callback state BEFORE removing sensitive query params from history.
  window.__callbackSearch = location.search;
  $('redirectUri').textContent=REDIRECT_URI;
  $('clientId').value=localStorage.getItem(STORAGE.client)||'';
  state.tokens=readJson(STORAGE.token);
  loadDraft(); updateLineCount(); updateAccount();
  $('copyRedirect').addEventListener('click',async()=>{
    try { await navigator.clipboard.writeText(REDIRECT_URI); $('copyRedirect').textContent='✓'; setTimeout(()=>$('copyRedirect').textContent='⧉',1300); }
    catch { setNotice('Не удалось скопировать автоматически — выдели адрес и скопируй вручную.', 'warning'); }
  });
  $('clientId').addEventListener('change',()=>localStorage.setItem(STORAGE.client,clientId()));
  $('connectButton').addEventListener('click',()=>connect().catch(e=>setNotice('Ошибка подключения: '+e.message,'error')));
  $('exampleButton').addEventListener('click',()=>{ $('songs').value=example; updateLineCount(); saveDraft(); $('songs').focus(); });
  $('clearButton').addEventListener('click',()=>{ $('songs').value=''; updateLineCount(); saveDraft(); $('songs').focus(); });
  for(const id of ['songs','playlistName','playlistDescription','isPublic']) {
    $(id).addEventListener('input',()=>{
      updateLineCount();saveDraft();
      if (id === 'songs' && !state.searching && !state.creating && !state.playlist && state.rows.length) {
        state.rows=[]; $('resultsSection').hidden=true;
        setNotice('Список изменён. Нажми «Найти песни», чтобы проверить обновлённый список.');
      }
    });
    $(id).addEventListener('change',saveDraft);
  }
  $('fileInput').addEventListener('change',async(e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    if(file.size > 2_000_000) {setNotice('Файл слишком большой (лимит 2 МБ).','warning');return;}
    try { $('songs').value=await file.text(); updateLineCount(); saveDraft(); if (!state.playlist) {state.rows=[];$('resultsSection').hidden=true;} setNotice('Файл загружен. Проверь список перед поиском.'); }
    catch(err){setNotice('Не удалось прочитать файл: '+err.message,'error');}
    e.target.value='';
  });
  $('findButton').addEventListener('click',()=>findSongs().catch(e=>{state.searching=false;setSearching(false);setNotice(e.message,'error');}));
  $('cancelButton').addEventListener('click',()=>{state.cancel=true;$('cancelButton').disabled=true;setTimeout(()=>$('cancelButton').disabled=false,1000);});
  $('createButton').addEventListener('click',createPlaylist);
  $('retryAddButton').addEventListener('click',retryAdd);
  document.querySelectorAll('.chip').forEach(chip=>chip.addEventListener('click',()=>{
    document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active'); state.currentFilter=chip.dataset.filter; renderResults();
  }));
  await finishCallback();
  await loadProfile();
  setSearching(false);
}
init().catch(e=>setNotice('Ошибка запуска: '+e.message,'error'));
