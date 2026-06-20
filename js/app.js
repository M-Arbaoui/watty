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
const WATCHY_URL    = 'https://watchy-dot.vercel.app/#/title';

/* ── Embed sources for the inline player ── */
const SOURCES = {
  vidsrc:    { movie:id=>`https://vidsrc.to/embed/movie/${id}`,        tv:(id,s,e)=>`https://vidsrc.to/embed/tv/${id}/${s}/${e}` },
  vidking:   { movie:id=>`https://www.vidking.net/embed/movie/${id}`,  tv:(id,s,e)=>`https://www.vidking.net/embed/tv/${id}/${s}/${e}` },
  vidsrcxyz: { movie:id=>`https://vidsrc.xyz/embed/movie?tmdb=${id}`,  tv:(id,s,e)=>`https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${s}&episode=${e}` },
  embed2:    { movie:id=>`https://www.2embed.cc/embed/${id}`,         tv:(id,s,e)=>`https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}` },
};
let currentSource = 'vidsrc';

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
  /* WebRTC */
  pc:null,          // RTCPeerConnection
  localStream:null, // Host's getDisplayMedia stream
  remoteStream:null,// Guest receives this
  rtcReady:false,   // true once P2P connected
  sharingActive:false,
};
const genCode = () => Math.random().toString(36).substring(2,8).toUpperCase();

/* Supabase Realtime websocket */
function connectWS(roomCode, onMsg){
  return new Promise(resolve=>{
    const wsUrl=`${SUPABASE_URL.replace('https','wss')}/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`;
    const ws=new WebSocket(wsUrl);
    const topic=`realtime:party:${roomCode}`;
    let joined=false;
    const sendQueue=[];

    const flushQueue=()=>{
      while(sendQueue.length){
        const msg=sendQueue.shift();
        ws.send(JSON.stringify(msg));
      }
    };

    ws.onopen=()=>{
      ws.send(JSON.stringify({
        topic, event:'phx_join',
        payload:{ config:{ broadcast:{self:false,ack:false}, presence:{key:''} } },
        ref: ++P.wsRef
      }));
    };
    ws.onmessage=e=>{
      let msg; try{ msg=JSON.parse(e.data); }catch(_){ return; }
      // Detect join confirmation
      if(msg.event==='phx_reply' && msg.payload?.status==='ok' && !joined){
        joined=true;
        flushQueue();
        resolve(channelObj);
      }
      onMsg(msg);
    };
    ws.onclose=()=>{
      if(P.room){
        partyStatus('🟡 Reconnecting…');
        setTimeout(()=>{
          connectWS(roomCode,onMsg).then(ch=>{
            P.channel=ch;
            partyStatus(P.isHost?'🟢 Host':'🟢 Guest');
            ch.send('join',{user:P.user,isHost:P.isHost});
          });
        },2000);
      }
    };
    ws.onerror=()=>{ partyStatus('🔴 Connection error'); };

    const channelObj={
      send:(event,payload)=>{
        const m={ topic, event:'broadcast', payload:{type:'broadcast',event,payload}, ref:++P.wsRef };
        if(joined) ws.send(JSON.stringify(m));
        else sendQueue.push(m);
      },
      close:()=>{ P.room=null; ws.close(); }
    };

    // Safety timeout in case phx_reply never arrives
    setTimeout(()=>{ if(!joined){ joined=true; flushQueue(); resolve(channelObj); } },2500);
  });
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
  $('nw-overview').textContent=(item.overview||'').slice(0,140)+'…';
  $('nw-info').style.display='flex';
}

function buildEmbedUrl(){ /* no-op — replaced by WebRTC */ }

function onChannelMsg(msg){
  if(msg.event!=='broadcast'||msg.payload?.type!=='broadcast') return;
  const {event,payload}=msg.payload;
  if(event==='join'){
    P.members[payload.user]={user:payload.user,isHost:payload.isHost};
    updateMembers();
    chatMsg('',`${payload.user} joined`,true);
    if(P.isHost&&P.item) setTimeout(()=>P.channel.send('sync',{item:P.item}),400);
    // If host is sharing and a guest just joined, send them the offer
    if(P.isHost && P.sharingActive && !payload.isHost){
      setTimeout(()=>startWebRTCOffer(), 800);
    }
  }
  if(event==='leave'){
    delete P.members[payload.user]; updateMembers();
    chatMsg('',`${payload.user} left`,true);
  }
  if(event==='chat') chatMsg(payload.user, payload.text, !!payload.sys);
  if(event==='reaction') spawnReaction(payload.emoji);
  if(event==='pick'){ loadPartyTitle(payload.item); chatMsg('',`${payload.by||'Someone'} picked: ${ttl(payload.item)}`,true); }
  if(event==='sync'&&!P.isHost) loadPartyTitle(payload.item);

  /* ── WebRTC signaling ── */
  // Guest: receives offer from host → answer it
  if(event==='webrtc-offer' && !P.isHost){
    handleWebRTCOffer(payload.sdp);
  }
  // Host: receives answer from guest
  if(event==='webrtc-answer' && P.isHost){
    handleWebRTCAnswer(payload.sdp);
  }
  // Both: exchange ICE candidates
  if(event==='ice-candidate'){
    handleICECandidate(payload.candidate);
  }
  // Guest: host stopped sharing
  if(event==='share-stopped'){
    setGuestStatus('disconnected');
    chatMsg('','Host stopped screen sharing',true);
  }
  // Host: guest requests stream (joined after host started sharing)
  if(event==='request-stream' && P.isHost && P.sharingActive){
    setTimeout(()=>startWebRTCOffer(), 500);
  }
}

async function createRoom(){
  const user=$('username-input').value.trim();
  if(!user){ toast('Enter your name'); return; }
  P.user=user; P.room=genCode(); P.isHost=true;
  P.members[user]={user,isHost:true};
  $('room-code-val').textContent=P.room;
  $('nw-empty-sub').textContent='Use the search icon above to pick something to watch';
  $('host-panel').style.display='flex';
  $('guest-panel').style.display='none';
  $('nw-empty').style.display='none';
  partyView('room'); partyStatus('🟡 Connecting…');
  updateMembers();
  chatMsg('','Room created — share the code!',true);
  P.channel=await connectWS(P.room,onChannelMsg);
  partyStatus('🟢 Host');
  P.channel.send('join',{user,isHost:true});
}

async function joinRoom(){
  const user=$('username-input').value.trim();
  const code=$('room-code-input').value.trim().toUpperCase();
  if(!user){ toast('Enter your name'); return; }
  if(code.length!==6){ toast('6-character code needed'); return; }
  P.user=user; P.room=code; P.isHost=false;
  P.members[user]={user,isHost:false};
  $('room-code-val').textContent=P.room;
  $('nw-empty-sub').textContent='Waiting for the host to pick something to watch';
  $('host-panel').style.display='none';
  $('guest-panel').style.display='flex';
  $('nw-empty').style.display='none';
  partyView('room'); partyStatus('🟡 Connecting…');
  updateMembers();
  chatMsg('','Joined — waiting for host…',true);
  P.channel=await connectWS(P.room,onChannelMsg);
  partyStatus('🟢 Guest');
  P.channel.send('join',{user,isHost:false});
  // If host is already sharing, request the stream
  setTimeout(()=>P.channel.send('request-stream',{user}),600);
}

function leaveRoom(){
  P.channel?.send('leave',{user:P.user});
  P.channel?.close(); P.channel=null;
  P.item=null; P.members={};
  stopSharing();
  cleanupPeerConnection();
  $('nw-empty').style.display='flex'; $('nw-info').style.display='none';
  partyView('lobby');
}

/* ══════════════════════════════════════════════════════
   WEBRTC — Screen mirroring via getDisplayMedia
   Signaling runs over the existing Supabase channel.
   Video/audio flows directly P2P (not through Supabase).
   ══════════════════════════════════════════════════════ */

/* STUN servers for ICE negotiation (free Google STUN) */
const RTC_CONFIG = {
  iceServers:[
    {urls:'stun:stun.l.google.com:19302'},
    {urls:'stun:stun1.l.google.com:19302'},
  ]
};

function createPeerConnection(){
  cleanupPeerConnection();
  const pc = new RTCPeerConnection(RTC_CONFIG);
  P.pc = pc;

  pc.onicecandidate = e=>{
    if(e.candidate){
      P.channel?.send('ice-candidate',{ candidate:e.candidate });
    }
  };

  pc.onconnectionstatechange = ()=>{
    const s = pc.connectionState;
    if(s==='connected'){
      P.rtcReady=true;
      if(P.isHost){
        setHostSharingUI(true);
        chatMsg('','Screen sharing started — guests can see your screen',true);
      } else {
        setGuestStatus('connected');
        chatMsg('','Live stream connected',true);
      }
    }
    if(s==='disconnected'||s==='failed'){
      P.rtcReady=false;
      if(!P.isHost) setGuestStatus('disconnected');
    }
  };

  // Guest: receive remote tracks from host
  pc.ontrack = e=>{
    P.remoteStream = e.streams[0];
    const vid = $('guest-video');
    if(vid){
      vid.srcObject = P.remoteStream;
      vid.play().catch(()=>{});
      showGuestPlayer(true);
    }
  };

  pc.onicegatheringstatechange = ()=>{
    if(P.isHost) setHostStatus(`ICE: ${pc.iceGatheringState}`);
  };

  return pc;
}

function cleanupPeerConnection(){
  if(P.pc){
    P.pc.ontrack=null;
    P.pc.onicecandidate=null;
    P.pc.onconnectionstatechange=null;
    P.pc.close();
    P.pc=null;
  }
  P.rtcReady=false;
}

/* ── HOST: start screen share ── */
async function startSharing(){
  if(!P.channel){ toast('Join a room first'); return; }
  if(!P.isHost){ toast('Only the host can share'); return; }

  try{
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video:{ width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:30} },
      audio:true,
    });
    P.localStream = stream;
    P.sharingActive = true;

    // Show host preview
    const preview = $('host-preview');
    if(preview){ preview.srcObject=stream; preview.play().catch(()=>{}); }

    // Build RTCPeerConnection and add tracks
    const pc = createPeerConnection();
    stream.getTracks().forEach(track=>{
      pc.addTrack(track, stream);
    });

    // If stream ends (user clicks browser "Stop sharing")
    stream.getVideoTracks()[0].onended = ()=>{
      stopSharing();
    };

    setHostStatus('Waiting for guest to connect…');
    startWebRTCOffer();

  } catch(err){
    if(err.name==='NotAllowedError'){
      toast('Screen share permission denied');
    } else {
      toast('Could not start screen share');
      console.error(err);
    }
  }
}

async function startWebRTCOffer(){
  if(!P.pc||!P.localStream) return;
  try{
    const offer = await P.pc.createOffer();
    await P.pc.setLocalDescription(offer);
    P.channel?.send('webrtc-offer',{ sdp: P.pc.localDescription });
    setHostStatus('Offer sent — waiting for guest…');
  } catch(err){
    console.error('Offer failed',err);
    toast('WebRTC offer failed');
  }
}

function stopSharing(){
  if(!P.sharingActive) return;
  P.sharingActive=false;
  // Stop all tracks
  P.localStream?.getTracks().forEach(t=>t.stop());
  P.localStream=null;
  // Tell guests
  P.channel?.send('share-stopped',{});
  cleanupPeerConnection();
  setHostSharingUI(false);
  setHostStatus('Not sharing');
  chatMsg('','Screen share stopped',true);
  // Clear preview
  const preview=$('host-preview');
  if(preview){ preview.srcObject=null; }
}

/* ── GUEST: handle offer, create answer ── */
async function handleWebRTCOffer(sdp){
  try{
    const pc = createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    P.channel?.send('webrtc-answer',{ sdp: pc.localDescription });
    setGuestStatus('connecting');
  } catch(err){
    console.error('Answer failed',err);
    setGuestStatus('error');
  }
}

/* ── HOST: handle answer ── */
async function handleWebRTCAnswer(sdp){
  try{
    if(P.pc && P.pc.signalingState!=='stable'){
      await P.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  } catch(err){
    console.error('Set remote description failed',err);
  }
}

/* ── Both: handle ICE candidate ── */
async function handleICECandidate(candidate){
  try{
    if(P.pc && candidate){
      await P.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch(err){
    // Non-fatal: ICE candidate may arrive before peer connection is ready
  }
}

/* ── UI helpers for WebRTC state ── */
function setHostStatus(msg){
  const el=$('host-status'); if(el) el.textContent=msg;
}
function setHostSharingUI(active){
  $('start-share-btn')?.style && ($('start-share-btn').style.display=active?'none':'flex');
  $('stop-share-btn')?.style && ($('stop-share-btn').style.display=active?'flex':'none');
  $('host-preview-wrap')?.style && ($('host-preview-wrap').style.display=active?'block':'none');
}
function setGuestStatus(state){
  const el=$('guest-status'); if(!el) return;
  const states={
    connecting:  {text:'Connecting to host…', cls:'status-connecting'},
    connected:   {text:'🟢 Live',              cls:'status-connected'},
    disconnected:{text:'🔴 Stream disconnected — waiting for host', cls:'status-disconnected'},
    error:       {text:'⚠️ Connection error',  cls:'status-error'},
  };
  const s=states[state]||states.disconnected;
  el.textContent=s.text;
  el.className='guest-status '+s.cls;
}
function showGuestPlayer(visible){
  const wrap=$('guest-player-wrap');
  const empty=$('guest-empty');
  if(wrap) wrap.style.display=visible?'block':'none';
  if(empty) empty.style.display=visible?'none':'flex';
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
        P.channel?.send('pick',{item,by:P.user});
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
    // Call our own serverless function — Gemini key stays server-side
    const res=await fetch('/api/mood',{
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ mood }),
    });
    if(!res.ok) throw new Error('api_fail');
    const params=await res.json();
    if(params.error) throw new Error('api_fail');

    const items=await fetchMoodResults(params);
    renderMoodResults(items, params.summary);
    if(items[0]?.backdrop_path){
      $('mood-bg').style.backgroundImage=`url(${imgB(items[0].backdrop_path)})`;
      $('mood-bg').classList.add('loaded');
    }
  } catch(err){
    // Fallback: basic genre/popularity discover without AI (works even if /api/mood is down)
    const fallback=await fallbackMoodSearch(mood);
    renderMoodResults(fallback.items, fallback.summary);
  } finally {
    setMoodLoading(false);
  }
}

/* Fallback without API — keyword matching */
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
  /* ── WebRTC share buttons ── */
  $('start-share-btn')?.addEventListener('click', startSharing);
  $('stop-share-btn')?.addEventListener('click',  stopSharing);

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
