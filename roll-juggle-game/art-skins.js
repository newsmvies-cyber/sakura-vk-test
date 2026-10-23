(function(root){
  'use strict';
  const names=['Нефритовый дракон','Сакура в цвету','Огненный феникс','Волна кои','Ледяные крылья','Императорская корона','Нефритовый бамбук','Звёздная орбита','Коралловая жемчужина','Девятихвостая лиса'];
  const bases=['#236051','#d787a3','#b93628','#267ca8','#8abde1','#712448','#527f3d','#4d398b','#4caaba','#af352b'];
  root.ART_STICK_SKINS=names.map((name,i)=>({id:'art-'+(i+1),name,at:i<5?80:90,artId:i,size:1,base:bases[i],edge:'#71492c',light:'#f5d992',cap:bases[i]}));
  root.ART_STICK_IMAGES=[];
  const image=new Image();
  image.onload=()=>{
    // Slice the supplied sheet once; keep the original illustrated surfaces.
    for(let i=0;i<10;i++){
      const row=Math.floor(i/2),col=i%2,w=720,h=104;
      const sprite=document.createElement('canvas');sprite.width=w;sprite.height=h;
      const c=sprite.getContext('2d',{willReadFrequently:true});
      c.drawImage(image,24+768*col,[2,207,412,620,825][row],w,h,0,0,w,h);
      const pixels=c.getImageData(0,0,w,h),d=pixels.data,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let end=0;
      function add(p){if(p<0||p>=seen.length||seen[p])return;const k=p*4,r=d[k],g=d[k+1],b=d[k+2];if(r>205&&g>180&&b>140&&r>=g&&g>=b){seen[p]=1;queue[end++]=p;}}
      for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
      for(let n=0;n<end;n++){const p=queue[n],x=p%w;d[p*4+3]=0;if(x)add(p-1);if(x<w-1)add(p+1);add(p-w);add(p+w);}
      // Keep the largest connected illustration, excluding panel numbers/borders.
      seen.fill(0);let largest=[];
      for(let p=0;p<w*h;p++)if(!seen[p]&&d[p*4+3]){
        let a=0,b=1;queue[0]=p;seen[p]=1;
        while(a<b){const q=queue[a++],x=q%w;for(const t of [x?q-1:-1,x<w-1?q+1:-1,q-w,q+w])if(t>=0&&t<w*h&&!seen[t]&&d[t*4+3]){seen[t]=1;queue[b++]=t;}}
        if(b>largest.length)largest=Array.from(queue.subarray(0,b));
      }
      const keep=new Uint8Array(w*h);for(const p of largest)keep[p]=1;
      for(let p=0;p<w*h;p++)if(!keep[p])d[p*4+3]=0;
      c.putImageData(pixels,0,0);
      root.ART_STICK_IMAGES[i]={image:sprite,tip:[89,88,86,89,82][row],rise:[24,27,27,28,22][row]};
    }
    root.dispatchEvent(new Event('sakura-stick-art-ready'));
  };
  image.src=new URL('assets/chopsticks-sheet.png',document.currentScript.src).href;
})(globalThis);
