const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const PORT=3199;let child;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function client(){const ws=new WebSocket(`ws://127.0.0.1:${PORT}/ws`),messages=[];ws.addEventListener('message',e=>messages.push(JSON.parse(e.data)));return{ws,messages,open:new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true})}),wait(fn,timeout=8000){return new Promise((ok,no)=>{const at=Date.now(),t=setInterval(()=>{const m=messages.find(fn);if(m){clearInterval(t);ok(m)}else if(Date.now()-at>timeout){clearInterval(t);no(new Error(`Timeout: ${JSON.stringify(messages.slice(-4))}`))}},20)})}}}
test.before(async()=>{child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(PORT)},stdio:'ignore'});for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${PORT}/health`)).ok)return}catch{}await delay(50)}throw Error('Server did not start')});
test.after(()=>child?.kill());
test('room, lobby, bot fill, synced seeded round, and authoritative tap',async()=>{
  const a=client();await a.open;a.ws.send(JSON.stringify({type:'create',name:'Alpha',emoji:'😎',deviceId:'alpha'}));const joined=await a.wait(m=>m.type==='joined');assert.match(joined.roomCode,/^[A-Z]{4}$/);
  const b=client();await b.open;b.ws.send(JSON.stringify({type:'join',name:'Beta',emoji:'🦊',deviceId:'beta',code:joined.roomCode}));await b.wait(m=>m.type==='joined');const lobby=await a.wait(m=>m.type==='lobby'&&m.players.length===2);assert.equal(lobby.hostId,'alpha');
  a.ws.send(JSON.stringify({type:'start'}));await a.wait(m=>m.type==='gameStarted');const roundA=await a.wait(m=>m.type==='roundIntro');const roundB=await b.wait(m=>m.type==='roundIntro');assert.equal(roundA.round.seed,roundB.round.seed);assert.equal(roundA.round.count,roundB.round.count);
  const live=await a.wait(m=>m.type==='roundLive');assert.equal(live.roundIndex,0);await delay(20);
  function target(seed,count){let s=seed>>>0;s=Math.imul(1664525,s)+1013904223>>>0;return Math.floor(s/4294967296*count)}
  a.ws.send(JSON.stringify({type:'tap',index:target(roundA.round.seed,roundA.round.count),actionId:'tap-1'}));const found=await a.wait(m=>m.type==='playerFound'&&m.playerId==='alpha');assert.ok(found.place>=1&&found.place<=4);assert.ok(found.totalScore>=40);
  const state=await a.wait(m=>m.type==='lobby'&&m.players.length===4);assert.equal(state.players.filter(p=>p.bot).length,2);a.ws.close();b.ws.close();
});
test('health and readiness endpoints identify Morale Arcade',async()=>{const h=await fetch(`http://127.0.0.1:${PORT}/health`).then(r=>r.json());assert.equal(h.name,'morale-arcade');assert.equal(h.ok,true);const ready=await fetch(`http://127.0.0.1:${PORT}/ready`).then(r=>r.json());assert.equal(ready.ready,true)});
