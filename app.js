const $=s=>document.querySelector(s);

let player=null;
let playerReady=false;
let currentVideoId="";
let currentOfflineId="";
let currentMediaType="";
let currentObjectUrl="";
let loopTimer=null;
let loopRestartTimer=null;
let loopActive=false;
let loopIteration=0;
let loopResumeAvailable=false;
let waiting=false;
let deferredInstallPrompt=null;
let activeScreen="edit";

const localPlayer=$("#localPlayer");

const store={
  get(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}},
  set(key,value){localStorage.setItem(key,JSON.stringify(value))}
};

const savedVideosInitial=store.get("ylp_saved_videos",[]);
const legacyRecent=store.get("ylp_recent",[]);
const state={
  presets:store.get("ylp_presets",[]),
  history:store.get("ylp_history",legacyRecent.map(r=>({
    videoId:r.videoId,
    url:"https://www.youtube.com/watch?v="+r.videoId,
    title:"YouTube video · "+r.videoId,
    playedAt:r.updatedAt||Date.now()
  }))),
  videos:savedVideosInitial,
  dark:store.get("ylp_dark",false)
};

function parseVideoId(input){
  const raw=String(input||"").trim();
  if(/^[a-zA-Z0-9_-]{11}$/.test(raw))return raw;
  try{
    const u=new URL(raw);
    if(u.hostname.includes("youtu.be"))return u.pathname.split("/").filter(Boolean)[0]||"";
    if(u.searchParams.get("v"))return u.searchParams.get("v");
    const parts=u.pathname.split("/").filter(Boolean);
    const marker=parts.findIndex(x=>["shorts","embed","live"].includes(x));
    if(marker>=0)return parts[marker+1]||"";
  }catch{}
  return "";
}

function parseTime(value){
  const v=String(value||"").trim().replace(",",".");
  if(!v)return 0;
  if(/^\d+(\.\d+)?$/.test(v))return Math.max(0,Number(v));
  const p=v.split(":").map(Number);
  if(p.some(Number.isNaN))return NaN;
  if(p.length===2)return Math.max(0,p[0]*60+p[1]);
  if(p.length===3)return Math.max(0,p[0]*3600+p[1]*60+p[2]);
  return NaN;
}

function formatTime(sec){
  sec=Math.max(0,Number(sec)||0);
  const rounded=Math.round(sec*10)/10;
  const whole=Math.floor(rounded),fraction=Math.round((rounded-whole)*10);
  const s=whole%60,m=Math.floor(whole/60)%60,h=Math.floor(whole/3600);
  const secText=String(s).padStart(2,"0")+(fraction?"."+fraction:"");
  return h?String(h)+":"+String(m).padStart(2,"0")+":"+secText:String(m)+":"+secText;
}

function formatBytes(bytes){
  const n=Number(bytes)||0;
  if(n<1024)return n+" B";
  if(n<1024*1024)return(n/1024).toFixed(1)+" KB";
  return(n/(1024*1024)).toFixed(1)+" MB";
}

function currentRange(){
  return{a:parseTime($("#startTime").value),b:parseTime($("#endTime").value)};
}

function updateRangeStatus(){
  const r=currentRange(),total=Math.max(1,Number($("#repeatCount").value)||1);
  $("#rangeStatus").textContent=Number.isFinite(r.a)&&Number.isFinite(r.b)?formatTime(r.a)+" – "+formatTime(r.b):"Geçersiz";
  $("#repeatStatus").textContent=String(loopIteration)+" / "+String(total);
  $("#playRepeatStatus").textContent=String(loopIteration)+" / "+String(loopActive||mediaLoaded()?total:0);
}

function showError(msg){
  $("#loadError").textContent=msg||"";
  $("#loadError").classList.toggle("hidden",!msg);
}

function escapeHtml(v){
  return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function mediaLoaded(){
  return currentMediaType==="youtube"?!!currentVideoId:currentMediaType==="local"?!!currentOfflineId:false;
}
function mediaTime(){
  return currentMediaType==="local"?(localPlayer.currentTime||0):(playerReady&&player?(player.getCurrentTime()||0):0);
}
function mediaSeek(t){
  t=Math.max(0,Number(t)||0);
  if(currentMediaType==="local")localPlayer.currentTime=t;
  else if(playerReady&&player)player.seekTo(t,true);
}
function mediaPlay(){
  if(currentMediaType==="local")localPlayer.play().catch(()=>{});
  else if(playerReady&&player)player.playVideo();
}
function mediaPause(){
  if(currentMediaType==="local"){
    localPlayer.pause();
  }else if(playerReady&&player){
    try{player.pauseVideo()}catch{}
  }
}
function forcePauseMedia(){
  mediaPause();
  if(currentMediaType==="youtube"&&playerReady&&player){
    try{player.pauseVideo()}catch{}
    setTimeout(()=>{try{player.pauseVideo()}catch{}},80);
    setTimeout(()=>{try{player.pauseVideo()}catch{}},250);
  }else if(currentMediaType==="local"){
    localPlayer.pause();
    setTimeout(()=>localPlayer.pause(),80);
  }
}
function mediaSetRate(rate){
  rate=clampSpeed(rate);
  if(currentMediaType==="local"){
    localPlayer.playbackRate=rate;
  }else if(playerReady&&player){
    try{
      const available=player.getAvailablePlaybackRates?.()||[];
      if(available.length){
        const nearest=available.reduce((best,x)=>Math.abs(x-rate)<Math.abs(best-rate)?x:best,available[0]);
        player.setPlaybackRate(nearest);
        rate=nearest;
      }else{
        player.setPlaybackRate(rate);
      }
    }catch{}
  }
  return rate;
}

function clampSpeed(value){
  const n=Number(value);
  if(!Number.isFinite(n))return 1;
  return Math.min(2,Math.max(0.25,Math.round(n*100)/100));
}
function syncSpeedUI(rate){
  const r=clampSpeed(rate);
  $("#playbackRate").value=[...$("#playbackRate").options].some(o=>Number(o.value)===r)?String(r):$("#playbackRate").value;
  $("#editSpeedManual").value=String(r);
  $("#playSpeedManual").value=String(r);
  document.querySelectorAll("[data-speed]").forEach(b=>b.classList.toggle("active",Number(b.dataset.speed)===r));
  document.querySelectorAll("[data-play-speed]").forEach(b=>b.classList.toggle("active",Number(b.dataset.playSpeed)===r));
}
function setPlaybackSpeed(rate){
  const r=clampSpeed(rate);
  mediaSetRate(r);
  syncSpeedUI(r);
  return r;
}

function releaseObjectUrl(){
  if(currentObjectUrl){URL.revokeObjectURL(currentObjectUrl);currentObjectUrl=""}
}

function applyTheme(){
  document.documentElement.classList.toggle("dark",state.dark);
  $("#themeBtn").textContent=state.dark?"☀️":"🌙";
  $("#themeBtn").title=state.dark?"Gündüz modu":"Gece modu";
}
function toggleTheme(){
  state.dark=!state.dark;
  store.set("ylp_dark",state.dark);
  applyTheme();
}

function switchScreen(screen){
  activeScreen=screen;
  $("#editScreen").classList.toggle("active",screen==="edit");
  $("#playScreen").classList.toggle("active",screen==="play");
  $("#editTabBtn").classList.toggle("active",screen==="edit");
  $("#playTabBtn").classList.toggle("active",screen==="play");
  if(screen==="play"){
    renderPlaySelectors();
    syncPlayControls();
  }
  window.scrollTo({top:0,behavior:"smooth"});
}

window.onYouTubeIframeAPIReady=()=>{
  player=new YT.Player("player",{
    width:"100%",height:"100%",videoId:"",
    playerVars:{playsinline:1,rel:0,modestbranding:1},
    events:{
      onReady:()=>{playerReady=true},
      onStateChange:e=>{
        if(currentMediaType==="youtube"){
          syncCurrentVideoTitle();
          if(e.data===YT.PlayerState.ENDED&&loopActive)handleLoopBoundary();
        }
      },
      onError:e=>{
        const code=e?.data;
        const detail=code===2?"Geçersiz video bağlantısı.":code===5?"YouTube oynatıcı geçici olarak videoyu yükleyemedi.":(code===100?"Video bulunamadı veya kaldırılmış.":((code===101||code===150)?"Bu video başka sitelerde oynatmaya izin vermiyor.":"YouTube oynatma hatası oluştu."));
        showError(detail+" Başka bir video seçip tekrar deneyebilirsin.");
      }
    }
  });
};

function addHistory(videoId){
  const saved=state.videos.find(v=>v.videoId===videoId);
  const old=state.history.find(v=>v.videoId===videoId);
  const item={
    videoId,
    url:"https://www.youtube.com/watch?v="+videoId,
    title:saved?.title||old?.title||("YouTube video · "+videoId),
    playedAt:Date.now()
  };
  state.history=[item,...state.history.filter(v=>v.videoId!==videoId)].slice(0,50);
  store.set("ylp_history",state.history);
  renderHistory();
}

function saveYoutubeVideo(videoId){
  if(!videoId)return;
  const history=state.history.find(v=>v.videoId===videoId);
  const existing=state.videos.find(v=>v.videoId===videoId);
  const item=existing||{
    videoId,
    url:"https://www.youtube.com/watch?v="+videoId,
    title:history?.title||("YouTube video · "+videoId),
    createdAt:Date.now()
  };
  item.updatedAt=Date.now();
  state.videos=[item,...state.videos.filter(v=>v.videoId!==videoId)];
  store.set("ylp_saved_videos",state.videos);
  renderSavedVideos();
  renderPlaySelectors();
}

function syncCurrentVideoTitle(){
  if(currentMediaType!=="youtube"||!currentVideoId||!playerReady||!player)return;
  try{
    const data=player.getVideoData?.();
    const title=String(data?.title||"").trim();
    if(!title)return;
    const saved=state.videos.find(v=>v.videoId===currentVideoId);
    if(saved){saved.title=title;store.set("ylp_saved_videos",state.videos)}
    const hist=state.history.find(v=>v.videoId===currentVideoId);
    if(hist){hist.title=title;store.set("ylp_history",state.history)}
    renderSavedVideos();
    renderHistory();
    renderPlaySelectors();
  }catch{}
}

function deleteSavedVideo(videoId){
  state.videos=state.videos.filter(v=>v.videoId!==videoId);
  store.set("ylp_saved_videos",state.videos);
  renderSavedVideos();
  renderPlaySelectors();
}

function renderSavedVideos(){
  const list=$("#savedVideoList");
  $("#savedVideoEmpty").classList.toggle("hidden",state.videos.length>0);
  list.innerHTML=state.videos.map(v=>{
    const selected=currentMediaType==="youtube"&&currentVideoId===v.videoId;
    const count=presetsForVideo(v.videoId).length;
    return '<article class="saved-video-card'+(selected?' selected':'')+'"><div class="saved-video-main"><div><div class="saved-video-title">'+escapeHtml(v.title||("YouTube video · "+v.videoId))+'</div><div class="saved-video-meta">'+count+' kayıtlı bölüm · '+escapeHtml(v.videoId)+'</div></div>'+(selected?'<span class="selected-badge">Seçili</span>':'')+'</div><div class="saved-video-actions"><button data-video-open="'+v.videoId+'">Aç</button><button data-video-delete="'+v.videoId+'">Listeden sil</button></div></article>';
  }).join("");
  list.querySelectorAll("[data-video-open]").forEach(b=>b.onclick=()=>loadVideo(b.dataset.videoOpen,false));
  list.querySelectorAll("[data-video-delete]").forEach(b=>b.onclick=()=>deleteSavedVideo(b.dataset.videoDelete));
}

function renderHistory(){
  const list=$("#historyList");
  $("#historyEmpty").classList.toggle("hidden",state.history.length>0);
  list.innerHTML=state.history.map(v=>{
    const saved=state.videos.some(s=>s.videoId===v.videoId);
    return '<article class="recent-item"><div class="recent-main"><div><div class="recent-title">'+escapeHtml(v.title||("YouTube video · "+v.videoId))+'</div><div class="recent-meta">'+escapeHtml(v.videoId)+(saved?' · kayıtlı':'')+'</div></div></div><div class="recent-actions"><button data-history-open="'+v.videoId+'">Aç</button>'+(!saved?'<button data-history-save="'+v.videoId+'">Listeye ekle</button>':'')+'</div></article>';
  }).join("");
  list.querySelectorAll("[data-history-open]").forEach(b=>b.onclick=()=>loadVideo(b.dataset.historyOpen,false));
  list.querySelectorAll("[data-history-save]").forEach(b=>b.onclick=()=>saveYoutubeVideo(b.dataset.historySave));
}

function clearHistory(){
  state.history=[];
  store.set("ylp_history",state.history);
  renderHistory();
}

function loadVideo(input,autoplay=false){
  const id=parseVideoId(input);
  if(!id){showError("Geçerli bir YouTube bağlantısı veya video kimliği gir.");return}
  if(!playerReady||!player){showError("YouTube oynatıcı henüz hazır değil. Birkaç saniye sonra tekrar dene.");return}
  stopLoop(false);loopResumeAvailable=false;loopIteration=0;releaseObjectUrl();
  currentMediaType="youtube";currentVideoId=id;currentOfflineId="";
  $("#videoUrl").value="https://www.youtube.com/watch?v="+id;
  localPlayer.pause();localPlayer.removeAttribute("src");localPlayer.load();localPlayer.classList.add("hidden");
  $("#player").classList.remove("hidden");$("#emptyPlayer").classList.add("hidden");showError("");
  const videoData=player.getVideoData?.();
  const alreadyLoaded=videoData?.video_id===id;
  if(!alreadyLoaded){
    if(autoplay)player.loadVideoById(id);else player.cueVideoById(id);
  }else if(autoplay){
    player.playVideo();
  }
  addHistory(id);
  renderSavedVideos();
  renderPresets();
  renderPlaySelectors();
  syncPlayControls();
  setTimeout(syncCurrentVideoTitle,600);
  setTimeout(syncCurrentVideoTitle,1500);
}

function setPoint(which){
  if(!mediaLoaded())return;
  loopResumeAvailable=false;
  loopIteration=0;
  const t=Math.max(0,mediaTime());
  $(which==="a"?"#startTime":"#endTime").value=formatTime(t);
  updateRangeStatus();
}

function nudge(which,delta){
  loopResumeAvailable=false;
  loopIteration=0;
  const el=$(which==="a"?"#startTime":"#endTime");
  const n=parseTime(el.value);
  const baseTenths=Math.round((Number.isFinite(n)?n:0)*10);
  const deltaTenths=Math.round(Number(delta)*10);
  const nextTenths=Math.max(0,baseTenths+deltaTenths);
  el.value=formatTime(nextTenths/10);
  updateRangeStatus();
}

function validateLoop(){
  if(!mediaLoaded())return"Önce bir video veya ses aç.";
  const r=currentRange();
  if(!Number.isFinite(r.a)||!Number.isFinite(r.b))return"A ve B zamanlarını kontrol et.";
  if(r.b<=r.a)return"Bitiş zamanı başlangıçtan büyük olmalı.";
  return"";
}

function setLoopButtons(running){
  $("#startLoopBtn").disabled=running;
  $("#stopLoopBtn").disabled=!running;
  $("#playPresetBtn").disabled=running||!$("#playPresetSelect").value;
  $("#playStopBtn").disabled=!running;
}

function startLoop(){
  const err=validateLoop();
  if(err){showError(err);return}
  showError("");
  const r=currentRange();
  clearTimeout(loopRestartTimer);loopRestartTimer=null;
  if(!loopResumeAvailable)loopIteration=0;
  loopResumeAvailable=false;
  loopActive=true;waiting=false;
  setLoopButtons(true);
  $("#loopState").textContent="Tekrar ediyor";
  $("#playLoopState").textContent="Tekrar ediyor";
  const activeRate=setPlaybackSpeed($("#editSpeedManual").value||$("#playbackRate").value);
  $("#playbackRate").value=[...$("#playbackRate").options].some(o=>Number(o.value)===activeRate)?String(activeRate):$("#playbackRate").value;
  mediaSeek(r.a);
  mediaPlay();
  clearInterval(loopTimer);
  loopTimer=setInterval(loopTick,60);
  updateRangeStatus();
}

function loopTick(){
  if(!loopActive||waiting||!mediaLoaded())return;
  const r=currentRange(),t=mediaTime();
  if(t>=r.b-0.03)handleLoopBoundary();
}

function handleLoopBoundary(){
  if(!loopActive||waiting)return;
  const target=Math.max(1,Number($("#repeatCount").value)||1);
  loopIteration++;
  updateRangeStatus();

  if(loopIteration>=target){
    loopActive=false;
    loopResumeAvailable=false;
    clearInterval(loopTimer);loopTimer=null;
    clearTimeout(loopRestartTimer);loopRestartTimer=null;
    forcePauseMedia();
    setLoopButtons(false);
    syncPlayControls();
    $("#loopState").textContent="Tamamlandı ✓";
    $("#playLoopState").textContent="Tamamlandı ✓";
    if("vibrate"in navigator){try{navigator.vibrate([100,60,160])}catch{}}
    return;
  }

  const r=currentRange();
  const pauseMs=Math.max(0,Number($("#pauseBetween").value)||0)*1000;
  waiting=true;

  if(pauseMs===0){
    mediaSeek(r.a);
    setPlaybackSpeed($("#editSpeedManual").value||$("#playbackRate").value);
    mediaPlay();
    setTimeout(()=>{waiting=false},120);
    return;
  }

  forcePauseMedia();
  clearTimeout(loopRestartTimer);
  loopRestartTimer=setTimeout(()=>{
    loopRestartTimer=null;
    if(!loopActive)return;
    mediaSeek(r.a);
    setPlaybackSpeed($("#editSpeedManual").value||$("#playbackRate").value);
    mediaPlay();
    setTimeout(()=>{waiting=false},120);
  },pauseMs);
}

function stopLoop(updateLabel=true){
  const target=Math.max(1,Number($("#repeatCount").value)||1);
  if(updateLabel)loopResumeAvailable=loopIteration>0&&loopIteration<target;
  loopActive=false;
  waiting=false;
  clearInterval(loopTimer);loopTimer=null;
  clearTimeout(loopRestartTimer);loopRestartTimer=null;
  forcePauseMedia();
  setLoopButtons(false);
  syncPlayControls();
  if(updateLabel){
    $("#loopState").textContent="Durduruldu";
    $("#playLoopState").textContent="Durduruldu";
  }
  updateRangeStatus();
}

function openSaveDialog(){
  if(!mediaLoaded()){showError("Önce bir video veya ses aç.");return}
  const r=currentRange();
  if(!Number.isFinite(r.a)||!Number.isFinite(r.b)||r.b<=r.a){showError("Kaydetmeden önce A ve B aralığını kontrol et.");return}
  $("#presetTitle").value="";
  $("#presetSummary").textContent=formatTime(r.a)+" – "+formatTime(r.b)+" · "+$("#repeatCount").value+" tekrar · "+$("#playbackRate").value+"×";
  $("#saveDialog").showModal();
}

function savePreset(){
  const r=currentRange(),title=$("#presetTitle").value.trim()||("Bölüm "+String(state.presets.length+1));
  state.presets.unshift({
    id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),
    title,
    sourceType:currentMediaType,
    sourceId:currentMediaType==="local"?currentOfflineId:currentVideoId,
    videoId:currentMediaType==="youtube"?currentVideoId:"",
    a:r.a,b:r.b,
    repeats:Math.max(1,Number($("#repeatCount").value)||1),
    rate:clampSpeed($("#editSpeedManual").value||$("#playbackRate").value),
    pause:Number($("#pauseBetween").value)||0,
    createdAt:Date.now()
  });
  store.set("ylp_presets",state.presets);
  if(currentMediaType==="youtube"&&currentVideoId)saveYoutubeVideo(currentVideoId);
  renderPresets();renderSavedVideos();renderPlaySelectors();
}

async function usePreset(p,{play=false}={}){
  loopResumeAvailable=false;
  loopIteration=0;
  $("#startTime").value=formatTime(p.a);
  $("#endTime").value=formatTime(p.b);
  $("#repeatCount").value=p.repeats;
  const presetRate=clampSpeed(p.rate||1);
  if([...$("#playbackRate").options].some(o=>Number(o.value)===presetRate))$("#playbackRate").value=String(presetRate);
  syncSpeedUI(presetRate);
  $("#pauseBetween").value=String(p.pause||0);
  updateRangeStatus();

  const type=p.sourceType||(p.videoId?"youtube":"");
  if(type==="local"){
    if(currentOfflineId!==p.sourceId)await loadOfflineMedia(p.sourceId);
  }else{
    const id=p.sourceId||p.videoId;
    if(currentVideoId!==id)loadVideo(id,false);
  }

  if(play){
    const go=()=>{mediaSeek(p.a);startLoop()};
    if(type==="youtube"&&currentVideoId!==(p.sourceId||p.videoId))setTimeout(go,650);
    else setTimeout(go,80);
  }
}

function deletePreset(id){
  state.presets=state.presets.filter(p=>p.id!==id);
  store.set("ylp_presets",state.presets);
  renderPresets();renderSavedVideos();renderPlaySelectors();
}

function presetsForVideo(videoId){
  return state.presets.filter(p=>{
    const type=p.sourceType||(p.videoId?"youtube":"");
    return type==="youtube"&&(p.sourceId||p.videoId)===videoId;
  });
}

function renderPresets(){
  const list=$("#presetList");
  let visible=[];
  if(currentMediaType==="youtube"&&currentVideoId)visible=presetsForVideo(currentVideoId);
  else if(currentMediaType==="local"&&currentOfflineId)visible=state.presets.filter(p=>p.sourceType==="local"&&p.sourceId===currentOfflineId);

  $("#presetEmpty").classList.toggle("hidden",visible.length>0);
  $("#presetEmpty").textContent=mediaLoaded()?"Bu video için henüz kayıtlı bölüm yok.":"Önce bir video aç.";
  list.innerHTML=visible.map(p=>'<article class="preset-card"><div class="preset-main"><div><div class="preset-title">'+escapeHtml(p.title)+'</div><div class="preset-meta">'+formatTime(p.a)+' – '+formatTime(p.b)+' · '+p.repeats+' tekrar · '+p.rate+'×</div></div></div><div class="preset-actions"><button data-use="'+p.id+'">Aç</button><button data-play="'+p.id+'">Oynat</button><button data-delete="'+p.id+'">Sil</button></div></article>').join("");
  list.querySelectorAll("[data-use]").forEach(b=>b.onclick=()=>usePreset(state.presets.find(p=>p.id===b.dataset.use)));
  list.querySelectorAll("[data-play]").forEach(b=>b.onclick=()=>usePreset(state.presets.find(p=>p.id===b.dataset.play),{play:true}));
  list.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>deletePreset(b.dataset.delete));
}

function renderPlaySelectors(){
  const videoSel=$("#playVideoSelect");
  const wanted=videoSel.value||((currentMediaType==="youtube"&&state.videos.some(v=>v.videoId===currentVideoId))?currentVideoId:"");
  videoSel.innerHTML='<option value="">Video seç…</option>'+state.videos.map(v=>'<option value="'+escapeHtml(v.videoId)+'">'+escapeHtml(v.title||v.videoId)+'</option>').join("");
  if(state.videos.some(v=>v.videoId===wanted))videoSel.value=wanted;
  renderPlayPresets();
}

function renderPlayPresets(){
  const videoId=$("#playVideoSelect").value;
  const presetSel=$("#playPresetSelect");
  const previousSelection=presetSel.value;
  const list=videoId?presetsForVideo(videoId):[];

  presetSel.disabled=!videoId||!list.length;
  presetSel.innerHTML=!videoId
    ?'<option value="">Önce video seç…</option>'
    :(!list.length
      ?'<option value="">Bu videoda kayıtlı bölüm yok</option>'
      :'<option value="">Bölüm seç…</option>'+list.map(p=>'<option value="'+escapeHtml(p.id)+'">'+escapeHtml(p.title)+' · '+formatTime(p.a)+'–'+formatTime(p.b)+'</option>').join(""));

  if(previousSelection&&list.some(p=>p.id===previousSelection)){
    presetSel.value=previousSelection;
  }

  syncPlayControls();
}

function syncPlayControls(){
  const id=$("#playPresetSelect").value;
  const list=$("#playVideoSelect").value?presetsForVideo($("#playVideoSelect").value):[];
  const index=list.findIndex(p=>p.id===id);
  const hasSelection=index>=0;

  $("#playPresetBtn").disabled=loopActive||!hasSelection;
  $("#prevPresetBtn").disabled=!hasSelection||index<=0;
  $("#nextPresetBtn").disabled=!hasSelection||index>=list.length-1;
}

function selectPlayVideo(videoId){
  if(!videoId){renderPlayPresets();return}
  loadVideo(videoId,false);
  renderPlayPresets();
}

function selectPlayPreset(id){
  const p=state.presets.find(x=>x.id===id);
  if(!p){syncPlayControls();return}
  usePreset(p,{play:false});
  syncPlayControls();
}

function navigatePlayPreset(direction){
  const videoId=$("#playVideoSelect").value;
  if(!videoId)return;
  const list=presetsForVideo(videoId);
  if(!list.length)return;

  const currentId=$("#playPresetSelect").value;
  let index=list.findIndex(p=>p.id===currentId);

  if(index<0){
    index=direction>0?0:list.length-1;
  }else{
    index=Math.max(0,Math.min(list.length-1,index+direction));
  }

  const next=list[index];
  $("#playPresetSelect").value=next.id;
  selectPlayPreset(next.id);
}

/* Offline media */
const DB_NAME="youtube-loop-player-db",DB_VERSION=1,MEDIA_STORE="media";
function openMediaDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(MEDIA_STORE))db.createObjectStore(MEDIA_STORE,{keyPath:"id"})};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function dbPutMedia(item){
  const db=await openMediaDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(MEDIA_STORE,"readwrite");tx.objectStore(MEDIA_STORE).put(item);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
  });
}
async function dbGetMedia(id){
  const db=await openMediaDb();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(MEDIA_STORE,"readonly").objectStore(MEDIA_STORE).get(id);
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
  });
}
async function dbListMedia(){
  const db=await openMediaDb();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(MEDIA_STORE,"readonly").objectStore(MEDIA_STORE).getAll();
    req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>b.createdAt-a.createdAt));req.onerror=()=>reject(req.error);
  });
}
async function dbDeleteMedia(id){
  const db=await openMediaDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(MEDIA_STORE,"readwrite");tx.objectStore(MEDIA_STORE).delete(id);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
  });
}
async function importOfflineFile(file){
  if(!file)return;
  const id=crypto.randomUUID?crypto.randomUUID():String(Date.now());
  await dbPutMedia({id,name:file.name,type:file.type||"application/octet-stream",size:file.size,blob:file,createdAt:Date.now()});
  await renderOfflineMedia();await loadOfflineMedia(id);
}
function fileNameFromUrl(url){
  try{
    const u=new URL(url);
    const last=u.pathname.split("/").filter(Boolean).pop()||"indirilen-medya";
    return decodeURIComponent(last.split("?")[0])||"indirilen-medya";
  }catch{return"indirilen-medya"}
}
function isYouTubeUrl(url){
  try{
    const h=new URL(url).hostname.replace(/^www\./,"").toLowerCase();
    return h==="youtube.com"||h.endsWith(".youtube.com")||h==="youtu.be";
  }catch{return false}
}
async function importRemoteMedia(url){
  const raw=String(url||"").trim();
  if(!raw)throw new Error("Bir medya bağlantısı gir.");
  if(isYouTubeUrl(raw))throw new Error("YouTube dışındaki doğrudan MP4/MP3/M4A bağlantısını kullan.");
  const status=$("#downloadStatus");
  status.textContent="İndiriliyor…";
  const res=await fetch(raw,{mode:"cors"});
  if(!res.ok)throw new Error("İndirme başarısız: HTTP "+res.status);
  const blob=await res.blob();
  const type=(blob.type||res.headers.get("content-type")||"").toLowerCase();
  if(type&&!type.startsWith("video/")&&!type.startsWith("audio/")&&!type.includes("octet-stream"))throw new Error("Bu bağlantı doğrudan bir video veya ses dosyasına benzemiyor.");
  const id=crypto.randomUUID?crypto.randomUUID():String(Date.now());
  let name=fileNameFromUrl(raw);
  await dbPutMedia({id,name,type:type||"application/octet-stream",size:blob.size,blob,sourceUrl:raw,createdAt:Date.now()});
  status.textContent="Kaydedildi: "+name+" · "+formatBytes(blob.size);
  await renderOfflineMedia();await loadOfflineMedia(id);
}

async function checkServerStatus(){
  const el=$("#serverStatus");
  try{
    const res=await fetch("./api/status",{cache:"no-store"});
    if(!res.ok)throw new Error();
    const data=await res.json();
    const runtimes=(data.jsRuntimes||[]).join(", ");
    if(!data.ytDlpInstalled){el.textContent="YouTube indirme motoru kurulu değil.";return}
    if(!runtimes){el.textContent="YouTube indirme için Deno veya Node gerekli.";return}
    el.textContent="İndirme sunucusu hazır · JS: "+runtimes+(data.ffmpeg?" · ffmpeg var":"");
  }catch{
    el.textContent="İndirme sunucusuna ulaşılamıyor. İndirme için server.py ile başlat.";
  }
}
function filenameFromDisposition(value){
  const raw=String(value||"");
  const plain=raw.match(/filename="?([^";]+)"?/i);
  return plain?plain[1]:"youtube-video.mp4";
}
async function downloadYouTubeForOffline(){
  const url=$("#videoUrl").value.trim(),status=$("#youtubeDownloadStatus");
  if(!parseVideoId(url)){showError("Önce geçerli bir YouTube bağlantısı gir.");return}
  if(!$("#downloadConsent").checked){showError("Bu videoyu çevrimdışı kaydetme hakkın olduğunu onayla.");return}
  const btn=$("#youtubeDownloadBtn");
  btn.disabled=true;showError("");status.textContent="YouTube videosu indiriliyor…";
  try{
    const res=await fetch("./api/youtube-download",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url,authorized:true,cookieBrowser:$("#cookieBrowser").value})});
    if(!res.ok){let message="YouTube indirmesi başarısız.";try{const data=await res.json();if(data.error)message=data.error}catch{}throw new Error(message)}
    const blob=await res.blob(),name=filenameFromDisposition(res.headers.get("content-disposition"));
    const id=crypto.randomUUID?crypto.randomUUID():String(Date.now());
    await dbPutMedia({id,name,type:blob.type||"video/mp4",size:blob.size,blob,sourceUrl:url,sourceType:"youtube-download",createdAt:Date.now()});
    status.textContent="Kaydedildi: "+name+" · "+formatBytes(blob.size);
    await renderOfflineMedia();await loadOfflineMedia(id);
  }catch(err){
    status.textContent="";
    showError(err?.message||"YouTube videosu indirilemedi.");
  }finally{btn.disabled=false}
}
async function loadOfflineMedia(id){
  const item=await dbGetMedia(id);
  if(!item){showError("Çevrimdışı medya bulunamadı.");return}
  stopLoop(false);releaseObjectUrl();
  currentMediaType="local";currentOfflineId=id;currentVideoId="";
  if(playerReady&&player){try{player.pauseVideo()}catch{}}
  $("#player").classList.add("hidden");$("#emptyPlayer").classList.add("hidden");
  currentObjectUrl=URL.createObjectURL(item.blob);
  localPlayer.src=currentObjectUrl;localPlayer.classList.remove("hidden");localPlayer.load();
  $("#loopState").textContent="Çevrimdışı medya hazır";showError("");renderPresets();renderSavedVideos();
}
async function deleteOfflineMedia(id){
  if(currentMediaType==="local"&&currentOfflineId===id){
    stopLoop(false);localPlayer.pause();localPlayer.removeAttribute("src");localPlayer.load();localPlayer.classList.add("hidden");releaseObjectUrl();
    currentMediaType="";currentOfflineId="";$("#emptyPlayer").classList.remove("hidden");
  }
  await dbDeleteMedia(id);
  state.presets=state.presets.filter(p=>!(p.sourceType==="local"&&p.sourceId===id));
  store.set("ylp_presets",state.presets);renderPresets();await renderOfflineMedia();
}
async function renderOfflineMedia(){
  const items=await dbListMedia(),list=$("#offlineList");
  $("#offlineEmpty").classList.toggle("hidden",items.length>0);
  list.innerHTML=items.map(item=>'<article class="offline-item"><div class="offline-main"><div><div class="offline-title">'+escapeHtml(item.name)+'</div><div class="offline-meta">'+escapeHtml(item.type||"medya")+' · '+formatBytes(item.size)+'</div></div></div><div class="offline-actions"><button data-offline-open="'+item.id+'">Aç</button><button data-offline-delete="'+item.id+'">Sil</button></div></article>').join("");
  list.querySelectorAll("[data-offline-open]").forEach(b=>b.onclick=()=>loadOfflineMedia(b.dataset.offlineOpen));
  list.querySelectorAll("[data-offline-delete]").forEach(b=>b.onclick=()=>deleteOfflineMedia(b.dataset.offlineDelete));
}

/* Events */
$("#loadBtn").onclick=()=>loadVideo($("#videoUrl").value,false);
$("#saveCurrentVideoBtn").onclick=()=>{if(currentVideoId)saveYoutubeVideo(currentVideoId);else showError("Önce bir YouTube videosu aç.")};
$("#clearHistoryBtn").onclick=clearHistory;
$("#videoUrl").addEventListener("keydown",e=>{if(e.key==="Enter")loadVideo(e.currentTarget.value,false)});
$("#setStartBtn").onclick=()=>setPoint("a");
$("#setEndBtn").onclick=()=>setPoint("b");
document.querySelectorAll("[data-nudge-start]").forEach(b=>b.onclick=()=>nudge("a",Number(b.dataset.nudgeStart)));
document.querySelectorAll("[data-nudge-end]").forEach(b=>b.onclick=()=>nudge("b",Number(b.dataset.nudgeEnd)));
$("#startLoopBtn").onclick=startLoop;
$("#stopLoopBtn").onclick=e=>{e.preventDefault();e.stopPropagation();stopLoop(true)};
$("#savePresetBtn").onclick=openSaveDialog;
$("#confirmSavePreset").addEventListener("click",savePreset);
["#startTime","#endTime"].forEach(s=>$(s).addEventListener("input",()=>{loopResumeAvailable=false;loopIteration=0;updateRangeStatus()}));
$("#repeatCount").addEventListener("input",()=>{loopResumeAvailable=false;loopIteration=0;updateRangeStatus()});
$("#playbackRate").addEventListener("change",()=>setPlaybackSpeed($("#playbackRate").value));
$("#editSpeedManual").addEventListener("change",()=>setPlaybackSpeed($("#editSpeedManual").value));
$("#editSpeedManual").addEventListener("input",()=>syncSpeedUI(clampSpeed($("#editSpeedManual").value)));
$("#playSpeedManual").addEventListener("change",()=>setPlaybackSpeed($("#playSpeedManual").value));
$("#playSpeedManual").addEventListener("input",()=>syncSpeedUI(clampSpeed($("#playSpeedManual").value)));
document.querySelectorAll("[data-speed]").forEach(b=>b.onclick=()=>setPlaybackSpeed(b.dataset.speed));
document.querySelectorAll("[data-play-speed]").forEach(b=>b.onclick=()=>setPlaybackSpeed(b.dataset.playSpeed));

$("#editTabBtn").onclick=()=>switchScreen("edit");
$("#playTabBtn").onclick=()=>switchScreen("play");
$("#themeBtn").onclick=toggleTheme;

$("#playVideoSelect").addEventListener("change",e=>selectPlayVideo(e.target.value));
$("#playPresetSelect").addEventListener("change",e=>selectPlayPreset(e.target.value));
$("#prevPresetBtn").onclick=()=>navigatePlayPreset(-1);
$("#nextPresetBtn").onclick=()=>navigatePlayPreset(1);
$("#playPresetBtn").onclick=()=>{
  const p=state.presets.find(x=>x.id===$("#playPresetSelect").value);
  if(p)usePreset(p,{play:true});
};
$("#playStopBtn").onclick=e=>{e.preventDefault();e.stopPropagation();stopLoop(true)};

$("#youtubeDownloadBtn").onclick=downloadYouTubeForOffline;
$("#offlineFileInput").addEventListener("change",async e=>{const file=e.target.files?.[0];if(file){try{await importOfflineFile(file)}catch(err){showError("Dosya kaydedilemedi: "+(err?.message||"bilinmeyen hata"))}e.target.value=""}});
$("#downloadMediaBtn").addEventListener("click",async()=>{
  const btn=$("#downloadMediaBtn"),status=$("#downloadStatus");
  btn.disabled=true;showError("");
  try{await importRemoteMedia($("#directMediaUrl").value)}
  catch(err){status.textContent="";showError(err?.message||"Medya indirilemedi.")}
  finally{btn.disabled=false}
});
localPlayer.addEventListener("ended",()=>{if(currentMediaType==="local"&&loopActive)handleLoopBoundary()});

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;$("#installBtn").classList.remove("hidden")});
$("#installBtn").onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$("#installBtn").classList.add("hidden")};
$("#secondaryTools")?.addEventListener("toggle",e=>{if(e.currentTarget.open)checkServerStatus()});

applyTheme();
syncSpeedUI($("#playbackRate").value);
renderSavedVideos();
renderHistory();
renderPresets();
renderPlaySelectors();
renderOfflineMedia();
updateRangeStatus();

if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js?v=15");
