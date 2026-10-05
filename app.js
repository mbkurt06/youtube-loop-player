const $=s=>document.querySelector(s);

let player=null;
let playerReady=false;
let currentVideoId="";
let currentOfflineId="";
let currentMediaType="";
let currentObjectUrl="";
let loopTimer=null;
let loopActive=false;
let loopIteration=0;
let waiting=false;
let deferredInstallPrompt=null;

const localPlayer=$("#localPlayer");

const store={
  get(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}},
  set(key,value){localStorage.setItem(key,JSON.stringify(value))}
};
const state={
  presets:store.get("ylp_presets",[]),
  recent:store.get("ylp_recent",[])
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
  const whole=Math.floor(sec),s=whole%60,m=Math.floor(whole/60)%60,h=Math.floor(whole/3600);
  return h?String(h)+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"):String(m)+":"+String(s).padStart(2,"0");
}
function formatBytes(bytes){
  const n=Number(bytes)||0;
  if(n<1024)return n+" B";
  if(n<1024*1024)return(n/1024).toFixed(1)+" KB";
  return(n/(1024*1024)).toFixed(1)+" MB";
}
function currentRange(){return{a:parseTime($("#startTime").value),b:parseTime($("#endTime").value)}}
function updateRangeStatus(){
  const r=currentRange(),total=Math.max(1,Number($("#repeatCount").value)||1);
  $("#rangeStatus").textContent=Number.isFinite(r.a)&&Number.isFinite(r.b)?formatTime(r.a)+" – "+formatTime(r.b):"Geçersiz";
  $("#repeatStatus").textContent=String(loopIteration)+" / "+String(total);
}
function showError(msg){$("#loadError").textContent=msg||"";$("#loadError").classList.toggle("hidden",!msg)}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

function mediaLoaded(){return currentMediaType==="youtube"?!!currentVideoId:currentMediaType==="local"?!!currentOfflineId:false}
function mediaTime(){return currentMediaType==="local"?(localPlayer.currentTime||0):(playerReady&&player?(player.getCurrentTime()||0):0)}
function mediaSeek(t){
  t=Math.max(0,Number(t)||0);
  if(currentMediaType==="local")localPlayer.currentTime=t;
  else if(playerReady&&player)player.seekTo(t,true);
}
function mediaPlay(){
  if(currentMediaType==="local"){localPlayer.play().catch(()=>{})}
  else if(playerReady&&player)player.playVideo();
}
function mediaPause(){
  if(currentMediaType==="local")localPlayer.pause();
  else if(playerReady&&player)player.pauseVideo();
}
function mediaSetRate(rate){
  rate=Number(rate)||1;
  if(currentMediaType==="local")localPlayer.playbackRate=rate;
  else if(playerReady&&player){try{player.setPlaybackRate(rate)}catch{}}
}
function releaseObjectUrl(){
  if(currentObjectUrl){URL.revokeObjectURL(currentObjectUrl);currentObjectUrl=""}
}

window.onYouTubeIframeAPIReady=()=>{
  player=new YT.Player("player",{
    width:"100%",height:"100%",videoId:"",
    playerVars:{playsinline:1,rel:0,modestbranding:1},
    events:{
      onReady:()=>{playerReady=true},
      onStateChange:e=>{if(currentMediaType==="youtube"&&e.data===YT.PlayerState.ENDED&&loopActive)handleLoopBoundary()},
      onError:()=>showError("Bu video gömülü oynatmaya izin vermiyor veya açılamıyor.")
    }
  });
};

function addRecent(videoId){
  state.recent=[{videoId,updatedAt:Date.now()},...state.recent.filter(x=>x.videoId!==videoId)].slice(0,10);
  store.set("ylp_recent",state.recent);renderRecent();
}
function loadVideo(input,autoplay=false){
  const id=parseVideoId(input);
  if(!id){showError("Geçerli bir YouTube bağlantısı veya video kimliği gir.");return}
  if(!playerReady||!player){showError("YouTube oynatıcı henüz hazır değil. Birkaç saniye sonra tekrar dene.");return}
  stopLoop(false);releaseObjectUrl();
  currentMediaType="youtube";currentVideoId=id;currentOfflineId="";
  $("#videoUrl").value="https://www.youtube.com/watch?v="+id;
  localPlayer.pause();localPlayer.removeAttribute("src");localPlayer.load();localPlayer.classList.add("hidden");
  $("#player").classList.remove("hidden");$("#emptyPlayer").classList.add("hidden");showError("");
  if(autoplay)player.loadVideoById(id);else player.cueVideoById(id);
  addRecent(id);
}
function setPoint(which){
  if(!mediaLoaded())return;
  const t=Math.max(0,mediaTime());
  $(which==="a"?"#startTime":"#endTime").value=formatTime(t);updateRangeStatus();
}
function nudge(which,delta){
  const el=$(which==="a"?"#startTime":"#endTime"),n=parseTime(el.value);
  el.value=formatTime(Math.max(0,(Number.isFinite(n)?n:0)+delta));updateRangeStatus();
}
function validateLoop(){
  if(!mediaLoaded())return"Önce bir video veya ses aç.";
  const r=currentRange();
  if(!Number.isFinite(r.a)||!Number.isFinite(r.b))return"A ve B zamanlarını kontrol et.";
  if(r.b<=r.a)return"Bitiş zamanı başlangıçtan büyük olmalı.";
  return"";
}
function startLoop(){
  const err=validateLoop();if(err){showError(err);return}
  showError("");const r=currentRange();
  loopIteration=0;loopActive=true;waiting=false;
  $("#startLoopBtn").disabled=true;$("#stopLoopBtn").disabled=false;$("#loopState").textContent="Tekrar ediyor";
  mediaSetRate($("#playbackRate").value);mediaSeek(r.a);mediaPlay();
  clearInterval(loopTimer);loopTimer=setInterval(loopTick,80);updateRangeStatus();
}
function loopTick(){
  if(!loopActive||waiting||!mediaLoaded())return;
  const r=currentRange(),t=mediaTime();
  if(t>=r.b-0.04)handleLoopBoundary();
}
function handleLoopBoundary(){
  if(!loopActive||waiting)return;
  const target=Math.max(1,Number($("#repeatCount").value)||1);
  loopIteration++;updateRangeStatus();
  if(loopIteration>=target){
    loopActive=false;clearInterval(loopTimer);loopTimer=null;mediaPause();
    $("#startLoopBtn").disabled=false;$("#stopLoopBtn").disabled=true;$("#loopState").textContent="Tamamlandı ✓";
    if("vibrate"in navigator){try{navigator.vibrate([100,60,160])}catch{}}
    return;
  }
  const r=currentRange(),pause=Math.max(0,Number($("#pauseBetween").value)||0)*1000;
  waiting=true;mediaPause();
  setTimeout(()=>{
    if(!loopActive)return;
    mediaSeek(r.a);mediaSetRate($("#playbackRate").value);mediaPlay();waiting=false;
  },pause);
}
function stopLoop(updateLabel=true){
  loopActive=false;waiting=false;clearInterval(loopTimer);loopTimer=null;
  $("#startLoopBtn").disabled=false;$("#stopLoopBtn").disabled=true;
  if(updateLabel)$("#loopState").textContent="Durduruldu";
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
    rate:Number($("#playbackRate").value)||1,
    pause:Number($("#pauseBetween").value)||0,
    createdAt:Date.now()
  });
  store.set("ylp_presets",state.presets);renderPresets();
}
async function usePreset(p){
  $("#startTime").value=formatTime(p.a);$("#endTime").value=formatTime(p.b);
  $("#repeatCount").value=p.repeats;$("#playbackRate").value=String(p.rate);$("#pauseBetween").value=String(p.pause||0);
  updateRangeStatus();
  const type=p.sourceType||(p.videoId?"youtube":"");
  if(type==="local")await loadOfflineMedia(p.sourceId);
  else loadVideo(p.sourceId||p.videoId,false);
}
function deletePreset(id){state.presets=state.presets.filter(p=>p.id!==id);store.set("ylp_presets",state.presets);renderPresets()}
function renderPresets(){
  const list=$("#presetList");$("#presetEmpty").classList.toggle("hidden",state.presets.length>0);
  list.innerHTML=state.presets.map(p=>{
    const type=p.sourceType||(p.videoId?"youtube":"");
    return '<article class="preset-card"><div class="preset-main"><div><div class="preset-title">'+escapeHtml(p.title)+'</div><div class="preset-meta">'+(type==="local"?"Çevrimdışı · ":"YouTube · ")+formatTime(p.a)+' – '+formatTime(p.b)+' · '+p.repeats+' tekrar · '+p.rate+'×</div></div></div><div class="preset-actions"><button data-use="'+p.id+'">Aç</button><button data-delete="'+p.id+'">Sil</button></div></article>'
  }).join("");
  list.querySelectorAll("[data-use]").forEach(b=>b.onclick=()=>usePreset(state.presets.find(p=>p.id===b.dataset.use)));
  list.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>deletePreset(b.dataset.delete));
}
function renderRecent(){
  const list=$("#recentList");$("#recentEmpty").classList.toggle("hidden",state.recent.length>0);
  list.innerHTML=state.recent.map(r=>'<article class="recent-item"><div class="recent-main"><div><div class="recent-title">YouTube video</div><div class="recent-meta">'+escapeHtml(r.videoId)+'</div></div></div><div class="recent-actions"><button data-recent="'+r.videoId+'">Aç</button></div></article>').join("");
  list.querySelectorAll("[data-recent]").forEach(b=>b.onclick=()=>loadVideo(b.dataset.recent,false));
}

/* Offline media: files are stored as blobs in IndexedDB. */
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
  if(isYouTubeUrl(raw))throw new Error("YouTube bağlantısından doğrudan dosya indirme desteklenmiyor. YouTube dışındaki doğrudan MP4/MP3/M4A bağlantısını kullan.");
  const status=$("#downloadStatus");
  status.textContent="İndiriliyor…";
  const res=await fetch(raw,{mode:"cors"});
  if(!res.ok)throw new Error("İndirme başarısız: HTTP "+res.status);
  const blob=await res.blob();
  const type=(blob.type||res.headers.get("content-type")||"").toLowerCase();
  if(type && !type.startsWith("video/") && !type.startsWith("audio/") && !type.includes("octet-stream")){
    throw new Error("Bu bağlantı doğrudan bir video veya ses dosyasına benzemiyor.");
  }
  const id=crypto.randomUUID?crypto.randomUUID():String(Date.now());
  let name=fileNameFromUrl(raw);
  if(!/\.[a-z0-9]{2,5}$/i.test(name)){
    if(type.includes("mp4"))name+=".mp4";
    else if(type.includes("mpeg"))name+=".mp3";
    else if(type.includes("m4a"))name+=".m4a";
  }
  await dbPutMedia({id,name,type:type||"application/octet-stream",size:blob.size,blob,sourceUrl:raw,createdAt:Date.now()});
  status.textContent="Kaydedildi: "+name+" · "+formatBytes(blob.size);
  await renderOfflineMedia();
  await loadOfflineMedia(id);
}

function filenameFromDisposition(value){
  const raw=String(value||"");
  const utf=raw.match(/filename\*=UTF-8''([^;]+)/i);
  if(utf){try{return decodeURIComponent(utf[1])}catch{}}
  const plain=raw.match(/filename="?([^";]+)"?/i);
  return plain?plain[1]:"youtube-video.mp4";
}
async function downloadYouTubeForOffline(){
  const url=$("#videoUrl").value.trim();
  const status=$("#youtubeDownloadStatus");
  if(!parseVideoId(url)){showError("Önce geçerli bir YouTube bağlantısı gir.");return}
  if(!$("#downloadConsent").checked){showError("Bu videoyu çevrimdışı kaydetme hakkın olduğunu onayla.");return}

  const btn=$("#youtubeDownloadBtn");
  btn.disabled=true;showError("");status.textContent="YouTube videosu indiriliyor…";
  try{
    const res=await fetch("./api/youtube-download",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({url,authorized:true})
    });
    if(!res.ok){
      let message="YouTube indirmesi başarısız.";
      try{const data=await res.json();if(data.error)message=data.error}catch{}
      throw new Error(message);
    }
    const blob=await res.blob();
    const name=filenameFromDisposition(res.headers.get("content-disposition"));
    const id=crypto.randomUUID?crypto.randomUUID():String(Date.now());
    await dbPutMedia({
      id,name,type:blob.type||"video/mp4",size:blob.size,blob,
      sourceUrl:url,sourceType:"youtube-download",createdAt:Date.now()
    });
    status.textContent="Kaydedildi: "+name+" · "+formatBytes(blob.size);
    await renderOfflineMedia();
    await loadOfflineMedia(id);
  }catch(err){
    status.textContent="";
    const msg=err?.message||"YouTube videosu indirilemedi.";
    if(msg.includes("Failed to fetch")){
      showError("YouTube indirme sunucusuna ulaşılamadı. Uygulamayı ‘python3 server.py 8081’ ile başlat.");
    }else showError(msg);
  }finally{
    btn.disabled=false;
  }
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
  $("#loopState").textContent="Çevrimdışı medya hazır";showError("");
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

$("#loadBtn").onclick=()=>loadVideo($("#videoUrl").value,false);
$("#youtubeDownloadBtn").onclick=downloadYouTubeForOffline;
$("#videoUrl").addEventListener("keydown",e=>{if(e.key==="Enter")loadVideo(e.currentTarget.value,false)});
$("#setStartBtn").onclick=()=>setPoint("a");$("#setEndBtn").onclick=()=>setPoint("b");
document.querySelectorAll("[data-nudge-start]").forEach(b=>b.onclick=()=>nudge("a",Number(b.dataset.nudgeStart)));
document.querySelectorAll("[data-nudge-end]").forEach(b=>b.onclick=()=>nudge("b",Number(b.dataset.nudgeEnd)));
$("#startLoopBtn").onclick=startLoop;$("#stopLoopBtn").onclick=()=>stopLoop(true);
$("#savePresetBtn").onclick=openSaveDialog;$("#confirmSavePreset").addEventListener("click",savePreset);
["#startTime","#endTime","#repeatCount"].forEach(s=>$(s).addEventListener("input",updateRangeStatus));
$("#playbackRate").addEventListener("change",()=>mediaSetRate($("#playbackRate").value));
$("#offlineFileInput").addEventListener("change",async e=>{const f=e.target.files?.[0];if(f){try{await importOfflineFile(f)}catch(err){showError("Dosya kaydedilemedi: "+(err?.message||"bilinmeyen hata"))}e.target.value=""}});
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

if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js?v=4");
renderPresets();renderRecent();renderOfflineMedia();updateRangeStatus();
