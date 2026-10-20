'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
require('../packages/core/index.js');
const {RegionClicks}=require('../packages/ui/region-clicks.js');

test('all passive observers run, but only the explicitly selected editor runs',()=>{
  const clicks=new RegionClicks(), calls=[];
  clicks.subscribe(e=>calls.push('inspect:'+e.id));
  clicks.subscribe(e=>calls.push('resources:'+e.id));
  const paint=clicks.subscribe(e=>calls.push('paint:'+e.id),{id:'paint',mode:'active',label:'Paint'});
  const set=clicks.subscribe(e=>calls.push('set:'+e.id),{id:'set',mode:'active'});
  clicks.dispatch({id:1}); assert.equal(clicks.activeId,null);
  paint.activate(); assert.equal(paint.selected,true); clicks.dispatch({id:2});
  set.activate(); assert.equal(paint.selected,false); assert.equal(set.selected,true); clicks.dispatch({id:3});
  clicks.clearActive(); clicks.dispatch({id:4});
  assert.deepEqual(calls,['inspect:1','resources:1','inspect:2','resources:2','paint:2','inspect:3','resources:3','set:3','inspect:4','resources:4']);
});
test('closing an owner removes its observers and editor without reviving a previous editor',()=>{
  const clicks=new RegionClicks(), nation=new AbortController(), stats=new AbortController();let painted=0,collected=0,observed=0;
  const paint=clicks.subscribe(()=>painted++,{id:'paint',mode:'active',signal:nation.signal});
  clicks.subscribe(()=>observed++,{signal:stats.signal});
  const set=clicks.subscribe(()=>collected++,{id:'set',mode:'active',signal:stats.signal});
  paint.activate();set.activate();nation.abort();assert.equal(clicks.activeId,'set');
  clicks.dispatch({id:1});stats.abort();clicks.dispatch({id:2});
  assert.equal(painted,0);assert.equal(collected,1);assert.equal(observed,1);assert.equal(clicks.activeId,null);assert.equal(clicks.list.length,0);
  assert.throws(()=>set.activate());
  const expired=clicks.subscribe(()=>assert.fail('expired'),{mode:'active',signal:stats.signal});assert.throws(()=>expired.activate());assert.equal(clicks.list.length,0);
});
test('an observer cannot activate a new editor for the click currently being dispatched',()=>{
  const clicks=new RegionClicks(), calls=[];
  const first=clicks.subscribe(()=>calls.push('first'),{id:'first',mode:'active'}),second=clicks.subscribe(()=>calls.push('second'),{id:'second',mode:'active'});
  let switchOnce=true;clicks.subscribe(()=>{if(switchOnce){switchOnce=false;second.activate();}});
  first.activate();clicks.dispatch({id:1});assert.deepEqual(calls,[]);clicks.dispatch({id:2});assert.deepEqual(calls,['second']);
  const observer=clicks.subscribe(()=>second.dispose());clicks.dispatch({id:3});assert.deepEqual(calls,['second']);assert.equal(clicks.activeId,null);observer.dispose();
});
test('empty selection only notifies observers; unavailable editors deactivate safely',()=>{
  const clicks=new RegionClicks(), observed=[];let enabled=true,calls=0;
  clicks.subscribe(e=>observed.push(e.id));
  const editor=clicks.subscribe(()=>calls++,{id:'edit',mode:'active',enabled:()=>enabled});
  editor.activate();clicks.dispatch({id:null});assert.equal(calls,0);assert.equal(editor.selected,true);
  enabled=false;clicks.dispatch({id:1});assert.equal(clicks.activeId,null);assert.throws(()=>editor.activate());assert.deepEqual(observed,[null,1]);
});
test('failed observers do not block other observers or the editor, including rejected promises',async()=>{
  const errors=[],calls=[],clicks=new RegionClicks({onError:e=>errors.push(e.message)});
  clicks.subscribe(()=>{throw Error('observer');});clicks.subscribe(async()=>{throw Error('async');});clicks.subscribe(()=>calls.push('passive'));
  clicks.subscribe(()=>{throw Error('enabled');},{enabled:()=>{throw Error('predicate');}});
  const editor=clicks.subscribe(()=>calls.push('edit'),{mode:'active'});editor.activate();clicks.dispatch({id:1});await Promise.resolve();
  assert.deepEqual(calls,['passive','edit']);assert.deepEqual(errors,['observer','predicate','async']);
  assert.throws(()=>clicks.subscribe(()=>{},{id:editor.id}));assert.throws(()=>clicks.subscribe(()=>{},{mode:'other'}));
  const passive=clicks.subscribe(()=>{});assert.throws(()=>passive.activate());
});
