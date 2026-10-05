const $=s=>document.querySelector(s);
let player=null,playerReady=false,currentVideoId="",loopTimer=null,loopActive=false,loopIteration=0,waiting=false,deferredInstallPrompt=null;

const store={
  get(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}},
  set(key,value){localStorage.setItem(key,JSON.stringify(value))}
};
const state={presets:store.get("ylp_presets",[]),recent:store.get("ylp_recent",[])};

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
function currentRange(){return{a:parseTime($("#startTime").value),b:parseTime($("#endTime").value)}}
function updateRangeStatus(){
  const r=currentRange(),total=Math.max(1,Number($("#repeatCount").value)||1);
  $("#rangeStatus").textContent=Number.isFinite(r.a)&&Number.isFinite(r.b)?formatTime(r.a)+" – "+formatTime(r.b):"Geçersiz";
  $("#repeatStatus").textContent=String(loopIteration)+" / "+String(total);
}
function showError(msg){$("#loadError").textContent=msg||"";$("#loadError").classList.toggle("hidden",!msg)}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

window.onYouTubeIframeAPIReady=()=>{
  player=new YT.Player("player",{
    width:"100%",height:"100%",videoId:"",
    playerVars:{playsinline:1,rel:0,modestbranding:1},
    events:{
      onReady:()=>{playerReady=true},
      onStateChange:e=>{if(e.data===YT.PlayerState.ENDED&&loopActive)handleLoopBoundary()},
      onError:()=>showError("Bu video gömülü oynatmaya izin vermiyor veya açılamıyor.")
    }
  });
};

function addRecent(videoId){
  state.recent=[{videoId:videoId,updatedAt:Date.now()}].concat(state.recent.filter(x=>x.videoId!==videoId)).slice(0,10);
  store.set("ylp_recent",state.recent);renderRecent();
}
function loadVideo(input,autoplay){
  const id=parseVideoId(input);
  if(!id){showError("Geçerli bir YouTube bağlantısı veya video kimliği gir.");return}
  if(!playerReady||!player){showError("YouTube oynatıcı henüz hazır değil. Birkaç saniye sonra tekrar dene.");return}
  stopLoop(false);currentVideoId=id;
  $("#videoUrl").value="https://www.youtube.com/watch?v="+id;
  $("#emptyPlayer").classList.add("hidden");showError("");
  if(autoplay)player.loadVideoById(id);else player.cueVideoById(id);
  addRecent(id);
}
function setPoint(which){
  if(!playerReady||!currentVideoId)return;
  const t=Math.max(0,player.getCurrentTime()||0);
  $(which==="a"?"#startTime":"#endTime").value=formatTime(t);updateRangeStatus();
}
function nudge(which,delta){
  const el=$(which==="a"?"#startTime":"#endTime"),n=parseTime(el.value);
  el.value=formatTime(Math.max(0,(Number.isFinite(n)?n:0)+delta));updateRangeStatus();
}
function validateLoop(){
  if(!playerReady||!currentVideoId)return"Önce bir video aç.";
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
  player.setPlaybackRate(Number($("#playbackRate").value)||1);player.seekTo(r.a,true);player.playVideo();
  clearInterval(loopTimer);loopTimer=setInterval(loopTick,100);updateRangeStatus();
}
function loopTick(){
  if(!loopActive||waiting||!playerReady)return;
  const r=currentRange(),t=player.getCurrentTime()||0;
  if(t>=r.b-0.05)handleLoopBoundary();
}
function handleLoopBoundary(){
  if(!loopActive||waiting)return;
  const target=Math.max(1,Number($("#repeatCount").value)||1);
  loopIteration++;updateRangeStatus();
  if(loopIteration>=target){
    loopActive=false;clearInterval(loopTimer);loopTimer=null;player.pauseVideo();
    $("#startLoopBtn").disabled=false;$("#stopLoopBtn").disabled=true;$("#loopState").textContent="Tamamlandı ✓";
    if("vibrate"in navigator){try{navigator.vibrate([100,60,160])}catch{}}
    return;
  }
  const r=currentRange(),pause=Math.max(0,Number($("#pauseBetween").value)||0)*1000;
  waiting=true;player.pauseVideo();
  setTimeout(()=>{if(!loopActive)return;player.seekTo(r.a,true);player.setPlaybackRate(Number($("#playbackRate").value)||1);player.playVideo();waiting=false},pause);
}
function stopLoop(updateLabel=true){
  loopActive=false;waiting=false;clearInterval(loopTimer);loopTimer=null;
  $("#startLoopBtn").disabled=false;$("#stopLoopBtn").disabled=true;
  if(updateLabel)$("#loopState").textContent="Durduruldu";
  updateRangeStatus();
}
function openSaveDialog(){
  if(!currentVideoId){showError("Önce bir video aç.");return}
  const r=currentRange();
  if(!Number.isFinite(r.a)||!Number.isFinite(r.b)||r.b<=r.a){showError("Kaydetmeden önce A ve B aralığını kontrol et.");return}
  $("#presetTitle").value="";
  $("#presetSummary").textContent=formatTime(r.a)+" – "+formatTime(r.b)+" · "+$("#repeatCount").value+" tekrar · "+$("#playbackRate").value+"×";
  $("#saveDialog").showModal();
}
function savePreset(){
  const r=currentRange(),title=$("#presetTitle").value.trim()||("Bölüm "+String(state.presets.length+1));
  state.presets.unshift({
    id:(crypto.randomUUID?crypto.randomUUID():String(Date.now())),
    title:title,videoId:currentVideoId,a:r.a,b:r.b,
    repeats:Math.max(1,Number($("#repeatCount").value)||1),
    rate:Number($("#playbackRate").value)||1,pause:Number($("#pauseBetween").value)||0,createdAt:Date.now()
  });
  store.set("ylp_presets",state.presets);renderPresets();
}
function usePreset(p){
  $("#startTime").value=formatTime(p.a);$("#endTime").value=formatTime(p.b);
  $("#repeatCount").value=p.repeats;$("#playbackRate").value=String(p.rate);$("#pauseBetween").value=String(p.pause||0);
  updateRangeStatus();if(currentVideoId!==p.videoId)loadVideo(p.videoId,false);
}
function deletePreset(id){state.presets=state.presets.filter(p=>p.id!==id);store.set("ylp_presets",state.presets);renderPresets()}
function renderPresets(){
  const list=$("#presetList");$("#presetEmpty").classList.toggle("hidden",state.presets.length>0);
  list.innerHTML=state.presets.map(p=>'<article class="preset-card"><div class="preset-main"><div><div class="preset-title">'+escapeHtml(p.title)+'</div><div class="preset-meta">'+formatTime(p.a)+' – '+formatTime(p.b)+' · '+p.repeats+' tekrar · '+p.rate+'×</div></div></div><div class="preset-actions"><button data-use="'+p.id+'">Aç</button><button data-delete="'+p.id+'">Sil</button></div></article>').join("");
  list.querySelectorAll("[data-use]").forEach(b=>b.onclick=()=>usePreset(state.presets.find(p=>p.id===b.dataset.use)));
  list.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>deletePreset(b.dataset.delete));
}
function renderRecent(){
  const list=$("#recentList");$("#recentEmpty").classList.toggle("hidden",state.recent.length>0);
  list.innerHTML=state.recent.map(r=>'<article class="recent-item"><div class="recent-main"><div><div class="recent-title">YouTube video</div><div class="recent-meta">'+escapeHtml(r.videoId)+'</div></div></div><div class="recent-actions"><button data-recent="'+r.videoId+'">Aç</button></div></article>').join("");
  list.querySelectorAll("[data-recent]").forEach(b=>b.onclick=()=>loadVideo(b.dataset.recent,false));
}

$("#loadBtn").onclick=()=>loadVideo($("#videoUrl").value,false);
$("#videoUrl").addEventListener("keydown",e=>{if(e.key==="Enter")loadVideo(e.currentTarget.value,false)});
$("#setStartBtn").onclick=()=>setPoint("a");$("#setEndBtn").onclick=()=>setPoint("b");
document.querySelectorAll("[data-nudge-start]").forEach(b=>b.onclick=()=>nudge("a",Number(b.dataset.nudgeStart)));
document.querySelectorAll("[data-nudge-end]").forEach(b=>b.onclick=()=>nudge("b",Number(b.dataset.nudgeEnd)));
$("#startLoopBtn").onclick=startLoop;$("#stopLoopBtn").onclick=()=>stopLoop(true);
$("#savePresetBtn").onclick=openSaveDialog;$("#confirmSavePreset").addEventListener("click",savePreset);
["#startTime","#endTime","#repeatCount"].forEach(s=>$(s).addEventListener("input",updateRangeStatus));
$("#playbackRate").addEventListener("change",()=>{if(playerReady&&player)player.setPlaybackRate(Number($("#playbackRate").value)||1)});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;$("#installBtn").classList.remove("hidden")});
$("#installBtn").onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$("#installBtn").classList.add("hidden")};

if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js?v=1");
renderPresets();renderRecent();updateRangeStatus();
