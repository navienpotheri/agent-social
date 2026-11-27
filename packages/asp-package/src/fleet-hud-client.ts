/**
 * The script of the fleet HUD (register row DK1601): the dense operations view and its replay. Plain JavaScript, no outside origin, run in the visitor's browser. It asks the service for a window of the fleet's real records
 * (`/fleet/<fleet>/hud-data?range=` or `from=&to=`) and draws them on a canvas as a graph (the fleet's members in a column, grouped by persona or node, fanning out in fine curved edges to a ruler column of the parties they dealt
 * with; an edge lights up when its record is reached and fades), step cards (one per group: queued, active, done, with a spend bar, a jobs dial, refusal dots and a sparkline), a live log in words, a risk matrix with bars, and a scorecard.
 * LIVE follows the present (polls every 3 seconds); REPLAY plays any past window with play, pause, step, speed and a scrubber, so a short run can be recorded. Every number and graph has its table in a details block. The token is
 * typed by the visitor, kept in this tab, sent in a header; `#t=` in the address is read and removed. Everything from the service is escaped. Written without template literals so it can sit in a string.
 */
export const HUD_CLIENT_SCRIPT = String.raw`(function(){
var FLEET=__FLEET__,KEY="asp-fleet-token";
var $=function(id){return document.getElementById(id)};
var tok="";try{tok=sessionStorage.getItem(KEY)||""}catch(e){}
var reduce=false;try{reduce=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)}catch(e){}
var RANGES={"1h":3600000,"24h":86400000,"7d":604800000,"30d":2592000000};
var S={mode:"replay",range:"24h",D:null,P:0,playing:false,speed:1,last:0,seen:0,timer:null,fade:[],sel:-1};
var KC={1:"spend",2:"run",3:"job",4:"pay",5:"slash",6:"drift",7:"refused"};
function esc(x){return String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function get(p){return fetch(p,{headers:{authorization:"Bearer "+tok,accept:"application/json"},cache:"no-store"}).then(function(r){if(!r.ok)throw r.status;return r.json()})}
function clock(t){var d=new Date(t);return d.toISOString().slice(11,19)}
function day(t){return new Date(t).toISOString().slice(0,16).replace("T"," ")}
var cv=$("graph"),cx=cv.getContext?cv.getContext("2d"):null;
var pos=[],W=0,H=0;
function layout(){
 var D=S.D;if(!D||!cx)return;var r=cv.getBoundingClientRect();W=cv.width=Math.max(300,Math.floor(r.width)||600);H=cv.height=Math.max(220,Math.floor(r.height)||320);
 var mem=[],out=[];D.nodes.forEach(function(n){(n.kind==="member"?mem:out).push(n)});
 mem.sort(function(a,b){return a.group-b.group});
 mem.forEach(function(n,i){pos[n.id]={x:18,y:12+(H-24)*(mem.length<2?.5:i/(mem.length-1))}});
 out.forEach(function(n,i){pos[n.id]={x:W-18,y:12+(H-24)*(out.length<2?.5:i/(out.length-1))}});
}
function edge(a,b){
 var p=pos[a],q=pos[b];if(!p||!q)return null;var m=(p.x===q.x)?W*.45:(p.x+q.x)/2;return {x1:p.x,y1:p.y,x2:q.x,y2:q.y,cx1:m,cy1:p.y,cx2:m,cy2:q.y};
}
function stateAt(P){
 var D=S.D,G=D.groups.map(function(g){return {credits:0,jobs:0,total:0,ref:0,slash:0,drift:0,rel:0,n:0,lastT:0,firstT:0,spark:new Array(24).fill(0)}});
 var tot={events:0,credits:0,tokens:0,jobs:0,slash:0,drift:0,ref:0,rel:0},span=Math.max(1,D.to-D.from);
 for(var i=0;i<D.events.length;i++){var e=D.events[i];if(e.t>P)break;tot.events++;var g=G[e.g];
  if(e.k===1)tot.credits+=e.v;if(e.k===2)tot.tokens+=e.v;if(e.k===3)tot.jobs++;if(e.k===5){tot.slash++;tot.jobs++}if(e.k===6)tot.drift++;if(e.k===7)tot.ref++;if(e.f&8)tot.rel++;
  if(g){g.n++;g.lastT=e.t;if(!g.firstT)g.firstT=e.t;if(e.k===1)g.credits+=e.v;if(e.k===3||e.k===5)g.total++;if(e.k===3)g.jobs++;if(e.k===7)g.ref++;if(e.k===5)g.slash++;if(e.k===6)g.drift++;if(e.f&8)g.rel++;g.spark[Math.min(23,Math.floor((e.t-D.from)/span*24))]++}}
 return {G:G,tot:tot};
}
function draw(){
 var D=S.D;if(!D||!cx)return;cx.clearRect(0,0,W,H);
 var css=getComputedStyle(document.documentElement),acc=css.getPropertyValue("--acc")||"#ff8a1f",dim=css.getPropertyValue("--dim")||"#3a3a3a",bad=css.getPropertyValue("--bad")||"#ff4d4d";
 cx.lineWidth=1;cx.fillStyle=dim;
 D.nodes.forEach(function(n){var p=pos[n.id];if(!p)return;cx.globalAlpha=.9;cx.fillRect(p.x-(n.kind==="member"?3:8),p.y-1,n.kind==="member"?6:16,n.kind==="member"?3:2)});
 // the edges reached so far, the newest bright, older fading; edges of flagged records in red
 var from=0;for(var i=D.events.length-1;i>=0;i--){if(D.events[i].t<=S.P){from=i;break}}
 var look=Math.min(D.events.length,reduce?40:140);
 for(var j=Math.max(0,from-look);j<=from&&D.events.length;j++){var e=D.events[j];if(e.t>S.P)break;var age=(from-j)/look,ed=edge(e.a,e.b);if(!ed)continue;
  cx.globalAlpha=reduce?.55:Math.max(.08,1-age);cx.strokeStyle=(e.f&7)?bad:acc;cx.lineWidth=(j===from)?2:1;cx.beginPath();cx.moveTo(ed.x1,ed.y1);cx.bezierCurveTo(ed.cx1,ed.cy1,ed.cx2,ed.cy2,ed.x2,ed.y2);cx.stroke()}
 cx.globalAlpha=1;
}
function bar(v,max,cls){var w=max>0?Math.min(100,Math.round(v/max*100)):0;return '<span class="bar '+(cls||"")+'"><i style="width:'+w+'%"></i></span>'}
function spark(a){var m=Math.max.apply(null,a.concat([1]));return '<span class="spk">'+a.map(function(v){return '<i style="height:'+Math.round(v/m*100)+'%"></i>'}).join("")+'</span>'}
function render(){
 var D=S.D;if(!D)return;var st=stateAt(S.P),T=st.tot;
 $("clock").textContent=clock(S.P);$("day").textContent=day(S.P);
 $("scrub").max=String(D.to-D.from);$("scrub").value=String(Math.max(0,Math.min(D.to-D.from,S.P-D.from)));
 var cards=D.groups.map(function(g,i){var s=st.G[i],state=s.n===0?"queued":(S.P-s.lastT<(D.to-D.from)/12&&S.P<D.to?"active":(S.P>=D.to||s.lastT<S.P-(D.to-D.from)/12?"done":"active"));
  if(s.n===0)state="queued";
  var dots="";for(var k=0;k<Math.min(8,s.ref);k++)dots+='<b class="dot bad"></b>';
  return '<div class="card2 '+state+(g.flagged?" flag":"")+'" tabindex="0" data-g="'+i+'"><h3>'+esc(g.name)+'<small>'+g.members+' agents</small></h3><p class="st">'+state.toUpperCase()+'</p>'
   +'<p>spend '+s.credits+(g.budget!==null?' / '+g.budget:"")+bar(s.credits,g.budget!==null?g.budget:Math.max(1,g.credits),g.over?"bad":"")+'</p><p>jobs '+s.jobs+' / '+Math.max(s.total,s.jobs)+bar(s.jobs,Math.max(1,s.total))+'</p><p>refused '+dots+(s.ref?"":'<em>none</em>')+'</p>'+spark(s.spark)+'</div>'}).join("");
 $("cards").innerHTML=cards;
 var maxR=Math.max.apply(null,D.groups.map(function(g,i){var s=st.G[i];return s.ref+s.slash+s.drift+s.rel}).concat([1]));
 var risk=D.groups.map(function(g,i){var s=st.G[i],sc=s.ref+s.slash+s.drift+s.rel;return '<tr class="'+(sc?"flag":"")+'"><th scope="row">'+esc(g.name)+'</th><td>'+s.ref+'</td><td>'+(g.over?"over":"ok")+'</td><td>'+s.drift+'</td><td>'+s.slash+'</td><td>'+s.rel+'</td><td>'+bar(sc,maxR,sc?"bad":"")+'</td></tr>'}).join("");
 $("risk").innerHTML=risk;
 var flaggedN=D.groups.filter(function(g,i){var s=st.G[i];return s.ref+s.slash+s.drift>0||g.over}).length;
 $("flagged").textContent=flaggedN+" of "+D.groups.length+" flagged";
 var c=D.totals.cap.credits;
 $("score").innerHTML='<li><span>jobs done</span><b>'+T.jobs+' / '+Math.max(D.totals.jobsTotal,T.jobs)+'</b></li><li><span>spend</span><b>'+T.credits+(c!==null?' / '+c:"")+' credits</b>'+bar(T.credits,c!==null?c:Math.max(1,D.totals.credits))+'</li><li><span>tokens</span><b>'+T.tokens+'</b></li><li><span>latency</span><b>'+(D.totals.latencyMinutes===null?"n/a":D.totals.latencyMinutes+" min")+'</b></li><li><span>records shown</span><b>'+T.events+(D.sampled?" (sampled of "+D.totals.events+")":"")+'</b></li><li><span>activity</span>'+spark(D.spark)+'</li>';
 $("rail").innerHTML='<h2>Mandate</h2><p>'+esc(D.rail.purpose||"")+'</p><p>'+(D.rail.template?esc(D.rail.template):"no template")+'</p><h2>Caps</h2><p>credits '+(D.rail.capCredits===null?"none":D.rail.capCredits)+' / tokens '+(D.rail.capTokens===null?"none":D.rail.capTokens)+'</p><h2>Members</h2><p class="big">'+D.totals.members+(D.rail.maxMembers?' <small>of '+D.rail.maxMembers+'</small>':"")+'</p><h2>Flags</h2><p class="big">'+(D.totals.slashes+D.totals.drift+D.totals.refusals)+'</p><h2>Halted</h2><p>'+(D.totals.halted.length?D.totals.halted.map(function(h){return esc(h.node)+": "+esc(h.reason.replace("_"," "))+", "+h.runs+" run(s)"}).join("; "):"no node halted")+'</p><h2>Freeze</h2><p>'+(D.totals.frozen?"fleet frozen":"running")+', '+D.rail.frozenMembers+' members, '+D.rail.frozenNodes.length+' nodes frozen</p>';
 var logs=[];for(var i=D.events.length-1;i>=0&&logs.length<14;i--){var e=D.events[i];if(e.t<=S.P)logs.push('<li class="k-'+(KC[e.k]||"")+(e.f&7?" flag":"")+'"><time>'+day(e.t).slice(5)+'</time> '+esc(e.x)+'</li>')}
 $("log").innerHTML=logs.join("")||'<li class="mut">Nothing yet at this point of the window.</li>';
 var tb='';for(var i=0;i<D.events.length;i++){var e=D.events[i];if(e.t>S.P)break;tb='<tr><td>'+day(e.t)+'</td><td>'+(KC[e.k]||e.k)+'</td><td>'+e.v+'</td><td>'+esc(e.x)+'</td></tr>'+tb;if(i>200)break}
 $("tbl").innerHTML=tb;
 draw();
}
function setData(D){S.D=D;layout();if(S.mode==="replay"){if(S.P<D.from||S.P>D.to)S.P=D.from}else S.P=D.to;$("status").textContent=(S.mode==="live"?"LIVE":"REPLAY")+" · "+D.events.length+" records"+(D.sampled?" (sampled)":"")+" · "+D.fleet.name;$("scope").textContent=day(D.from)+" to "+day(D.to);render();if(!S.auto&&S.mode==="replay"){var am=/[?&]at=([0-9.]+)/.exec(location.search||"");if(am){S.auto=1;S.P=D.from+Math.min(1,Number(am[1]))*(D.to-D.from);render()}else if(/autoplay=1/.test(location.search||"")){S.auto=1;play()}}}
function load(){
 if(!tok){$("status").textContent="Enter your token to start.";return}
 get("/fleet/"+encodeURIComponent(FLEET)+"/hud-data?range="+S.range+(S.mode==="replay"&&S.to?"&to="+S.to:"")+"&pace="+(S.mode==="live"?"live":"replay")).then(setData).catch(function(c){$("status").textContent=c===401||c===403?"The token was not accepted for this fleet.":"Could not load ("+c+")."})}
function frame(ts){
 if(S.playing&&S.D){var dt=S.last?ts-S.last:0;S.last=ts;var winMs=S.D.to-S.D.from,perSec=winMs/30*S.speed;S.P+=perSec*dt/1000;if(S.P>=S.D.to){S.P=S.D.to;S.playing=false;$("play").textContent="Play";$("play").setAttribute("aria-pressed","false")}render()}else S.last=0;
 requestAnimationFrame(frame)}
function play(){if(!S.D)return;if(S.P>=S.D.to)S.P=S.D.from;S.playing=!S.playing;$("play").textContent=S.playing?"Pause":"Play";$("play").setAttribute("aria-pressed",S.playing?"true":"false");if(reduce&&S.playing){S.playing=false;$("play").textContent="Play";$("play").setAttribute("aria-pressed","false");S.P=S.D.to;render()}}
function step(d){if(!S.D)return;S.playing=false;$("play").textContent="Play";var ev=S.D.events,i;if(d>0){for(i=0;i<ev.length;i++)if(ev[i].t>S.P){S.P=ev[i].t;break}if(i===ev.length)S.P=S.D.to}else{for(i=ev.length-1;i>=0;i--)if(ev[i].t<S.P){S.P=ev[i].t;break}if(i<0)S.P=S.D.from}render()}
function setMode(m){S.mode=m;S.playing=false;$("play").textContent="Play";["live","replay"].forEach(function(x){$("m-"+x).setAttribute("aria-pressed",String(x===m))});$("replaybar").hidden=m==="live";clearInterval(S.timer);load();if(m==="live")S.timer=setInterval(load,3000)}
$("play").addEventListener("click",play);$("prev").addEventListener("click",function(){step(-1)});$("next").addEventListener("click",function(){step(1)});
$("scrub").addEventListener("input",function(){if(!S.D)return;S.playing=false;$("play").textContent="Play";S.P=S.D.from+Number($("scrub").value);render()});
Array.prototype.forEach.call(document.querySelectorAll("[data-speed]"),function(b){b.addEventListener("click",function(){S.speed=Number(b.getAttribute("data-speed"));Array.prototype.forEach.call(document.querySelectorAll("[data-speed]"),function(o){o.setAttribute("aria-pressed",String(o===b))})})});
Array.prototype.forEach.call(document.querySelectorAll("[data-range]"),function(b){b.addEventListener("click",function(){S.range=b.getAttribute("data-range");Array.prototype.forEach.call(document.querySelectorAll("[data-range]"),function(o){o.setAttribute("aria-pressed",String(o===b))});load()})});
$("m-live").addEventListener("click",function(){setMode("live")});$("m-replay").addEventListener("click",function(){setMode("replay")});
$("go").addEventListener("click",function(){tok=$("tok").value.trim();if(!tok)return;try{sessionStorage.setItem(KEY,tok)}catch(e){}$("tok").value="";load()});
document.addEventListener("keydown",function(e){if(/INPUT|SELECT|TEXTAREA/.test((e.target||{}).tagName||""))return;if(e.key===" "){e.preventDefault();play()}else if(e.key==="ArrowRight")step(1);else if(e.key==="ArrowLeft")step(-1)});
window.addEventListener("resize",function(){layout();render()});
try{if(location.hash.indexOf("#t=")===0){tok=decodeURIComponent(location.hash.slice(3));if(history&&history.replaceState)history.replaceState(null,"",location.pathname+location.search);try{sessionStorage.setItem(KEY,tok)}catch(e){}}}catch(e){}
window.__hud={state:S,load:load,render:render,play:play,step:step};
var mq=/range=(1h|24h|7d|30d)/.exec(location.search||"");if(mq){S.range=mq[1];Array.prototype.forEach.call(document.querySelectorAll("[data-range]"),function(o){o.setAttribute("aria-pressed",String(o.getAttribute("data-range")===S.range))})}
requestAnimationFrame(frame);setMode("replay");
})();`;
