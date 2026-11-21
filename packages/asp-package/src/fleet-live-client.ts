/**
 * The script of the live dashboard (register row DK1601, the dynamic version). Plain JavaScript with no outside origin, run in the visitor's browser. It asks the service for a summary (`/fleet/<fleet>/summary`) and for the records a
 * fleet's members wrote after the last one it saw (`/fleet/<fleet>/events?since=`), every 2 seconds, so a new record appears as it is written, with no reload; it draws the tiles, the graphs and the bar tables itself, tweens every
 * number from the old answer to the new one (a single step when the visitor prefers reduced motion), and offers: the time range (1h, 24h, 7d, 30d), filters by persona, node and tier, a fleet switch, hover and keyboard tooltips with the
 * exact values, a click on a bar to filter or on a member to open the journey, a live ticker, pause and resume, and a table of the same numbers for every graph. The token is typed by the visitor, kept in this tab and sent in a header; it
 * can also arrive in the address fragment (`#t=`), which never reaches the server, and is removed from the address at once. Everything drawn from the service is escaped. Written without template literals so it can sit in a string.
 */
export const LIVE_CLIENT_SCRIPT = String.raw`(function(){
var FLEET=__FLEET__,KEY="asp-fleet-token";
var $=function(id){return document.getElementById(id)};
var box=$("live"),st=$("status"),inp=$("tok"),go=$("go"),stopB=$("stop"),pauseB=$("pause"),tick=$("ticker"),tipEl=$("tip"),sw=$("fleetsel"),msg=$("announce");
var tok="";try{tok=sessionStorage.getItem(KEY)||""}catch(e){}
var reduce=false;try{reduce=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)}catch(e){}
var S={range:"24h",persona:"",node:"",tier:"",paused:false,shown:null,target:null,head:0,timer:null,detail:null,cursor:{},busy:false,frames:0};
function esc(x){return String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function q(){var p=["range="+S.range];if(S.persona)p.push("persona="+encodeURIComponent(S.persona));if(S.node)p.push("node="+encodeURIComponent(S.node));if(S.tier)p.push("tier="+encodeURIComponent(S.tier));return p.join("&")}
function get(path){return fetch(path,{headers:{authorization:"Bearer "+tok,accept:"application/json"},cache:"no-store"}).then(function(r){if(!r.ok)throw r.status;return r.json()})}
function lerp(a,b,t){
 if(typeof a==="number"&&typeof b==="number")return a+(b-a)*t;
 if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length)return b.map(function(v,i){return typeof v==="number"?lerp(a[i],v,t):v});
 if(a&&b&&typeof a==="object"&&typeof b==="object"&&!Array.isArray(b)){var o={};Object.keys(b).forEach(function(k){o[k]=lerp(a[k]===undefined?(typeof b[k]==="number"?0:b[k]):a[k],b[k],t)});return o}
 return b}
function mix(a,b,t){var o={};Object.keys(b).forEach(function(k){o[k]=lerp(a&&a[k]!==undefined?a[k]:0,b[k],t)});return o}
function interp(a,b,t){
 var d={};Object.keys(b).forEach(function(k){d[k]=b[k]});
 d.tiles=lerp(a.tiles,b.tiles,t);
 if(a.range===b.range&&a.series.labels.length===b.series.labels.length){d.series={labels:b.series.labels};["credits","tokens","slashes","drift","records","members"].forEach(function(k){d.series[k]=lerp(a.series[k],b.series[k],t)})}
 d.mix={persona:mix(a.mix.persona,b.mix.persona,t),tier:mix(a.mix.tier,b.mix.tier,t),node:mix(a.mix.node,b.mix.node,t)};
 return d}
function r0(v){return Math.round(v)}
function niceMax(m){if(m<=0)return 1;var p=Math.pow(10,Math.floor(Math.log(m)/Math.LN10)),f=m/p;return(f<=1?1:f<=2?2:f<=5?5:10)*p}
function line(id,title,labels,series,unit){
 var W=640,H=220,L=46,R=12,T=12,B=28,n=labels.length,all=[];series.forEach(function(s){s.values.forEach(function(v){all.push(v)})});
 var top=niceMax(Math.max.apply(null,[0].concat(all)));
 function x(i){return L+(n<=1?(W-L-R)/2:i*(W-L-R)/(n-1))}function y(v){return T+(H-T-B)*(1-v/top)}
 var lines="",sum=title+". ";
 series.forEach(function(s,k){
  lines+='<polyline class="ln s'+(k+1)+'" fill="none" points="'+s.values.map(function(v,i){return x(i).toFixed(1)+","+y(v).toFixed(1)}).join(" ")+'"/>';
  s.values.forEach(function(v,i){lines+='<circle class="pt s'+(k+1)+'" data-chart="'+id+'" data-i="'+i+'" data-tip="'+esc(s.name+", "+labels[i]+": "+r0(v)+(unit?" "+unit:""))+'" cx="'+x(i).toFixed(1)+'" cy="'+y(v).toFixed(1)+'" r="3"/>'});
  sum+=s.name+": "+(s.values.length?"from "+r0(s.values[0])+" to "+r0(s.values[n-1]):"no data")+(k<series.length-1?"; ":".")});
 var cur=S.cursor[id];var cursor="";if(cur!==undefined&&cur<n)cursor='<line class="cursor" x1="'+x(cur).toFixed(1)+'" x2="'+x(cur).toFixed(1)+'" y1="'+T+'" y2="'+(H-B)+'"/>';
 var legend=series.length>1?'<p class="legend-k">'+series.map(function(s,k){return '<span><i class="sw2 s'+(k+1)+'"></i>'+esc(s.name)+'</span>'}).join("")+'</p>':"";
 var tbl='<details class="chart-table" data-d="'+id+'"><summary>Table of the same numbers</summary><div class="table-wrap"><table><thead><tr><th>Time</th>'+series.map(function(s){return '<th class="num">'+esc(s.name)+'</th>'}).join("")+'</tr></thead><tbody>'+labels.map(function(l,i){return '<tr><td>'+esc(l)+'</td>'+series.map(function(s){return '<td class="num">'+r0(s.values[i])+'</td>'}).join("")+'</tr>'}).join("")+'</tbody></table></div></details>';
 return '<figure class="chart" tabindex="0" data-chart="'+id+'" data-n="'+n+'" aria-label="'+esc(sum+" Use the left and right arrow keys to read each point.")+'"><figcaption><b>'+esc(title)+'</b></figcaption><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(sum)+'"><line class="axis" x1="'+L+'" x2="'+L+'" y1="'+T+'" y2="'+(H-B)+'"/><line class="axis" x1="'+L+'" x2="'+(W-R)+'" y1="'+(H-B)+'" y2="'+(H-B)+'"/><text class="lab" x="'+(L-6)+'" y="'+(T+8)+'" text-anchor="end">'+top+'</text><text class="lab" x="'+(L-6)+'" y="'+(H-B)+'" text-anchor="end">0</text><text class="lab" x="'+L+'" y="'+(H-8)+'">'+esc(labels[0]||"")+'</text><text class="lab" x="'+(W-R)+'" y="'+(H-8)+'" text-anchor="end">'+esc(labels[n-1]||"")+'</text>'+cursor+lines+'</svg>'+legend+tbl+'</figure>'}
function bars(key,title,m){
 var rows=Object.keys(m).sort(function(a,b){return m[b]-m[a]||(a<b?-1:1)}),max=Math.max.apply(null,[1].concat(rows.map(function(k){return m[k]})));
 var body=rows.length?'<table><thead><tr><th>'+esc(title)+'</th><th class="num">Members</th><th><span class="vh">Bar</span></th></tr></thead><tbody>'+rows.map(function(k){var on=S[key]===k;return '<tr class="pick'+(on?" on":"")+'" tabindex="0" role="button" aria-pressed="'+on+'" data-filter="'+key+':'+esc(k)+'" data-tip="'+esc(title+" "+k+": "+r0(m[k])+" members. Click to filter.")+'"><td>'+esc(k)+'</td><td class="num">'+r0(m[k])+'</td><td class="barcell"><span class="bar" style="width:'+Math.max(1,Math.round(m[k]/max*100))+'%"></span></td></tr>'}).join("")+'</tbody></table>':'<p class="mut">No members match.</p>';
 return '<figure class="chart bars"><div class="table-wrap">'+body+'</div></figure>'}
function tiles(t){var items=[["members",t.members],["credits",t.credits],["tokens",t.tokens],["slashes",t.slashes],["drift",t.drift],["frozen",t.frozen],["records",t.records]];return '<div class="tiles">'+items.map(function(i){return '<div class="tile"><b>'+r0(i[1])+'</b><span>'+i[0]+'</span></div>'}).join("")+'</div>'}
function members(d){
 var rows=d.top.map(function(m){return '<tr class="pick" tabindex="0" role="link" data-href="'+esc(m.journey)+'" data-tip="'+esc(m.name+": "+m.credits+" credits, "+m.tokens+" tokens. Click to open its journey.")+'"><td><a href="'+esc(m.journey)+'">'+esc(m.name)+'</a>'+(m.frozen?' <span class="badge">frozen</span>':'')+'</td><td>'+esc(m.persona||"none")+'</td><td>'+esc(m.node)+'</td><td class="num">'+(m.tier===null?"-":m.tier)+'</td><td class="num">'+m.credits+'</td><td class="num">'+m.tokens+'</td></tr>'}).join("");
 return '<div class="table-wrap"><table><thead><tr><th>Agent</th><th>Persona</th><th>Node</th><th class="num">Tier</th><th class="num">Credits</th><th class="num">Tokens</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="mut">The busiest '+d.shown+' of '+d.tiles.members+' members in this range. Everything above is counted over all of them on the server.</p>'}
function render(d){
 var s=d.series;
 var openIds=[];box.querySelectorAll("details").forEach(function(x){if(x.open)openIds.push(x.getAttribute("data-d"))});
 var h='<h2>Now</h2><p class="mut">'+esc(d.fleet.name)+', the last '+(d.range==="1h"?"hour":d.range==="24h"?"24 hours":d.range==="7d"?"7 days":"30 days")+' in steps of '+esc(d.bucket)+(S.persona||S.node||S.tier?", filtered":"")+'.</p>'+tiles(d.tiles);
 h+='<h2>Over time</h2>'+line("spend","Credits and tokens a step",s.labels,[{name:"credits",values:s.credits},{name:"tokens (hundreds)",values:s.tokens.map(function(v){return v/100})}])
  +line("members","Members of the fleet",s.labels,[{name:"members",values:s.members}],"members")
  +line("risk","Slashes and drift a step",s.labels,[{name:"slashes",values:s.slashes},{name:"drift diagnoses",values:s.drift}])
  +line("records","Records written a step",s.labels,[{name:"records",values:s.records}]);
 h+='<h2>Mix</h2><p class="mut">Click a row to filter the whole page by it.</p><div class="mixgrid">'+bars("persona","Members by persona",d.mix.persona)+bars("tier","Members by tier",d.mix.tier)+bars("node","Members by node",d.mix.node)+'</div>';
 h+='<h2>Members</h2>'+members(d);
 box.innerHTML=h;
 box.querySelectorAll("details").forEach(function(x){if(openIds.indexOf(x.getAttribute("data-d"))>=0)x.open=true});
 S.shown=d}
function fill(sel,vals,cur,none){if(!sel)return;var h='<option value="">'+none+'</option>'+vals.map(function(v){return '<option value="'+esc(v)+'"'+(v===cur?" selected":"")+'>'+esc(v)+'</option>'}).join("");sel.innerHTML=h}
function controls(d){fill($("f-persona"),d.options.persona,S.persona,"All personas");fill($("f-node"),d.options.node,S.node,"All nodes");fill($("f-tier"),d.options.tier,S.tier,"All tiers");
 document.querySelectorAll("[data-range]").forEach(function(b){var on=b.getAttribute("data-range")===S.range;b.setAttribute("aria-pressed",String(on));b.className=on?"chip on":"chip"})}
function animateTo(d){
 S.target=d;controls(d);
 var from=S.shown;
 if(reduce||!from||from.range!==d.range||typeof window.requestAnimationFrame!=="function"){render(d);return}
 var start=null,dur=400,id=++S.frames;
 function step(ts){if(id!==S.frames)return;if(start===null)start=ts;var t=Math.min(1,(ts-start)/dur);t=t*(2-t);render(t>=1?d:interp(from,d,t));if(t<1)window.requestAnimationFrame(step)}
 window.requestAnimationFrame(step)}
function loadSummary(){if(!tok)return Promise.resolve();return get("/fleet/"+encodeURIComponent(FLEET)+"/summary?"+q()).then(function(d){animateTo(d);st.textContent=(S.paused?"Paused. ":"Live: ")+"updated "+new Date().toLocaleTimeString()+(S.paused?".":", checking every 2 seconds.")}).catch(fail)}
function ticker(evs){if(!tick||!evs.length)return;var h=evs.slice().reverse().map(function(e){return '<li class="new k-'+esc(e.kind)+'"><time>'+esc(e.at.slice(11,16))+'</time> <a href="'+esc(e.journey)+'">'+esc(e.text)+'</a></li>'}).join("");tick.innerHTML=h+tick.innerHTML;var items=tick.querySelectorAll("li");for(var i=items.length-1;i>=30;i--)tick.removeChild(items[i]);if(msg)msg.textContent=evs.length+" new record"+(evs.length===1?"":"s")+": "+evs[evs.length-1].text}
function poll(){if(S.paused||document.hidden||!tok||S.busy)return;S.busy=true;get("/fleet/"+encodeURIComponent(FLEET)+"/events?since="+S.head).then(function(e){S.busy=false;var first=S.head===0;S.head=e.head;ticker(first?e.events.slice(-8):e.events);if(e.events.length||first)return loadSummary()}).catch(function(x){S.busy=false;fail(x)})}
function fail(e){st.textContent="Could not update ("+e+")."+(e===401||e===403?" Check the token.":" Trying again.");if(e===401||e===403)halt()}
function run(){halt();S.head=0;S.paused=false;pauseB.textContent="Pause";pauseB.setAttribute("aria-pressed","false");poll();S.timer=setInterval(poll,2000);stopB.disabled=false;pauseB.disabled=false;listFleets()}
function halt(){if(S.timer){clearInterval(S.timer);S.timer=null}stopB.disabled=true;pauseB.disabled=true}
function listFleets(){get("/fleets/mine").then(function(r){if(!sw)return;sw.innerHTML=r.fleets.map(function(f){return '<option value="'+esc(f.id)+'"'+(f.id===FLEET||f.name===FLEET?" selected":"")+'>'+esc(f.name)+'</option>'}).join("")}).catch(function(){})}
function tip(el,x,y){if(!tipEl)return;var t=el&&el.getAttribute&&el.getAttribute("data-tip");if(!t){tipEl.hidden=true;return}tipEl.textContent=t;tipEl.hidden=false;tipEl.style.left=(x||0)+"px";tipEl.style.top=(y||0)+"px"}
if(box){
 box.addEventListener("mouseover",function(ev){var el=ev.target.closest?ev.target.closest("[data-tip]"):null;tip(el,ev.clientX,ev.clientY)});
 box.addEventListener("mouseout",function(){tip(null)});
 box.addEventListener("focusin",function(ev){var el=ev.target.closest?ev.target.closest("[data-tip]"):null;if(el){var r=el.getBoundingClientRect?el.getBoundingClientRect():{left:0,top:0};tip(el,r.left,r.top)}});
 box.addEventListener("click",function(ev){
  var f=ev.target.closest?ev.target.closest("[data-filter]"):null;
  if(f){var p=f.getAttribute("data-filter").split(":"),k=p.shift(),v=p.join(":");S[k]=S[k]===v?"":v;loadSummary();ev.preventDefault&&ev.preventDefault();return}
  var h=ev.target.closest?ev.target.closest("[data-href]"):null;
  if(h&&!(ev.target.tagName==="A")){window.location.href=h.getAttribute("data-href");return}
  var pt=ev.target.closest?ev.target.closest(".pt"):null;
  if(pt){var id=pt.getAttribute("data-chart"),i=Number(pt.getAttribute("data-i"));S.cursor[id]=i;S.detail=pt.getAttribute("data-tip");if(msg)msg.textContent=S.detail;render(S.shown)}});
 box.addEventListener("keydown",function(ev){
  var row=ev.target.closest?ev.target.closest("tr.pick"):null;
  if(row&&(ev.key==="Enter"||ev.key===" ")){ev.preventDefault&&ev.preventDefault();row.click?row.click():0;return}
  var fig=ev.target.closest?ev.target.closest("figure.chart[data-chart]"):null;
  if(fig&&(ev.key==="ArrowRight"||ev.key==="ArrowLeft")){var id=fig.getAttribute("data-chart"),n=Number(fig.getAttribute("data-n")),c=S.cursor[id];c=c===undefined?(ev.key==="ArrowRight"?0:n-1):Math.max(0,Math.min(n-1,c+(ev.key==="ArrowRight"?1:-1)));S.cursor[id]=c;ev.preventDefault&&ev.preventDefault();
   var pts=fig.querySelectorAll(".pt");var tips=[];for(var j=0;j<pts.length;j++){if(Number(pts[j].getAttribute("data-i"))===c)tips.push(pts[j].getAttribute("data-tip"))}
   if(msg)msg.textContent=tips.join("; ");render(S.shown);var again=box.querySelector('figure.chart[data-chart="'+id+'"]');if(again&&again.focus)again.focus()}})}
document.querySelectorAll("[data-range]").forEach(function(b){b.addEventListener("click",function(){S.range=b.getAttribute("data-range");loadSummary()})});
["persona","node","tier"].forEach(function(k){var el=$("f-"+k);if(el)el.addEventListener("change",function(){S[k]=el.value;loadSummary()})});
if(sw)sw.addEventListener("change",function(){window.location.href="/fleet/"+encodeURIComponent(sw.value)+"/live"});
go.addEventListener("click",function(){tok=inp.value.trim();if(!tok){st.textContent="Enter your token to start.";return}try{sessionStorage.setItem(KEY,tok)}catch(e){}inp.value="";run()});
stopB.addEventListener("click",function(){halt();st.textContent="Stopped. Start again with your token."});
pauseB.addEventListener("click",function(){S.paused=!S.paused;pauseB.textContent=S.paused?"Resume":"Pause";pauseB.setAttribute("aria-pressed",String(S.paused));st.textContent=S.paused?"Paused: nothing is fetched until you resume.":"Live again.";if(!S.paused)poll()});
try{if(location.hash.indexOf("#t=")===0){tok=decodeURIComponent(location.hash.slice(3));if(history&&history.replaceState)history.replaceState(null,"",location.pathname+location.search);try{sessionStorage.setItem(KEY,tok)}catch(e){}}}catch(e){}
if(tok)run();else st.textContent="Enter your token to start.";
})();`;
