const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');

const PORT=3199;
let child;
function delay(ms){return new Promise(r=>setTimeout(r,ms))}
function connect(){
  const ws=new WebSocket(`ws://127.0.0.1:${PORT}/ws`),messages=[];
  ws.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
  return {ws,messages,open:new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true})}),wait(predicate,timeout=6000){return new Promise((ok,no)=>{const started=Date.now();const timer=setInterval(()=>{const found=messages.find(predicate);if(found){clearInterval(timer);ok(found)}else if(Date.now()-started>timeout){clearInterval(timer);no(new Error(`Timed out. Recent messages: ${JSON.stringify(messages.slice(-2))}`))}},20)})}};
}

test.before(async()=>{
  child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(PORT),DATA_FILE:'/tmp/conga-clash-test-stats.json'},stdio:'ignore'});
  for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/health`);if(r.ok)return}catch{}await delay(50)}
  throw new Error('Test server did not start');
});
test.after(()=>child?.kill());

test('creates, joins, starts, fills with bots, and marks a late joiner waiting',async()=>{
  const host=connect();await host.open;host.ws.send(JSON.stringify({type:'create',name:'Host',emoji:'😎',outfit:'crown',deviceId:'host-device'}));
  const joined=await host.wait(m=>m.type==='joined');assert.match(joined.roomCode,/^[A-Z]{4}$/);
  const guest=connect();await guest.open;guest.ws.send(JSON.stringify({type:'join',name:'Guest',emoji:'🦊',deviceId:'guest-device',code:joined.roomCode}));await guest.wait(m=>m.type==='joined');
  const lobby=await host.wait(m=>m.type==='state'&&m.players.length===2);assert.equal(lobby.players.find(p=>p.id==='host-device').outfit,'crown');
  host.ws.send(JSON.stringify({type:'start'}));await host.wait(m=>m.type==='roundStarting');
  const playing=await host.wait(m=>m.type==='state'&&m.room.phase==='playing');assert.equal(playing.players.length,4);assert.equal(playing.players.filter(p=>p.bot).length,2);
  const late=connect();await late.open;late.ws.send(JSON.stringify({type:'join',name:'Late',emoji:'🐸',deviceId:'late-device',code:joined.roomCode}));const lateJoin=await late.wait(m=>m.type==='joined');assert.equal(lateJoin.waiting,true);
  const lateState=await late.wait(m=>m.type==='state'&&m.players.some(p=>p.id==='late-device'));assert.equal(lateState.players.find(p=>p.id==='late-device').waiting,true);
  host.ws.close();guest.ws.close();late.ws.close();
});

test('serves room discovery and persistent-stat APIs',async()=>{
  const health=await fetch(`http://127.0.0.1:${PORT}/health`).then(r=>r.json());assert.equal(health.ok,true);
  const stats=await fetch(`http://127.0.0.1:${PORT}/api/stats`).then(r=>r.json());assert.equal(typeof stats.dancers,'number');assert.ok(Array.isArray(stats.leaderboard));
});
