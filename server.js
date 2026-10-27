const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const ARENA = { w: 1800, h: 1100 };
const COLORS = ['#ff4fa3','#35d9ff','#ffd43b','#8bff65','#a778ff','#ff784d','#4cf0bd','#ff6b78','#63a4ff','#f48cff','#b6ee3d','#ffb02e'];
const rooms = new Map();
const sockets = new Set();
const DATA_FILE=process.env.DATA_FILE||path.join(__dirname,'data','stats.json');
let globalStats={dancers:0,leaderboard:[]};
try{globalStats=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));}catch{}
let statsDirty=false;
function saveStats(){if(!statsDirty)return;try{fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});fs.writeFileSync(DATA_FILE,JSON.stringify(globalStats,null,2));statsDirty=false;}catch(e){console.error('Could not save stats:',e.message)}}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => (a.x-b.x)**2 + (a.y-b.y)**2;
const clean = (s, max=14) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0,max) || 'Dancer';
const code = () => {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c; do { c=Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join(''); } while(rooms.has(c));
  return c;
};

function spawnPoint() { return { x: rand(180, ARENA.w-180), y: rand(180, ARENA.h-180), angle: rand(0, Math.PI*2) }; }
function makePlayer(id, name, emoji, bot=false, outfit='none') {
  const s=spawnPoint();
  return { id, name: bot ? `${name} 🤖` : clean(name), emoji: bot ? '🤖' : String(emoji||'😎').slice(0,4), outfit:bot?'antenna':String(outfit||'none').slice(0,12),color:'#fff', bot, connected:true,
    x:s.x,y:s.y,angle:s.angle,inputX:Math.cos(s.angle),inputY:Math.sin(s.angle),boost:false,boostFuel:1,
    count:3, trail:[], alive:true,respawnAt:0,invulnerableUntil:0,slowUntil:0,magnetUntil:0,
    peak:3,recruited:0,stolen:0,broken:0,breaksSuffered:0,score:0,lastBoostCost:0,joinedAt:Date.now(),waiting:false };
}

function makeLoose(n=36) {
  return Array.from({length:n},(_,i)=>({ id:crypto.randomUUID(), x:rand(70,ARENA.w-70), y:rand(70,ARENA.h-70), vx:rand(-18,18),vy:rand(-18,18),former:null,emoji:['💃','🕺','🪩','✨'][i%4] }));
}
function makeRoom(hostId, practice=false) {
  const room={ code:code(),hostId,phase:'lobby',players:new Map(),clients:new Map(),loose:makeLoose(),powerups:[],endsAt:0,createdAt:Date.now(),round:0,practice,callouts:[] };
  rooms.set(room.code,room); return room;
}
function addBots(room, target=4) {
  const names=['Boogie Bot','Disco Droid','Robo Rumba'];
  while(room.players.size<target) {
    const i=[...room.players.values()].filter(p=>p.bot).length;
    const p=makePlayer(`bot-${crypto.randomUUID()}`,names[i%names.length],'🤖',true);
    p.color=COLORS[room.players.size%COLORS.length]; room.players.set(p.id,p);
  }
}
function bodyPoints(p) {
  const pts=[]; const spacing=27;
  for(let i=1;i<p.count;i++) {
    const idx=Math.min(p.trail.length-1,Math.floor(i*spacing/5));
    const q=p.trail[idx]; if(q) pts.push({x:q.x,y:q.y,i});
  }
  return pts;
}
function scatter(room,p,now) {
  if(!p.alive || now < p.invulnerableUntil) return;
  for(const q of bodyPoints(p)) room.loose.push({id:crypto.randomUUID(),x:q.x+rand(-10,10),y:q.y+rand(-10,10),vx:rand(-80,80),vy:rand(-80,80),former:p.id,emoji:p.emoji});
  p.count=0;p.alive=false;p.respawnAt=now+3000;p.breaksSuffered++;
  room.callouts.push({id:crypto.randomUUID(),text:'LINE BROKEN!',x:p.x,y:p.y,until:now+1100});
}
function respawn(p) { const s=spawnPoint(); Object.assign(p,{x:s.x,y:s.y,angle:s.angle,inputX:Math.cos(s.angle),inputY:Math.sin(s.angle),count:3,alive:true,trail:[],boost:false,boostFuel:1,invulnerableUntil:Date.now()+1200}); }

function startRound(room) {
  if(room.players.size<2) return;
  if(room.players.size<4) addBots(room,4);
  room.round++;room.phase='countdown';room.countdownEnds=Date.now()+3200;room.endsAt=room.countdownEnds+120000;
  room.loose=makeLoose(46);room.powerups=[];room.callouts=[];
  for(const p of room.players.values()) { const s=spawnPoint(); Object.assign(p,{x:s.x,y:s.y,angle:s.angle,count:3,trail:[],alive:true,waiting:false,respawnAt:0,peak:3,recruited:0,stolen:0,broken:0,breaksSuffered:0,boost:false,boostFuel:1,invulnerableUntil:0,slowUntil:0,magnetUntil:0}); }
  broadcastRoom(room,{type:'roundStarting',countdownEnds:room.countdownEnds,endsAt:room.endsAt});
}
function endRound(room) {
  if(room.phase==='results') return;
  room.phase='results';
  const ranking=[...room.players.values()].filter(p=>!p.waiting).sort((a,b)=>b.count-a.count||b.peak-a.peak||b.recruited-a.recruited||a.breaksSuffered-b.breaksSuffered);
  const humans=ranking.filter(p=>!p.bot);
  for(const p of humans) {
    globalStats.leaderboard.push({name:p.name,emoji:p.emoji,length:p.peak,at:Date.now()});
  }
  globalStats.leaderboard.sort((a,b)=>b.length-a.length);globalStats.leaderboard=globalStats.leaderboard.slice(0,10);
  statsDirty=true;saveStats();
  broadcastRoom(room,{type:'results',ranking:ranking.map(publicPlayer),awards:{longest:maxBy(ranking,'peak'),stolen:maxBy(ranking,'stolen'),broken:maxBy(ranking,'broken')}});
}
function maxBy(arr,key){return arr.reduce((a,b)=>(!a||b[key]>a[key])?b:a,null) ? publicPlayer(arr.reduce((a,b)=>(!a||b[key]>a[key])?b:a,null)) : null;}
function publicPlayer(p){return {id:p.id,name:p.name,emoji:p.emoji,outfit:p.outfit,color:p.color,bot:p.bot,count:p.count,peak:p.peak,recruited:p.recruited,stolen:p.stolen,broken:p.broken,breaksSuffered:p.breaksSuffered,connected:p.connected,waiting:p.waiting};}

function botThink(room,p) {
  if(!p.alive) return;
  let target=null,best=Infinity;
  for(const d of room.loose){const dd=dist2(p,d);if(dd<best){best=dd;target=d;}}
  for(const other of room.players.values()) if(other!==p&&other.alive&&other.count<p.count-2&&Math.random()<0.002){target=other;}
  if(target){let dx=target.x-p.x,dy=target.y-p.y,l=Math.hypot(dx,dy)||1;p.inputX=dx/l;p.inputY=dy/l;}
  if(p.x<120)p.inputX=Math.abs(p.inputX);if(p.x>ARENA.w-120)p.inputX=-Math.abs(p.inputX);
  if(p.y<120)p.inputY=Math.abs(p.inputY);if(p.y>ARENA.h-120)p.inputY=-Math.abs(p.inputY);
  p.boost=Math.random()<0.008&&p.count>4&&best<90000;
}
function spawnPowerup(room,now){if(room.powerups.length>=3)return;room.powerups.push({id:crypto.randomUUID(),type:['disco','magnet','scratch'][Math.floor(Math.random()*3)],x:rand(100,ARENA.w-100),y:rand(100,ARENA.h-100),expires:now+14000});}

function tick(room,dt,now) {
  if(room.phase==='countdown'&&now>=room.countdownEnds) room.phase='playing';
  if(room.phase!=='playing') return;
  if(now>=room.endsAt) return endRound(room);
  const activeHumans=[...room.players.values()].filter(p=>!p.bot&&p.connected);
  if(activeHumans.length===0) return endRound(room);
  if(room.lastPowerup==null||now-room.lastPowerup>rand(6000,9000)){spawnPowerup(room,now);room.lastPowerup=now;}
  room.powerups=room.powerups.filter(x=>x.expires>now);
  room.callouts=room.callouts.filter(x=>x.until>now);
  for(const p of room.players.values()) {
    if(p.waiting)continue;
    if(p.bot) botThink(room,p);
    if(!p.alive){if(now>=p.respawnAt)respawn(p);continue;}
    let len=Math.hypot(p.inputX,p.inputY);if(len>.1){p.inputX/=len;p.inputY/=len;const desired=Math.atan2(p.inputY,p.inputX);let diff=((desired-p.angle+Math.PI*3)%(Math.PI*2))-Math.PI;p.angle+=clamp(diff,-3.8*dt,3.8*dt);}
    const slowing=now<p.slowUntil?.65:1; let boosting=p.boost&&p.boostFuel>0.05&&p.count>1;
    if(boosting){p.boostFuel=Math.max(0,p.boostFuel-dt*0.7);if(now-p.lastBoostCost>750){p.lastBoostCost=now;p.count--;room.loose.push({id:crypto.randomUUID(),x:p.x-Math.cos(p.angle)*35,y:p.y-Math.sin(p.angle)*35,vx:0,vy:0,former:p.id,emoji:p.emoji});}}
    else p.boostFuel=Math.min(1,p.boostFuel+dt*0.28);
    const speed=(boosting?270:175)*slowing;
    p.trail.unshift({x:p.x,y:p.y});if(p.trail.length>260)p.trail.length=260;
    p.x=clamp(p.x+Math.cos(p.angle)*speed*dt,28,ARENA.w-28);p.y=clamp(p.y+Math.sin(p.angle)*speed*dt,28,ARENA.h-28);
    for(let i=room.loose.length-1;i>=0;i--){const d=room.loose[i];if(now<p.magnetUntil){let dx=p.x-d.x,dy=p.y-d.y,dd=Math.hypot(dx,dy);if(dd<250&&dd>1){d.vx+=dx/dd*150*dt;d.vy+=dy/dd*150*dt;}}if(dist2(p,d)<32**2){room.loose.splice(i,1);p.count++;p.peak=Math.max(p.peak,p.count);p.recruited++;if(d.former&&d.former!==p.id)p.stolen++;globalStats.dancers++;statsDirty=true;room.callouts.push({id:crypto.randomUUID(),text:'+1',x:p.x,y:p.y,until:now+500});}}
    for(let i=room.powerups.length-1;i>=0;i--){const u=room.powerups[i];if(dist2(p,u)<38**2){room.powerups.splice(i,1);if(u.type==='disco')p.invulnerableUntil=now+5000;if(u.type==='magnet')p.magnetUntil=now+6000;if(u.type==='scratch')for(const o of room.players.values())if(o!==p)o.slowUntil=now+3000;room.callouts.push({id:crypto.randomUUID(),text:u.type==='disco'?'DISCO SHIELD!':u.type==='magnet'?'DANCER MAGNET!':'RECORD SCRATCH!',x:p.x,y:p.y,until:now+1100});}}
  }
  for(const d of room.loose){d.x+=d.vx*dt;d.y+=d.vy*dt;d.vx*=.985;d.vy*=.985;if(d.x<25||d.x>ARENA.w-25)d.vx*=-1;if(d.y<25||d.y>ARENA.h-25)d.vy*=-1;d.x=clamp(d.x,25,ARENA.w-25);d.y=clamp(d.y,25,ARENA.h-25);}
  const ps=[...room.players.values()].filter(p=>p.alive&&!p.waiting);
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){
    const a=ps[i],b=ps[j];
    if(dist2(a,b)<43**2){const ab=a.boost&&a.count>1,bb=b.boost&&b.count>1;if(ab&&!bb){scatter(room,b,now);a.broken++;}else if(bb&&!ab){scatter(room,a,now);b.broken++;}else{const ang=Math.atan2(a.y-b.y,a.x-b.x);a.angle=ang;b.angle=ang+Math.PI;a.x+=Math.cos(ang)*18;a.y+=Math.sin(ang)*18;b.x-=Math.cos(ang)*18;b.y-=Math.sin(ang)*18;}continue;}
    if(now>=a.invulnerableUntil&&bodyPoints(b).some(q=>dist2(a,q)<24**2)){scatter(room,a,now);b.broken++;}
    if(now>=b.invulnerableUntil&&bodyPoints(a).some(q=>dist2(b,q)<24**2)){scatter(room,b,now);a.broken++;}
  }
}

function state(room){return {type:'state',serverTime:Date.now(),room:{code:room.code,hostId:room.hostId,phase:room.phase,endsAt:room.endsAt,countdownEnds:room.countdownEnds,arena:ARENA},players:[...room.players.values()].map(p=>({...publicPlayer(p),x:p.x,y:p.y,angle:p.angle,alive:p.alive,respawnAt:p.respawnAt,boost:p.boost,boostFuel:p.boostFuel,invulnerableUntil:p.invulnerableUntil,slowUntil:p.slowUntil,magnetUntil:p.magnetUntil,body:bodyPoints(p)})),loose:room.loose,powerups:room.powerups,callouts:room.callouts};}
function broadcastRoom(room,msg){const s=JSON.stringify(msg);for(const ws of room.clients.values())ws.send(s);}

function onMessage(ws,msg){let m;try{m=JSON.parse(msg);}catch{return;}
  if(m.type==='create'||m.type==='practice'){
    const id=clean(m.deviceId,48),room=makeRoom(id,m.type==='practice'),p=makePlayer(id,m.name,m.emoji,false,m.outfit);p.color=COLORS[0];room.players.set(id,p);room.clients.set(id,ws);Object.assign(ws,{roomCode:room.code,playerId:id});if(m.type==='practice'){addBots(room,4);startRound(room);}ws.send(JSON.stringify({type:'joined',playerId:id,roomCode:room.code,hostId:room.hostId}));return;
  }
  if(m.type==='join'){
    const room=rooms.get(String(m.code||'').toUpperCase());if(!room)return ws.send(JSON.stringify({type:'error',message:'Room not found.'}));
    const id=clean(m.deviceId,48);let p=room.players.get(id);if(!p){if(room.players.size>=12)return ws.send(JSON.stringify({type:'error',message:'That room is full.'}));p=makePlayer(id,m.name,m.emoji,false,m.outfit);p.color=COLORS[room.players.size%COLORS.length];p.waiting=room.phase==='playing'||room.phase==='countdown';room.players.set(id,p);}else{p.connected=true;p.name=clean(m.name);p.emoji=String(m.emoji||p.emoji).slice(0,4);p.outfit=String(m.outfit||p.outfit).slice(0,12);}
    room.clients.set(id,ws);Object.assign(ws,{roomCode:room.code,playerId:id});ws.send(JSON.stringify({type:'joined',playerId:id,roomCode:room.code,hostId:room.hostId,waiting:room.phase==='playing'||room.phase==='countdown'}));return;
  }
  const room=rooms.get(ws.roomCode),p=room?.players.get(ws.playerId);if(!room||!p)return;
  if(m.type==='input'&&p.alive){p.inputX=Number(m.x)||0;p.inputY=Number(m.y)||0;p.boost=!!m.boost;}
  if(m.type==='start'&&room.hostId===p.id&&(room.phase==='lobby'||room.phase==='results'))startRound(room);
}

class WS {
  constructor(socket){this.socket=socket;this.buffer=Buffer.alloc(0);this.alive=true;socket.on('data',d=>this.read(d));socket.on('close',()=>this.close());socket.on('error',()=>this.close());}
  send(text){if(!this.alive)return;const payload=Buffer.from(text),head=payload.length<126?Buffer.from([0x81,payload.length]):Buffer.from([0x81,126,payload.length>>8,payload.length&255]);this.socket.write(Buffer.concat([head,payload]));}
  read(d){this.buffer=Buffer.concat([this.buffer,d]);while(this.buffer.length>=2){const b=this.buffer,len7=b[1]&127,masked=!!(b[1]&128);let off=2,len=len7;if(len7===126){if(b.length<4)return;len=b.readUInt16BE(2);off=4;}else if(len7===127){if(b.length<10)return;len=Number(b.readBigUInt64BE(2));off=10;}const need=off+(masked?4:0)+len;if(b.length<need)return;const opcode=b[0]&15;if(opcode===8){this.socket.end();return;}let payload=b.subarray(off+(masked?4:0),need);if(masked){const key=b.subarray(off,off+4);payload=Buffer.from(payload);for(let i=0;i<payload.length;i++)payload[i]^=key[i%4];}this.buffer=b.subarray(need);if(opcode===1)onMessage(this,payload.toString());}}
  close(){if(!this.alive)return;this.alive=false;sockets.delete(this);const room=rooms.get(this.roomCode),p=room?.players.get(this.playerId);if(room&&p){room.clients.delete(p.id);p.connected=false;p.disconnectedAt=Date.now();if(room.hostId===p.id){const next=[...room.players.values()].find(x=>!x.bot&&x.connected);if(next)room.hostId=next.id;}}}
}

const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://local');
  if(url.pathname==='/api/rooms'){const open=[...rooms.values()].filter(r=>r.phase==='lobby'&&!r.practice).map(r=>({code:r.code,players:[...r.players.values()].filter(p=>!p.bot).length,host:r.players.get(r.hostId)?.name||'Host'}));return json(res,{rooms:open});}
  if(url.pathname==='/api/stats')return json(res,globalStats);
  if(url.pathname==='/health')return json(res,{ok:true,rooms:rooms.size});
  let file=path.join(PUBLIC,url.pathname==='/'?'index.html':url.pathname);if(!file.startsWith(PUBLIC))return end(res,403,'Nope');
  fs.readFile(file,(e,data)=>{if(e)return end(res,404,'Not found');res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-cache'});res.end(data);});
});
function json(res,obj){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(obj));}function end(res,n,t){res.writeHead(n);res.end(t);}
server.on('upgrade',(req,socket)=>{if(req.url!=='/ws')return socket.destroy();const key=req.headers['sec-websocket-key'];socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');const ws=new WS(socket);sockets.add(ws);});
setInterval(()=>{const now=Date.now();for(const room of rooms.values())tick(room,1/30,now);},1000/30);
setInterval(()=>{for(const room of rooms.values())if(room.clients.size)broadcastRoom(room,state(room));},1000/15);
setInterval(()=>{const now=Date.now();for(const [c,r] of rooms){for(const [id,p] of r.players)if(!p.bot&&!p.connected&&now-p.disconnectedAt>30000){r.players.delete(id);if(r.phase==='playing'&&[...r.players.values()].filter(x=>!x.bot&&x.connected).length<=1)endRound(r);}if(!r.clients.size&&now-r.createdAt>15*60_000)rooms.delete(c);}},5000);
setInterval(saveStats,10000);
server.listen(PORT,()=>console.log(`Conga Clash running on http://localhost:${PORT}`));

module.exports={server,rooms,makePlayer,makeRoom};
