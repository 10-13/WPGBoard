'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../packages/core/index.js');
const {RegionClicks}=require('../packages/ui/region-clicks.js'),{WindowManager}=require('../packages/ui/windows.js');
// Minimal DOM for lifecycle tests; rendering and native input are checked in the browser.
class Node extends EventTarget {
  children=[];style={};dataset={};clientWidth=1000;clientHeight=700;
  classList={toggle(){},add(){},remove(){}};
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}}
  setAttribute(){}
}
function fixture(run){
  const previous={window:global.window,document:global.document};global.window=new EventTarget();global.document={createElement:()=>new Node()};
  const clicks=new RegionClicks(),windows=new WindowManager(new Node(),{regionClicks:clicks});
  try{run(windows,clicks);}finally{windows.dispose();global.window=previous.window;global.document=previous.document;}
}
test('tab-owned click listeners survive merges and stop on tab/window closure',()=>fixture((windows,clicks)=>{
  let paint,set,seen=0,painted=0,collected=0;
  windows.open({id:'nations',render(p,s,t){paint=t.onRegionClick(()=>painted++,{id:'paint',mode:'active'});}});
  windows.open({id:'stats',render(p,s,t){set=t.onRegionClick(()=>collected++,{id:'set',mode:'active'});}});
  windows.open({id:'inspector',render(p,s,t){t.onRegionClick(()=>seen++);}});
  paint.activate();clicks.dispatch({id:1});assert.equal(seen,1);assert.equal(painted,1);
  windows.moveTab('nations','stats');assert.equal(paint.selected,true);assert.equal(windows.windows.length,2);
  windows.closeTab('stats');assert.equal(paint.selected,true);assert.throws(()=>set.activate());
  windows.closeWindow('inspector');clicks.dispatch({id:2});assert.equal(seen,1);assert.equal(painted,2);
  windows.closeWindow('stats');clicks.dispatch({id:3});assert.equal(painted,2);assert.equal(clicks.activeId,null);assert.equal(clicks.list.length,0);
  windows.open({id:'nations',render(p,s,t){paint=t.onRegionClick(()=>painted++,{id:'paint',mode:'active'});}});assert.equal(paint.selected,false);clicks.dispatch({id:4});assert.equal(painted,2);
}));
test('unloading an extension closes its tabs and releases their editing and passive listeners',()=>fixture((windows,clicks)=>{
  const lifetime=new AbortController();let editor;
  windows.open({id:'owned',signal:lifetime.signal,render(p,s,t){editor=t.onRegionClick(()=>assert.fail('closed'),{mode:'active'});t.onRegionClick(()=>assert.fail('closed'));}});
  editor.activate();lifetime.abort();assert.equal(windows.tabCount,0);assert.equal(clicks.activeId,null);assert.equal(clicks.list.length,0);clicks.dispatch({id:1});
}));
test('a temporarily hidden workspace does not destroy saved window geometry',()=>fixture((windows)=>{
  const tab=windows.open({id:'stable',x:40,y:50,width:350,height:320}),panel=tab.element.parent.parent;
  windows.host.clientWidth=16;windows.host.clientHeight=16;global.window.dispatchEvent(new Event('resize'));
  assert.equal(panel.style.width,'350px');assert.equal(panel.style.height,'320px');assert.equal(panel.style.left,'40px');
  windows.host.clientWidth=1000;windows.host.clientHeight=700;global.window.dispatchEvent(new Event('resize'));
  assert.equal(panel.style.width,'350px');assert.equal(panel.style.height,'320px');assert.equal(panel.style.top,'50px');
}));
