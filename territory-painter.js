/* Optional extension. Remove its construction and the core + viewport still work.
 * Owns the coloring canvas, brush behavior and PNG composition. */
(function(root){
  'use strict';
  class TerritoryPainter {
    constructor(index,viewer){
      this.index=index;this.viewer=viewer;this.mode='paint';this.activeNationId=null;
      this.canvas=document.createElement('canvas');this.canvas.id='territory-canvas';this.canvas.className='province-overlay';this.canvas.style.left='0';this.canvas.style.top='0';
      viewer.canvas.after(this.canvas);this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
      this.off=[index.on('map:loaded',()=>this.reset()),index.on('change',e=>this.update(e)),index.on('province:click',e=>{
        if(!e.id)return;if(this.mode==='paint'&&this.index.nations.has(this.activeNationId))this.paintProvince(e.id,this.activeNationId);
        if(this.mode==='erase')this.paintProvince(e.id,null);
      })];
    }
    reset(){this.canvas.width=this.index.width;this.canvas.height=this.index.height;this.activeNationId=this.index.nations.keys().next().value||null;this.renderAll();}
    setActiveNation(id){if(!this.index.nations.has(id))return;this.activeNationId=id;this.index.emit('painter:active',{nationId:id});}
    paintProvince(id,nationId=this.activeNationId){this.index.setProvince(id,{nationId});}
    paintRegion(regionId,nationId=this.activeNationId){
      if(!this.index.regions.has(regionId))throw new Error('Регион не найден.');
      if(nationId!==null&&!this.index.nations.has(nationId))throw new Error('Сначала выберите нацию.');
      this.index.transaction('Назначение региона',()=>{for(const p of this.index.getRegionProvinces(regionId))this.index.setProvince(p.id,{nationId});});
    }
    rgb(color){return [parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16)];}
    renderAll(){
      const image=this.ctx.createImageData(this.index.width,this.index.height),data=image.data,colors=new Map();
      for(const p of this.index.provinces.values()){const nation=this.index.nations.get(p.nationId);if(nation)colors.set(p.id,this.rgb(nation.color));}
      if(colors.size){for(let i=0;i<this.index.labels.length;i++){const rgb=colors.get(this.index.labels[i]);if(!rgb)continue;const j=i*4;data[j]=rgb[0];data[j+1]=rgb[1];data[j+2]=rgb[2];data[j+3]=255;}}
      this.ctx.putImageData(image,0,0);
    }
    update({before,after}){
      if(!this.index.nations.has(this.activeNationId))this.activeNationId=this.index.nations.keys().next().value||null;
      const previousColors=new Map(before.nations.map(n=>[n.id,n.color]));
      const affected=[];
      for(const p of this.index.provinces.values())if((before.owners[p.id]||null)!==p.nationId||previousColors.get(p.nationId)!==this.index.nations.get(p.nationId)?.color)affected.push(p);
      if(affected.length>60){this.renderAll();return;}for(const p of affected)this.drawProvince(p);
    }
    drawProvince(p){
      const [x,y,w,h]=p.bbox,image=this.ctx.getImageData(x,y,w,h),data=image.data,nation=this.index.nations.get(p.nationId),rgb=nation?this.rgb(nation.color):null;
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){if(this.index.labels[(y+yy)*this.index.width+x+xx]!==p.id)continue;const i=(yy*w+xx)*4;if(rgb){data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];data[i+3]=255;}else data[i+3]=0;}
      this.ctx.putImageData(image,x,y);
    }
    exportCanvas(withIds=false){
      const out=document.createElement('canvas');out.width=this.index.width;out.height=this.index.height;const ctx=out.getContext('2d');ctx.drawImage(this.viewer.canvas,0,0);ctx.drawImage(this.canvas,0,0);
      if(withIds){ctx.font='14px ui-monospace,monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=3;ctx.strokeStyle='#f7f3e9';ctx.fillStyle='#34494e';for(const p of this.index.provinces.values()){if(p.area<750||p.bbox[2]<24||p.bbox[3]<14)continue;ctx.strokeText(String(p.id),...p.anchor);ctx.fillText(String(p.id),...p.anchor);}}
      return out;
    }
    destroy(){for(const off of this.off)off();this.canvas.remove();}
  }
  root.AtlasPlugins={TerritoryPainter};
})(globalThis);
