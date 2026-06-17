/* ═══════════════════════════════════════════════
   Watchy. Companion — app.js
   Watch Party · Season Tracker · MoodPick
   ═══════════════════════════════════════════════ */
'use strict';

const SUPABASE_URL  = 'https://agctrvdyextirmhcegrw.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_vyUb1gEaszYOUQQuIa9yqw_7o3kPMzh';
const TMDB_KEY      = 'e79205984c6394afec4499019f32f679';
const TMDB_BASE     = 'https://api.themoviedb.org/3';
const TMDB_IMG      = 'https://image.tmdb.org/t/p';
const WATCHY_URL    = 'https://watchy-sec.vercel.app/#/title';

/* ── helpers ── */
const $   = id => document.getElementById(id);
const ttl = i  => i.title||i.name||'Untitled';
const yr  = i  => (i.release_date||i.first_air_date||'').slice(0,4);
const typ = i  => i.media_type||(i.first_air_date?'tv':'movie');
const imgP = p => p ? `${TMDB_IMG}/w342${p}` : null;
const imgB = p => p ? `${TMDB_IMG}/w1280${p}` : null;
const imgS = p => p ? `${TMDB_IMG}/w300${p}`  : null;

let _toast;
function toast(msg, dur=2400){
  const el=$('toast'); el.textContent=msg; el.classList.add('show');
  clearTimeout(_toast); _toast=setTimeout(()=>el.classList.remove('show'),dur);
}

/* ══════════════════════════════════════════════════════
   NAV / TAB ROUTING
══════════════════════════════════════════════════════ */
function switchTab(name){
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  $(`tab-${name}`)?.classList.add('active');
  document.querySelector(`.nav-tab[data-tab="${name}"]`)?.classList.add('active');
}

/* ══════════════════════════════════════════════════════
   TMDB
══════════════════════════════════════════════════════ */
async function tmdb(path, params={}){
  const url=new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key',TMDB_KEY);
  url.searchParams.set('language','en-US');
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  try{ const r=await fetch(url); if(!r.ok) throw 0; return r.json(); }
  catch(_){ return null; }
}

/* ══════════════════════════════════════════════════════
   WATCH PARTY
══════════════════════════════════════════════════════ */
const P = {
  room:null, user:null, isHost:false,
  channel:null, ws:null, wsRef:0, members:{}, item:null,
};
const genCode = () => Math.random().toString(36).substring(2,8).toUpperCase();

/* Supabase Realtime websocket */
function connectWS(roomCode, onMsg){
  const wsUrl=`${SUPABASE_URL.replace('https','wss')}/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`;
  const ws=new WebSocket(wsUrl);
  const topic=`realtime:party:${roomCode}`;
  ws.onopen=()=>{
    ws.send(JSON.stringify({
      topic, event:'phx_join',
      payload:{ config:{ broadcast:{self:false}, presence:{key:''} } },
      ref: ++P.wsRef
    }));
  };
  ws.onmessage=e=>{ try{ onMsg(JSON.parse(e.data)); }catch(_){} };
  ws.onclose=()=>{ if(P.room) setTimeout(()=>connectWS(roomCode,onMsg),3000); };
  return {
    send:(event,payload)=>ws.send(JSON.stringify({
      topic, event:'broadcast',
      payload:{type:'broadcast',event,payload},
      ref:++P.wsRef
    })),
    close:()=>{ P.room=null; ws.close(); }
  };
}

function partyView(name){
  document.querySelectorAll('.party-view').forEach(v=>v.classList.remove('active'));
  $(`party-${name}`)?.classList.add('active');
}
function partyStatus(msg){ $('room-status').textContent=msg; }

function updateMembers(){
  const list=Object.values(P.members);
  $('members-count').textContent=`${list.length} in room`;
  $('members-list').innerHTML=list.map(m=>`
    <div class="member-chip ${m.isHost?'host':''}">
      <div class="member-avatar">${m.user.slice(0,1).toUpperCase()}</div>
      ${m.user}${m.isHost?' ♛':''}
    </div>`).join('');
}

function chatMsg(user, text, sys=false){
  const el=$('chat-msgs');
  const row=document.createElement('div');
  row.className=`chat-msg${sys?' sys':''}`;
  if(sys) row.innerHTML=`<span class="chat-sys-text">${text}</span>`;
  else row.innerHTML=`<span class="chat-user ${user===P.user?'self':''}">${user}</span><span class="chat-text">${esc(text)}</span>`;
  el.appendChild(row);
  el.scrollTop=el.scrollHeight;
}
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function spawnReaction(emoji, self=false){
  const el=document.createElement('div');
  el.className='r-float';
  el.textContent=emoji;
  el.style.left=(8+Math.random()*84)+'%';
  if(self) el.style.filter='drop-shadow(0 0 6px rgba(201,169,110,.9))';
  $('reaction-stage').appendChild(el);
  el.addEventListener('animationend',()=>el.remove());
}

function loadPartyTitle(item){
  P.item=item;
  const bg=imgB(item.backdrop_path);
  if(bg){ $('nw-bg').style.backgroundImage=`url(${bg})`; }
  const poster=imgP(item.poster_path);
  $('nw-poster').src=poster||'';
  $('nw-poster').style.display=poster?'block':'none';
  $('nw-title').textContent=ttl(item);
  $('nw-meta').textContent=[yr(item), typ(item)==='tv'?'Series':'Movie'].join(' · ');
  $('nw-overview').textContent=(item.overview||'').slice(0,160)+'…';
  $('nw-empty').style.display='none';
  $('nw-info').style.display='flex';
  const url=typ(item)==='movie'
    ?`https://vidsrc.to/embed/movie/${item.id}`
    :`https://vidsrc.to/embed/tv/${item.id}/1/1`;
  $('watch-btn').dataset.url=url;
}

function onChannelMsg(msg){
  if(msg.event!=='broadcast'||msg.payload?.type!=='broadcast') return;
  const {event,payload}=msg.payload;
  if(event==='join'){
    P.members[payload.user]={user:payload.user,isHost:payload.isHost};
    updateMembers();
    chatMsg('',`${payload.user} joined`,true);
    if(P.isHost&&P.item) setTimeout(()=>P.channel.send('sync',{item:P.item}),400);
  }
  if(event==='leave'){
    delete P.members[payload.user]; updateMembers();
    chatMsg('',`${payload.user} left`,true);
  }
  if(event==='chat') chatMsg(payload.user,payload.text);
  if(event==='reaction') spawnReaction(payload.emoji);
  if(event==='pick'){ loadPartyTitle(payload.item); chatMsg('',`Host picked: ${ttl(payload.item)}`,true); }
  if(event==='sync'&&!P.isHost) loadPartyTitle(payload.item);
}

async function createRoom(){
  const user=$('username-input').value.trim();
  if(!user){ toast('Enter your name'); return; }
  P.user=user; P.room=genCode(); P.isHost=true;
  P.members[user]={user,isHost:true};
  P.channel=connectWS(P.room,onChannelMsg);
  $('room-code-val').textContent=P.room;
  partyView('room'); partyStatus('🟢 Host');
  updateMembers();
  chatMsg('','Room created — share the code!',true);
  P.channel.send('join',{user,isHost:true});
}

async function joinRoom(){
  const user=$('username-input').value.trim();
  const code=$('room-code-input').value.trim().toUpperCase();
  if(!user){ toast('Enter your name'); return; }
  if(code.length!==6){ toast('6-character code needed'); return; }
  P.user=user; P.room=code; P.isHost=false;
  P.members[user]={user,isHost:false};
  P.channel=connectWS(P.room,onChannelMsg);
  $('room-code-val').textContent=P.room;
  partyView('room'); partyStatus('🟢 Guest');
  updateMembers();
  chatMsg('','Joined — waiting for host…',true);
  P.channel.send('join',{user,isHost:false});
}

function leaveRoom(){
  P.channel?.send('leave',{user:P.user});
  P.channel?.close(); P.channel=null;
  P.item=null; P.members={};
  $('nw-empty').style.display='flex'; $('nw-info').style.display='none';
  partyView('lobby');
}

/* Party title search */
let _psd;
async function partySearch(q){
  clearTimeout(_psd);
  const res=$('ps-results');
  if(!q.trim()){ res.innerHTML=''; return; }
  _psd=setTimeout(async()=>{
    res.innerHTML='<div class="ps-loading">Searching…</div>';
    const d=await tmdb('/search/multi',{query:q});
    const items=(d?.results||[]).filter(i=>i.media_type!=='person').slice(0,7);
    res.innerHTML='';
    if(!items.length){ res.innerHTML='<div class="ps-loading">Nothing found.</div>'; return; }
    items.forEach(item=>{
      const poster=imgP(item.poster_path);
      const el=document.createElement('div'); el.className='ps-item';
      el.innerHTML=`
        ${poster?`<img src="${poster}" class="ps-poster" alt="">`:'<div class="ps-poster ps-ph"></div>'}
        <div><div class="ps-title">${ttl(item)}</div><div class="ps-meta">${yr(item)} · ${typ(item)==='tv'?'Series':'Movie'}</div></div>`;
      el.addEventListener('click',()=>{
        loadPartyTitle(item);
        P.channel?.send('pick',{item});
        $('party-search-input').value=''; res.innerHTML='';
        $('party-search-panel').classList.remove('open');
        toast(`Shared: ${ttl(item)}`);
      });
      res.appendChild(el);
    });
  },320);
}

/* ══════════════════════════════════════════════════════
   SEASON TRACKER
══════════════════════════════════════════════════════ */
const ST_KEY='wt_tracker';
const stLoad=()=>JSON.parse(localStorage.getItem(ST_KEY)||'{}');
const stSave=d=>localStorage.setItem(ST_KEY,JSON.stringify(d));
const stGet=id=>stLoad()[id]||null;
function stSet(id,data){ const d=stLoad(); d[id]=data; stSave(d); }
function stDel(id){ const d=stLoad(); delete d[id]; stSave(d); }

function trackerView(name){
  document.querySelectorAll('.tracker-view').forEach(v=>v.classList.remove('active'));
  $(`tracker-${name}`)?.classList.add('active');
}

function renderLibrary(){
  const data=stLoad();
  const shows=Object.values(data).sort((a,b)=>b.addedAt-a.addedAt);
  const grid=$('library-grid');
  const empty=$('library-empty');
  if(!shows.length){ grid.innerHTML=''; empty.style.display='flex'; return; }
  empty.style.display='none'; grid.innerHTML='';
  shows.forEach(s=>{
    const {meta,seasons}=s;
    const totalEps=Object.values(seasons).reduce((t,ss)=>t+ss.total,0);
    const watchedEps=Object.values(seasons).reduce((t,ss)=>t+ss.watched.length,0);
    const pct=totalEps?Math.round((watchedEps/totalEps)*100):0;
    const card=document.createElement('div'); card.className='show-card';
    card.innerHTML=`
      <div class="sc-img-w">
        ${meta.poster?`<img src="${meta.poster}" class="sc-img" alt="" loading="lazy">`:'<div class="sc-img sc-ph"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="3" width="20" height="14" rx="2"/></svg></div>'}
        <div class="sc-pct${pct===100?' done':''}">${pct}%</div>
      </div>
      <div class="sc-info">
        <div class="sc-name">${meta.name}</div>
        <div class="sc-meta">${watchedEps}/${totalEps} eps</div>
        <div class="sc-bar-wrap"><div class="sc-bar"><div class="sc-bar-fill" style="width:${pct}%"></div></div></div>
      </div>`;
    card.addEventListener('click',()=>openShowDetail(meta.id));
    grid.appendChild(card);
  });
}

async function addShow(item){
  if(stGet(item.id)){ toast('Already tracking!'); openShowDetail(item.id); return; }
  toast('Loading…');
  const d=await tmdb(`/tv/${item.id}`);
  if(!d) return;
  const seasons={};
  (d.seasons||[]).filter(s=>s.season_number>0).forEach(s=>{
    seasons[s.season_number]={ total:s.episode_count, watched:[], name:s.name, poster:s.poster_path };
  });
  stSet(item.id,{
    meta:{
      id:item.id, name:d.name,
      poster:imgP(d.poster_path), backdrop:imgB(d.backdrop_path),
      overview:d.overview, status:d.status,
      year:(d.first_air_date||'').slice(0,4), score:d.vote_average,
    },
    seasons, addedAt:Date.now(),
  });
  renderLibrary();
  openShowDetail(item.id);
  toast(`Added ${d.name}`);
}

function openShowDetail(id){
  const s=stGet(id); if(!s) return;
  const {meta,seasons}=s;
  if(meta.backdrop){ $('show-detail-bg').style.backgroundImage=`url(${meta.backdrop})`; $('show-detail-bg').classList.add('loaded'); }
  $('show-poster').src=meta.poster||''; $('show-poster').style.display=meta.poster?'block':'none';
  $('show-name').textContent=meta.name;
  $('show-year').textContent=[meta.year,meta.status].filter(Boolean).join(' · ');
  $('show-score').textContent=meta.score?meta.score.toFixed(1)+'★':'';
  $('show-overview').textContent=(meta.overview||'').slice(0,200)+((meta.overview?.length||0)>200?'…':'');
  const totalEps=Object.values(seasons).reduce((t,ss)=>t+ss.total,0);
  const watchedEps=Object.values(seasons).reduce((t,ss)=>t+ss.watched.length,0);
  const pct=totalEps?Math.round((watchedEps/totalEps)*100):0;
  $('show-total-progress').textContent=`${watchedEps} / ${totalEps} episodes · ${pct}%`;
  $('show-total-bar-fill').style.width=pct+'%';
  $('delete-show-btn').onclick=()=>{ if(confirm(`Remove ${meta.name}?`)){ stDel(id); renderLibrary(); trackerView('library'); } };
  $('tracker-back-btn').onclick=()=>trackerView('library');
  buildSeasons(id,seasons);
  trackerView('show');
}

function buildSeasons(showId,seasons){
  const el=$('seasons-list'); el.innerHTML='';
  Object.keys(seasons).map(Number).sort((a,b)=>a-b).forEach(sNum=>{
    const s=seasons[sNum];
    const pct=s.total?Math.round((s.watched.length/s.total)*100):0;
    const block=document.createElement('div'); block.className='season-block';
    block.innerHTML=`
      <div class="season-header">
        <div class="season-header-left">
          <div class="season-toggle">›</div>
          <div>
            <div class="season-name">Season ${sNum}</div>
            <div class="season-meta">${s.watched.length}/${s.total} episodes</div>
          </div>
        </div>
        <div class="season-actions">
          <button class="season-action-btn mark-all">✓ All</button>
          <button class="season-action-btn mark-none">✕</button>
          <div class="season-pct${pct===100?' done':''}">${pct}%</div>
        </div>
      </div>
      <div class="season-progress-bar"><div class="season-progress-fill" style="width:${pct}%"></div></div>
      <div class="eps-grid" id="eps-${showId}-${sNum}" style="display:none"></div>`;

    const toggle=block.querySelector('.season-toggle');
    const epsEl=block.querySelector('.eps-grid');
    block.querySelector('.season-header').addEventListener('click',async e=>{
      if(e.target.closest('.season-action-btn')) return;
      if(epsEl.style.display==='none'){
        epsEl.style.display='grid'; toggle.textContent='⌄'; toggle.classList.add('open');
        if(!epsEl.dataset.loaded){
          epsEl.innerHTML='<div class="ep-loading">Loading…</div>';
          const data=await tmdb(`/tv/${showId}/season/${sNum}`);
          epsEl.dataset.loaded='1';
          buildEpisodes(epsEl,showId,sNum,data?.episodes||[],stGet(showId)?.seasons[sNum]?.watched||[]);
        }
      } else {
        epsEl.style.display='none'; toggle.textContent='›'; toggle.classList.remove('open');
      }
    });

    block.querySelector('.mark-all').addEventListener('click',e=>{
      e.stopPropagation();
      const d=stLoad(); if(!d[showId]) return;
      d[showId].seasons[sNum].watched=Array.from({length:s.total},(_,i)=>i+1);
      stSave(d); openShowDetail(showId); renderLibrary(); toast(`Season ${sNum} complete ✓`);
    });
    block.querySelector('.mark-none').addEventListener('click',e=>{
      e.stopPropagation();
      const d=stLoad(); if(!d[showId]) return;
      d[showId].seasons[sNum].watched=[]; stSave(d); openShowDetail(showId); renderLibrary();
    });
    el.appendChild(block);
  });
}

function buildEpisodes(container,showId,season,episodes,watched){
  container.innerHTML='';
  episodes.forEach(ep=>{
    const isW=watched.includes(ep.episode_number);
    const still=imgS(ep.still_path);
    const el=document.createElement('div'); el.className=`ep-card${isW?' watched':''}`;
    el.innerHTML=`
      <div class="ep-still-w">
        ${still?`<img src="${still}" class="ep-still-img" alt="" loading="lazy">`:'<div class="ep-still-ph"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1"><path d="m7 8 4 3-4 3V8z"/></svg></div>'}
        <div class="ep-check">✓</div>
        <div class="ep-num-badge">E${ep.episode_number}</div>
      </div>
      <div class="ep-name">${ep.name||`Episode ${ep.episode_number}`}</div>`;
    el.addEventListener('click',()=>{
      const d=stLoad(); if(!d[showId]) return;
      const w=d[showId].seasons[season].watched;
      const idx=w.indexOf(ep.episode_number);
      if(idx>-1) w.splice(idx,1); else w.push(ep.episode_number);
      stSave(d);
      el.classList.toggle('watched');
      openShowDetail(showId); renderLibrary();
      // re-render just the episodes row so panel stays open
    });
    container.appendChild(el);
  });
}

/* Tracker search */
let _tsd;
async function trackerSearch(q){
  clearTimeout(_tsd);
  const res=$('tracker-search-results');
  if(!q.trim()){ res.innerHTML=''; return; }
  _tsd=setTimeout(async()=>{
    res.innerHTML='<div class="ts-loading">Searching…</div>';
    const d=await tmdb('/search/tv',{query:q});
    const items=(d?.results||[]).slice(0,7);
    res.innerHTML='';
    if(!items.length){ res.innerHTML='<div class="ts-loading">Nothing found.</div>'; return; }
    items.forEach(item=>{
      const poster=imgP(item.poster_path);
      const el=document.createElement('div'); el.className='ts-item';
      el.innerHTML=`
        ${poster?`<img src="${poster}" class="ts-poster" alt="">`:'<div class="ts-poster ts-ph"></div>'}
        <div>
          <div class="ts-title">${item.name||'Untitled'}</div>
          <div class="ts-meta">${(item.first_air_date||'').slice(0,4)} · ${item.number_of_seasons||'?'} seasons</div>
        </div>`;
      el.addEventListener('click',()=>{ addShow(item); $('tracker-search-input').value=''; res.innerHTML=''; $('add-drawer').classList.remove('open'); });
      res.appendChild(el);
    });
  },320);
}

/* ══════════════════════════════════════════════════════
   MOODPICK
══════════════════════════════════════════════════════ */
const SUGGESTIONS=[
  'Something dark and slow-paced like Arrival',
  'Cozy show to binge on a rainy weekend',
  'Mind-bending thriller like Inception',
  'Feel-good romance, not too cheesy',
  'Horror that\'s actually scary, not gory',
  'Anime series with a great story',
  'Something like Breaking Bad',
  'Classic action movies from the 80s',
  'Short documentary under 90 minutes',
  'Funny 90s movies to watch with friends',
];

function renderSuggestions(){
  const el=$('mood-suggestions');
  SUGGESTIONS.sort(()=>Math.random()-.5).slice(0,5).forEach(s=>{
    const btn=document.createElement('button'); btn.className='mood-pill'; btn.textContent=s;
    btn.addEventListener('click',()=>{ $('mood-input').value=s; runMoodSearch(); });
    el.appendChild(btn);
  });
}

async function runMoodSearch(){
  const mood=$('mood-input').value.trim();
  if(!mood){ $('mood-hint').textContent='Tell me what you\'re in the mood for.'; $('mood-hint').style.display='block'; return; }
  $('mood-hint').style.display='none';
  $('mood-results').style.display='none';
  setMoodLoading(true);

  try{
    const key=document.querySelector('meta[name="anthropic-key"]')?.content||'';
    if(!key||key==='YOUR_ANTHROPIC_KEY_HERE') throw new Error('no_key');

    // Ask Claude to parse mood into TMDB params
    const res=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-api-key':key,
        'anthropic-version':'2023-06-01',
        'anthropic-dangerous-direct-browser-access':'true',
      },
      body:JSON.stringify({
        model:'claude-sonnet-4-6',
        max_tokens:400,
        system:`You are a movie/TV recommendation engine. Extract TMDB discover params from the user's mood description.
Reply ONLY with valid JSON, no markdown.
Schema: { "type":"movie"|"tv"|"both", "genres":[ids], "sort_by":"popularity.desc"|"vote_average.desc", "vote_average_gte":number, "vote_count_gte":number, "decade_start":number, "decade_end":number, "summary":"1 sentence of what you understood" }
Genre IDs: action=28,adventure=12,animation=16,comedy=35,crime=80,documentary=99,drama=18,fantasy=14,horror=27,mystery=9648,romance=10749,sci-fi=878,thriller=53,war=10752,western=37`,
        messages:[{role:'user',content:mood}],
      }),
    });
    if(!res.ok) throw new Error('api_fail');
    const data=await res.json();
    const text=data.content.find(b=>b.type==='text')?.text||'{}';
    const params=JSON.parse(text.replace(/```json|```/g,'').trim());
    const items=await fetchMoodResults(params);
    renderMoodResults(items, params.summary);
    if(items[0]?.backdrop_path){
      $('mood-bg').style.backgroundImage=`url(${imgB(items[0].backdrop_path)})`;
      $('mood-bg').classList.add('loaded');
    }
  } catch(err){
    if(err.message==='no_key'){
      // Fallback: basic genre/popularity discover without AI
      const fallback=await fallbackMoodSearch(mood);
      renderMoodResults(fallback.items, fallback.summary);
    } else {
      $('mood-hint').textContent='Something went wrong. Try again.'; $('mood-hint').style.display='block';
    }
  } finally {
    setMoodLoading(false);
  }
}

/* Fallback without API key — keyword matching */
async function fallbackMoodSearch(mood){
  const m=mood.toLowerCase();
  let genres=[], type='movie', sort='vote_average.desc', gte=7;
  if(m.includes('horror')||m.includes('scary')) genres.push(27);
  if(m.includes('comedy')||m.includes('funny')||m.includes('laugh')) genres.push(35);
  if(m.includes('action')) genres.push(28);
  if(m.includes('romance')||m.includes('love')) genres.push(10749);
  if(m.includes('thriller')||m.includes('mind')) genres.push(53);
  if(m.includes('sci-fi')||m.includes('space')||m.includes('future')) genres.push(878);
  if(m.includes('documentary')) genres.push(99);
  if(m.includes('anime')) genres.push(16);
  if(m.includes('show')||m.includes('series')||m.includes('binge')) type='tv';
  if(!genres.length) genres=[18,28,878]; // drama/action/sci-fi default
  const params={type,genres,sort_by:sort,vote_average_gte:gte,vote_count_gte:200};
  const items=await fetchMoodResults(params);
  return{items,summary:'Based on your mood (tip: add your Anthropic key for smarter results)'};
}

async function fetchMoodResults(params){
  const type=params.type==='tv'?'tv':'movie';
  const url=new URL(`${TMDB_BASE}/discover/${type}`);
  url.searchParams.set('api_key',TMDB_KEY);
  url.searchParams.set('language','en-US');
  url.searchParams.set('sort_by',params.sort_by||'vote_average.desc');
  url.searchParams.set('vote_count.gte',params.vote_count_gte||200);
  if(params.genres?.length) url.searchParams.set('with_genres',params.genres.join(','));
  if(params.vote_average_gte) url.searchParams.set('vote_average.gte',params.vote_average_gte);
  if(params.decade_start){ url.searchParams.set(type==='movie'?'primary_release_date.gte':'first_air_date.gte',`${params.decade_start}-01-01`); }
  if(params.decade_end){ url.searchParams.set(type==='movie'?'primary_release_date.lte':'first_air_date.lte',`${params.decade_end}-12-31`); }
  const r=await fetch(url); const d=await r.json();
  return (d.results||[]).slice(0,12).map(i=>({...i,media_type:type}));
}

function renderMoodResults(items,summary){
  $('mood-ai-summary').textContent=summary||'';
  $('mood-ai-summary').style.display=summary?'block':'none';
  const grid=$('mood-grid'); grid.innerHTML='';
  if(!items.length){ grid.innerHTML='<div class="mood-empty">Nothing found — try rephrasing.</div>'; }
  items.forEach(item=>{
    const poster=imgP(item.poster_path);
    const score=item.vote_average?Math.round(item.vote_average*10)+'%':'';
    const card=document.createElement('div'); card.className='mood-card';
    card.innerHTML=`
      <div class="mc-img-w">
        ${poster?`<img src="${poster}" class="mc-img" alt="${ttl(item)}" loading="lazy">`:'<div class="mc-ph"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="m7 8 4 3-4 3V8z"/></svg></div>'}
        ${score?`<div class="mc-score">${score}</div>`:''}
        <div class="mc-type">${item.media_type==='tv'?'Series':'Movie'}</div>
      </div>
      <div class="mc-info">
        <div class="mc-title">${ttl(item)}</div>
        <div class="mc-year">${yr(item)}</div>
      </div>`;
    card.addEventListener('click',()=>window.open(`${WATCHY_URL}/${item.media_type}/${item.id}`,'_blank'));
    grid.appendChild(card);
  });
  $('mood-results').style.display='block';
}

function setMoodLoading(v){
  $('mood-search-btn').disabled=v;
  $('mood-search-btn').innerHTML=v
    ?`<div class="btn-spinner"></div> Thinking…`
    :`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg> Find It`;
  $('mood-loading-bar').style.display=v?'block':'none';
}

/* ══════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{

  /* Nav tabs */
  document.querySelectorAll('.nav-tab').forEach(btn=>{
    btn.addEventListener('click',()=>switchTab(btn.dataset.tab));
  });
  $('nav-home-btn').addEventListener('click',()=>switchTab('party'));

  /* ── PARTY ── */
  $('create-btn').addEventListener('click',createRoom);
  $('join-btn').addEventListener('click',joinRoom);
  $('leave-btn').addEventListener('click',leaveRoom);
  $('copy-code-btn').addEventListener('click',()=>{ navigator.clipboard?.writeText(P.room).then(()=>toast('Code copied!')); });
  $('watch-btn').addEventListener('click',()=>{ const url=$('watch-btn').dataset.url; if(url){ $('watch-overlay').classList.add('open'); $('watch-iframe').src=url; } });
  $('watch-overlay-close').addEventListener('click',()=>{ $('watch-overlay').classList.remove('open'); $('watch-iframe').src=''; });
  $('party-search-btn').addEventListener('click',()=>$('party-search-panel').classList.toggle('open'));
  $('party-search-input').addEventListener('input',e=>partySearch(e.target.value));
  $('chat-input').addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.shiftKey) return; e.preventDefault();
    const text=$('chat-input').value.trim(); if(!text) return;
    chatMsg(P.user,text); P.channel?.send('chat',{user:P.user,text}); $('chat-input').value='';
  });
  document.querySelectorAll('.emoji-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{ spawnReaction(btn.dataset.emoji,true); P.channel?.send('reaction',{emoji:btn.dataset.emoji,user:P.user}); });
  });
  $('username-input').addEventListener('keydown',e=>{ if(e.key==='Enter') createRoom(); });
  $('room-code-input').addEventListener('keydown',e=>{ if(e.key==='Enter') joinRoom(); });

  /* ── TRACKER ── */
  renderLibrary();
  $('add-show-btn').addEventListener('click',()=>{
    $('add-drawer').classList.toggle('open');
    if($('add-drawer').classList.contains('open')) setTimeout(()=>$('tracker-search-input').focus(),50);
  });
  $('tracker-search-input').addEventListener('input',e=>trackerSearch(e.target.value));

  /* ── MOODPICK ── */
  renderSuggestions();
  $('mood-search-btn').addEventListener('click',runMoodSearch);
  $('mood-input').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); runMoodSearch(); } });
});
