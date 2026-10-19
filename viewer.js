/* Map viewport. It only draws the base map, navigates, hit-tests and emits events.
 * Nation ownership and its visualization are independent add-ons. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  class MapViewer {
    constructor(index) {
      this.index = index; this.viewport = $('viewport'); this.stage = $('map-stage'); this.canvas = $('map-canvas');
      this.ctx = this.canvas.getContext('2d'); this.scale = 1; this.tx = 0; this.ty = 0; this.selectedId = null; this.hoverId = null;
      this.pointers = new Map(); this.panMode = false; this.showNumbers = false; this.ready = false;
      this.viewport.addEventListener('wheel', e => { if(!this.ready) return; e.preventDefault(); const p=this.local(e); this.zoom(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.004),p.x,p.y); },{passive:false});
      this.viewport.addEventListener('pointerdown', e => this.down(e));
      this.viewport.addEventListener('pointermove', e => this.move(e));
      this.viewport.addEventListener('pointerup', e => this.up(e));
      this.viewport.addEventListener('pointercancel', e => this.cancel(e));
      this.viewport.addEventListener('lostpointercapture', e => { if(this.pointers.has(e.pointerId)) this.cancel(e); });
      this.viewport.addEventListener('pointerleave', () => { if(!this.pointers.size) this.setHover(null); });
      this.viewport.addEventListener('contextmenu', e => e.preventDefault());
      new ResizeObserver(() => { if (this.ready) { this.constrain(); this.transform(); } }).observe(this.viewport);
      index.on('change',()=>{this.highlight('selection-canvas',this.selectedId,true);this.highlight('hover-canvas',this.hoverId,false);this.drawNumbers();});
    }
    local(e) { const r=this.viewport.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; }
    world(p) { return { x:(p.x-this.tx)/this.scale, y:(p.y-this.ty)/this.scale }; }
    load(image) {
      this.image = image; this.canvas.width=image.width; this.canvas.height=image.height;
      this.stage.style.width=image.width+'px'; this.stage.style.height=image.height+'px';
      this.ctx.drawImage(image,0,0); this.selectedId=null; this.hoverId=null; this.pointers.clear();
      $('selection-canvas').width=1; $('hover-canvas').width=1;
      this.ready=true; this.fit();
    }
    fitScale() { return Math.min((this.viewport.clientWidth-36)/this.canvas.width,(this.viewport.clientHeight-120)/this.canvas.height); }
    fit() {
      this.scale=Math.max(.015,this.fitScale());
      this.tx=(this.viewport.clientWidth-this.canvas.width*this.scale)/2;
      this.ty=(this.viewport.clientHeight-this.canvas.height*this.scale)/2;
      this.transform();
    }
    zoom(factor,x=this.viewport.clientWidth/2,y=this.viewport.clientHeight/2) {
      const before=this.scale; this.scale=Math.min(12,Math.max(this.fitScale()*.55,this.scale*factor));
      this.tx=x-(x-this.tx)*this.scale/before; this.ty=y-(y-this.ty)*this.scale/before;
      this.constrain(); this.transform(); this.setHover(null);
    }
    constrain() {
      const w=this.viewport.clientWidth,h=this.viewport.clientHeight,sw=this.canvas.width*this.scale,sh=this.canvas.height*this.scale;
      this.tx=sw<w?(w-sw)/2:Math.min(w*.6,Math.max(w*.4-sw,this.tx));
      this.ty=sh<h?(h-sh)/2:Math.min(h*.6,Math.max(h*.4-sh,this.ty));
    }
    transform() {
      this.stage.style.transform=`translate(${this.tx}px,${this.ty}px) scale(${this.scale})`;
      $('zoom-level').textContent=Math.round(this.scale*100)+'%'; this.drawNumbers();
    }
    down(e) {
      if (!this.ready || e.target.closest('button,.zoom-controls') || (e.button!==0 && e.button!==1)) return;
      const p=this.local(e); this.pointers.set(e.pointerId,p); this.viewport.setPointerCapture(e.pointerId);
      if(this.pointers.size===1) this.gesture={start:p,last:p,moved:false,multi:false};
      if(this.pointers.size===2) {
        this.gesture.multi=true; const [a,b]=[...this.pointers.values()];
        this.pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),scale:this.scale,world:this.world({x:(a.x+b.x)/2,y:(a.y+b.y)/2})};
      }
      this.setHover(null);
    }
    move(e) {
      if(!this.ready) return; const p=this.local(e), world=this.world(p);
      $('coords').textContent=`X ${Math.floor(world.x)}  Y ${Math.floor(world.y)}`;
      if(this.pointers.has(e.pointerId)) {
        this.pointers.set(e.pointerId,p);
        if(this.pointers.size===2 && this.pinch) {
          const [a,b]=[...this.pointers.values()], center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
          this.scale=Math.max(this.fitScale()*.55,Math.min(12,this.pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,this.pinch.distance)));
          this.tx=center.x-this.pinch.world.x*this.scale;this.ty=center.y-this.pinch.world.y*this.scale;
        } else if(this.pointers.size===1 && !this.gesture.multi) {
          if(Math.hypot(p.x-this.gesture.start.x,p.y-this.gesture.start.y)>4) this.gesture.moved=true;
          if(this.gesture.moved){this.tx+=p.x-this.gesture.last.x;this.ty+=p.y-this.gesture.last.y;this.viewport.classList.add('dragging');}
          this.gesture.last=p;
        }
        this.constrain();this.transform();return;
      }
      const province=this.index.at(world.x,world.y); this.setHover(province?.id || null,world);
      this.positionTooltip(p);
    }
    up(e) {
      if(!this.pointers.has(e.pointerId)) return;
      const g=this.gesture; this.pointers.delete(e.pointerId); if(this.viewport.hasPointerCapture(e.pointerId))this.viewport.releasePointerCapture(e.pointerId);
      if(!this.pointers.size) {this.viewport.classList.remove('dragging');this.pinch=null;}
      if(g && !g.moved && !g.multi && !this.panMode && e.button===0) {
        const world=this.world(this.local(e)),province=this.index.at(world.x,world.y);
        if(province) this.select(province.id);
        this.emit('province:click',{id:province?.id||null,province,x:world.x,y:world.y,originalEvent:e});
      }
    }
    cancel(e) {this.pointers.clear();this.pinch=null;this.gesture=null;this.viewport.classList.remove('dragging');this.setHover(null);}
    emit(name,detail) {this.index.emit(name,detail);window.dispatchEvent(new CustomEvent(name,{detail}));}
    setHover(id,world={x:null,y:null}) {
      if(this.hoverId===id)return; this.hoverId=id;this.highlight('hover-canvas',id,false);
      this.emit('province:hover',{id,province:this.index.getProvince(id),x:world.x,y:world.y});
    }
    select(id) {this.selectedId=id;this.highlight('selection-canvas',id,true);this.index.emit('selection:change',{id,province:this.index.getProvince(id)});}
    focusProvince(id) {
      const p=this.index.getProvince(id);if(!p)return;
      this.scale=Math.min(5,Math.max(this.scale,Math.min(this.viewport.clientWidth/(p.bbox[2]*2.8),this.viewport.clientHeight/(p.bbox[3]*2.8))));
      this.tx=this.viewport.clientWidth/2-p.anchor[0]*this.scale;this.ty=this.viewport.clientHeight/2-p.anchor[1]*this.scale;
      this.constrain();this.transform();this.select(id);
    }
    positionTooltip(p) {
      const tip=$('map-tooltip');tip.style.left=Math.max(6,Math.min(p.x+17,this.viewport.clientWidth-tip.offsetWidth-8))+'px';tip.style.top=Math.max(6,Math.min(p.y+17,this.viewport.clientHeight-tip.offsetHeight-8))+'px';
    }
    highlight(canvasId,id,selected) {
      const canvas=$(canvasId),p=this.index.getProvince(id);
      if(!p || !this.index.labels){canvas.width=1;canvas.height=1;return;}
      const [x,y,w,h]=p.bbox;canvas.width=w;canvas.height=h;canvas.style.left=x+'px';canvas.style.top=y+'px';
      const ctx=canvas.getContext('2d'), image=ctx.createImageData(w,h),data=image.data,labels=this.index.labels,mw=this.index.width;
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        const source=(y+yy)*mw+x+xx;if(labels[source]!==id)continue;
        const boundary=xx===0||yy===0||xx===w-1||yy===h-1||labels[source-1]!==id||labels[source+1]!==id||labels[source-mw]!==id||labels[source+mw]!==id;
        const offset=(yy*w+xx)*4;data[offset]=selected?187:255;data[offset+1]=selected?111:255;data[offset+2]=selected?46:255;data[offset+3]=boundary?255:(selected?15:65);
      }
      ctx.putImageData(image,0,0);
    }
    drawNumbers() {
      if(!this.ready)return; const c=$('numbers-canvas'),dpr=Math.min(2,window.devicePixelRatio||1),w=this.viewport.clientWidth,h=this.viewport.clientHeight;
      if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);c.style.width=w+'px';c.style.height=h+'px';}
      const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
      if(!this.showNumbers)return;ctx.font='10px ui-monospace,monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=3;ctx.strokeStyle='#f7f3e9';ctx.fillStyle='#34494e';
      for(const p of this.index.provinces.values()) {
        if(p.area*this.scale*this.scale<750||p.bbox[2]*this.scale<24||p.bbox[3]*this.scale<12)continue;
        const x=p.anchor[0]*this.scale+this.tx,y=p.anchor[1]*this.scale+this.ty;if(x<0||y<0||x>w||y>h)continue;
        ctx.strokeText(String(p.id),x,y);ctx.fillText(String(p.id),x,y);
      }
    }
  }
  root.AtlasView={MapViewer};
})(globalThis);
