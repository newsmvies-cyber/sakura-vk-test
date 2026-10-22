(function(root){
  'use strict';
  const C=root.ROLL_GAME_CONFIG||(typeof require==='function'?require('./config.js'):null);
  const SPECIAL_SKINS=[
    {id:'dragon',name:'Дракон',pattern:'dragon',base:'#37675b',edge:'#173d37',light:'#f6d899',cap:'#1f5147'},
    {id:'wave',name:'Большая волна',pattern:'wave',base:'#4485ac',edge:'#1d425f',light:'#d8f5ff',cap:'#173b61'},
    {id:'blossom',name:'Цветущая сакура',pattern:'blossom',base:'#ab5b79',edge:'#652f51',light:'#ffe3e9',cap:'#783456'},
    {id:'bamboo',name:'Бамбуковый лес',pattern:'bamboo',base:'#83a66c',edge:'#35523c',light:'#e8edba',cap:'#3e6243'},
    {id:'thunder',name:'Молния',pattern:'thunder',base:'#494252',edge:'#221f30',light:'#ffdd78',cap:'#2d293a'},
    {id:'galaxy',name:'Созвездие',pattern:'galaxy',base:'#695b9c',edge:'#302c57',light:'#e8ddff',cap:'#383265'},
    {id:'koi',name:'Карп кои',pattern:'koi',base:'#eea07d',edge:'#944b43',light:'#fff1d9',cap:'#b95849'},
    {id:'ice',name:'Ледяной кристалл',pattern:'ice',base:'#91cbd3',edge:'#477b93',light:'#f0ffff',cap:'#5799b4'},
    {id:'flame',name:'Пламя феникса',pattern:'flame',base:'#cd6b45',edge:'#742f3b',light:'#ffdf91',cap:'#973948'},
    {id:'royal',name:'Императорские',pattern:'royal',base:'#97824d',edge:'#4c4835',light:'#ffe8ad',cap:'#365f60'}
  ].map(s=>({...s,at:67,collectible:true}));
  const LEGENDARY_SKIN={id:'thorn-dragon',name:'Терновый дракон',at:100,legendary:true,size:1.15,pattern:'thorn',base:'#384c50',edge:'#182c30',light:'#fbe1a1',cap:'#315f60'};
  class RewardCollection{
    constructor(ids=[],save=()=>{}){const valid=new Set(SPECIAL_SKINS.map(s=>s.id));this.owned=new Set(Array.isArray(ids)?ids.filter(id=>valid.has(id)):[]);this.save=save;this.beginRound();}
    beginRound(){this.awarded=false;this.lastReward=null;}
    earn(score,random=Math.random){if(score<67||this.awarded)return null;this.awarded=true;const pool=SPECIAL_SKINS.filter(s=>!this.owned.has(s.id));if(!pool.length)return null;const skin=pool[Math.floor(random()*pool.length)];this.owned.add(skin.id);this.lastReward=skin;try{this.save([...this.owned]);}catch{}return skin;}
  }
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const milestone=n=>C.stages.some(s=>s.from===n&&n>0)||(n>C.speedUpAfter&&n%C.rollEvery===0);
  class World{
    constructor(width,height,random=Math.random){this.random=random;this.width=width;this.height=height;this.reset();}
    reset(){this.colorOrder=[0,1,2,3,4];for(let i=4;i>0;i--){const j=Math.floor(this.random()*(i+1));[this.colorOrder[i],this.colorOrder[j]]=[this.colorOrder[j],this.colorOrder[i]];}this.score=0;this.stageScore=-1;this.time=0;this.over=false;this.rolls=[];this.effects=[];this.nextId=0;this.spawnWait=C.spawnDelay;this.x=this.target=this.prevX=this.width/2;this.hitFlash=0;this.spawn();}
    get stage(){if(this.stageScore!==this.score){let stage=C.stages[0];for(const s of C.stages)if(this.score>=s.from)stage=s;this.cachedStage={...stage,rolls:Math.min(C.maxRolls,stage.rolls)};this.stageScore=this.score;}return this.cachedStage;}
    get multiplier(){return 1+Math.floor(Math.max(0,this.score-C.speedUpAfter)/C.rollEvery)*C.speedStepGain;}
    get basePaddleWidth(){return Math.min(C.paddleWidth,this.width*.33);}
    get paddleWidth(){return this.basePaddleWidth*(this.paddleScale||1);}
    get recoil(){return this.hitFlash>0?Math.sin((1-this.hitFlash)*Math.PI)*C.paddleRecoil:0;}
    get paddleY(){return Math.max(76,this.height-Math.min(C.paddleBottom,this.height*.27));}
    get radius(){return Math.min(C.rollRadius,this.width*.08,this.height*.075);}
    get gravity(){const h=Math.max(40,(this.paddleY-this.radius*2)*C.bounceHeightRatio);return 8*h/(this.stage.flightSeconds**2)*C.gravityScale*this.multiplier**2;}
    get bounce(){const h=Math.max(40,(this.paddleY-this.radius*2)*C.bounceHeightRatio);return Math.sqrt(2*this.gravity*h);}
    move(x){const margin=Math.max(this.paddleWidth/2+5,39);this.target=clamp(x,margin,this.width-margin);}
    resize(width,height){const sx=width/this.width,sy=height/this.height,oldPaddle=this.paddleY,oldRadius=this.radius,oldX=this.x;this.width=width;this.height=height;this.x*=sx;this.target*=sx;for(const b of this.rolls){const above=b.y+oldRadius<=oldPaddle+C.paddleSlope*(b.x-oldX);b.x=clamp(b.x*sx,this.radius,width-this.radius);b.y*=sy;b.vx*=sx;b.vy*=sy;b.trail=[];if(above)b.y=Math.min(b.y,this.paddleY+C.paddleSlope*(b.x-this.x)-this.radius-1);b.prevX=b.x;b.prevY=b.y;b.prevAngle=b.angle;}this.move(this.target);this.x=clamp(this.x,this.paddleWidth/2+5,width-this.paddleWidth/2-5);this.prevX=this.x;}
    spawn(){const r=this.radius,id=this.nextId++,b={id,x:r+10+this.random()*(this.width-r*2-20),y:r+10,vx:(this.random()<.5?-1:1)*this.stage.horizontalSpeed,vy:12,angle:0,spin:(this.random()-.5)*1.4,type:this.colorOrder[id%5],speedFactor:0.98+this.random()*0.04,squash:0,trail:[],trailTimer:0};b.prevX=b.x;b.prevY=b.y;b.prevAngle=0;this.rolls.push(b);}
    canSpawn(){const g=this.gravity,r=this.radius,period=2*this.bounce/g,arrival=(-12+Math.sqrt(144+2*g*Math.max(0,this.paddleY-r*2-10)))/g,minGap=Math.min(C.minLandingGap,period/(this.stage.rolls+1)*.72);return this.rolls.every(b=>{const t=(-b.vy+Math.sqrt(b.vy*b.vy+2*g*Math.max(0,this.paddleY-r-b.y)))/g;const gap=((arrival-t)%period+period)%period;return Math.min(gap,period-gap)>=minGap;});}
    step(dt){
      if(this.over)return;
      this.time+=dt;const oldX=this.x;this.prevX=oldX;this.x+=(this.target-this.x)*(1-Math.exp(-C.followSpeed*dt));this.hitFlash=Math.max(0,this.hitFlash-dt*4);
      const r=this.radius,paddleY=this.paddleY,gravity=this.gravity,bounce=this.bounce;
      for(const b of this.rolls){
        const px=b.x,py=b.y;b.prevX=px;b.prevY=py;b.prevAngle=b.angle;b.vy+=gravity*b.speedFactor**2*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;b.angle+=b.spin*dt;b.squash=Math.max(0,b.squash-dt*2.5);
        b.trailTimer+=dt;if(b.trailTimer>=1/40){b.trailTimer=0;if(b.trail.length<C.trailPoints)b.trail.push({x:px,y:py});else{const point=b.trail.shift();point.x=px;point.y=py;b.trail.push(point);}}
        if(b.x<r){b.x=r;b.vx=Math.abs(b.vx);this.effects.push({kind:'wall',x:0,y:b.y,life:0,duration:.24});}else if(b.x>this.width-r){b.x=this.width-r;b.vx=-Math.abs(b.vx);this.effects.push({kind:'wall',x:this.width,y:b.y,life:0,duration:.24});}
        // Sweep against the visible sloping upper chopstick, including hand motion.
        const before=py+r-paddleY-C.paddleSlope*(px-oldX),after=b.y+r-paddleY-C.paddleSlope*(b.x-this.x);
        if(b.vy>0&&before<=0&&after>=0){
          const t=clamp(-before/(after-before||1),0,1),bx=px+(b.x-px)*t,paddleX=oldX+(this.x-oldX)*t;
          if(Math.abs(bx-paddleX)<=this.paddleWidth/2+r*.65){
            const offset=clamp((bx-paddleX)/(this.paddleWidth/2),-1,1);b.y=paddleY+C.paddleSlope*(b.x-this.x)-r;b.vy=-bounce*b.speedFactor;b.vx=clamp(b.vx*.65+offset*this.stage.horizontalSpeed*.7,-this.stage.horizontalSpeed,this.stage.horizontalSpeed);
            if(Math.abs(b.vx)<this.stage.horizontalSpeed*.35)b.vx=(b.vx<0?-1:1)*this.stage.horizontalSpeed*.35;
            b.squash=1;b.spin=offset*1.4;this.score++;this.hitFlash=1;this.effects.push({kind:'hit',x:bx,y:paddleY+C.paddleSlope*(bx-paddleX),life:0,duration:.7,seed:this.score});
            if(milestone(this.score))this.effects.push({kind:'level',x:this.width/2,y:this.height*.24,life:0,duration:1.05,label:this.score>C.speedUpAfter?'Быстрее!':'Ещё один ролл!'});
          }
        }
        if(b.y-r>this.height){this.over=true;return;}
      }
      if(this.rolls.length<this.stage.rolls){this.spawnWait-=dt;if(this.spawnWait<=0&&this.canSpawn()){this.spawn();this.spawnWait=C.spawnDelay;}}
      for(const e of this.effects)e.life+=dt;
      let kept=0;for(let i=Math.max(0,this.effects.length-C.maxEffects);i<this.effects.length;i++){const e=this.effects[i];if(e.life<e.duration)this.effects[kept++]=e;}this.effects.length=kept;
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={World,config:C,RewardCollection,SPECIAL_SKINS,LEGENDARY_SKIN};
  if(typeof document==='undefined')return;
  class AudioFX{
    constructor(){this.context=null;this.enabled=true;try{this.enabled=localStorage.getItem(C.storageKey+'-sound')!=='off';}catch{}}
    async unlock(){if(!this.enabled)return;try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;if(!this.context)this.context=new AC();if(this.context.state==='suspended')await this.context.resume();}catch{}}
    tone(frequency,end,duration,delay=0,volume=.055,type='sine'){
      const ac=this.context;if(!this.enabled||!ac||ac.state!=='running')return;
      try{const start=ac.currentTime+delay,osc=ac.createOscillator(),gain=ac.createGain();osc.type=type;osc.frequency.setValueAtTime(frequency,start);osc.frequency.exponentialRampToValueAtTime(end,start+duration);gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(volume,start+.006);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);osc.connect(gain);gain.connect(ac.destination);osc.onended=()=>{osc.disconnect();gain.disconnect();};osc.start(start);osc.stop(start+duration+.01);}catch{}
    }
    play(kind){if(kind==='hit'){this.tone(540,880,.09);this.tone(210,125,.065,0,.035,'triangle');}else if(kind==='lose'){this.tone(392,330,.12);this.tone(294,196,.22,.11,.045);}else if(kind==='level'){this.tone(660,660,.09);this.tone(880,880,.13,.08);}else{this.tone(440,660,.08);this.tone(660,880,.1,.075);}}
    toggle(){this.enabled=!this.enabled;try{localStorage.setItem(C.storageKey+'-sound',this.enabled?'on':'off');}catch{}if(this.enabled)this.unlock().then(()=>this.play('start'));}
  }
  const sound=new AudioFX(),soundButton=document.getElementById('sound');
  function syncSoundButton(){soundButton.setAttribute('aria-pressed',String(!sound.enabled));soundButton.setAttribute('aria-label',sound.enabled?'Выключить звук':'Включить звук');}
  soundButton.addEventListener('click',()=>{sound.toggle();syncSoundButton();});syncSoundButton();
  const canvas=document.getElementById('canvas'),field=document.getElementById('field'),overlay=document.getElementById('overlay'),scoreEl=document.getElementById('score'),bestEl=document.getElementById('best'),levelEl=document.getElementById('level'),button=document.getElementById('play');
  let ctx=canvas.getContext('2d'),world,running=false,paused=false,last=0,accumulator=0,best=0,shownScore=-1,newBest=false,frameRequest=0,spriteDpr=1,spriteKey='';

  const skins=[
    {id:'wood',name:'Дерево',at:0,base:'#a96832',edge:'#8f5427',light:'#dbab6b',cap:'#b86b8f'},
    {id:'metal',name:'Металл',at:20,base:'#545963',edge:'#303039',light:'#d0d3d9',cap:'#8a3d50'},
    {id:'bronze',name:'Бронза',at:30,base:'#a7663d',edge:'#623620',light:'#f1c397',cap:'#763342'},
    {id:'silver',name:'Серебро',at:40,base:'#acbdcc',edge:'#61798a',light:'#ffffff',cap:'#8a3d50'},
    {id:'gold',name:'Золото',at:50,base:'#df9c2c',edge:'#956013',light:'#fff0a2',cap:'#783248'},
    ...SPECIAL_SKINS,LEGENDARY_SKIN
  ];
  let storedCollection=[];try{storedCollection=JSON.parse(localStorage.getItem(C.storageKey+'-collection67')||'[]');}catch{}
  const collection=new RewardCollection(storedCollection,ids=>localStorage.setItem(C.storageKey+'-collection67',JSON.stringify(ids)));
  let selectedSkin='wood';
  function isUnlocked(skin){return skin.collectible?collection.owned.has(skin.id):best>=skin.at;}
  function activeSkin(){return skins.find(s=>s.id===selectedSkin)||skins[0];}
  const sprites={hand:null,rolls:[]};
  const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  try{const saved=Number(localStorage.getItem(C.storageKey));if(Number.isSafeInteger(saved)&&saved>0)best=saved;}catch{}
  try{const id=localStorage.getItem(C.storageKey+'-skin');if(skins.some(s=>s.id===id&&isUnlocked(s)))selectedSkin=id;}catch{}
  bestEl.textContent=best;
  function resize(){const box=field.getBoundingClientRect(),w=Math.max(180,box.width),h=Math.max(180,box.height),dpr=Math.min(window.devicePixelRatio||1,C.maxPixelRatio);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);spriteDpr=dpr;if(world)world.resize(w,h);else world=new World(w,h);world.paddleScale=activeSkin().size||1;world.move(world.target);buildSprites();draw();if(running&&!paused)scheduleFrame();}
  function makeSprite(width,height,paint){const image=document.createElement('canvas');image.width=Math.ceil(width*spriteDpr);image.height=Math.ceil(height*spriteDpr);const original=ctx;ctx=image.getContext('2d');try{ctx.setTransform(spriteDpr,0,0,spriteDpr,0,0);paint();}finally{ctx=original;}return {image,width,height};}
  function buildSprites(){if(typeof document.createElement!=='function')return;const key=[spriteDpr,world.radius,world.paddleWidth,C.handScale,selectedSkin].join(':');if(spriteKey===key)return;const size=world.radius*2+10;sprites.rolls=[];for(let type=0;type<5;type++)for(let mood=0;mood<3;mood++)sprites.rolls.push(makeSprite(size,size,()=>{ctx.translate(size/2,size/2);ctx.scale(world.radius/28,world.radius/28);rollArt(type,mood);}));const width=world.paddleWidth+24,previousDpr=spriteDpr;spriteDpr=Math.max(3,spriteDpr);try{sprites.hand=makeSprite(width,110,()=>{ctx.translate(width/2,22);handArt();});}finally{spriteDpr=previousDpr;}spriteKey=key;}
  function path(fill,stroke,width=2){ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
  function ellipse(x,y,rx,ry,color){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);path(color);}
  function sparkle(x,y,r,color){ctx.beginPath();for(let i=0;i<8;i++){const a=i*Math.PI/4,rr=i%2?r*.28:r;if(i===0)ctx.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);else ctx.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}ctx.closePath();path(color);}
  const trailColors=['#e8b89f','#b5c69c','#dca5b6','#8dc6d7','#c1a4df'];
  function trail(b){if(reducedMotion||b.type===3||b.trail.length<2)return;ctx.save();ctx.globalAlpha=.13;ctx.strokeStyle=trailColors[b.type];ctx.lineWidth=world.radius*.55;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(b.trail[0].x,b.trail[0].y);for(let i=1;i<b.trail.length;i++)ctx.lineTo(b.trail[i].x,b.trail[i].y);ctx.stroke();ctx.restore();}
  function roll(b,alpha=1){ctx.save();ctx.translate((b.prevX??b.x)+(b.x-(b.prevX??b.x))*alpha,(b.prevY??b.y)+(b.y-(b.prevY??b.y))*alpha);ctx.rotate((b.prevAngle??b.angle)+(b.angle-(b.prevAngle??b.angle))*alpha);ctx.scale(1+b.squash*.15,1-b.squash*.12);if(b.squash>.1){ctx.save();ctx.globalAlpha=b.squash*.35;ellipse(0,0,world.radius+5,world.radius+5,'#efd2dd');ctx.restore();}const mood=b.squash>0?1:b.vy>0&&b.y>world.paddleY-world.radius*4?2:0;const sprite=sprites.rolls[b.type*3+mood];if(sprite)ctx.drawImage(sprite.image,-sprite.width/2,-sprite.height/2,sprite.width,sprite.height);else{ctx.scale(world.radius/28,world.radius/28);rollArt(b.type);}ctx.restore();}
  function rollArt(type,mood=0){
    const r=28;
    const colors=['#ffad77','#a7c873','#fa9fa2','#6ebdd2','#b28bda'];
    ellipse(0,3,r,r,colors[type]);ellipse(0,0,r*.85,r*.84,'#fff6df');
    for(let i=0;i<13;i++){const a=i*Math.PI*2/13;ellipse(Math.cos(a)*r*.77,Math.sin(a)*r*.76,3.8,2.5,'#fff');}
    // Filling, cheeks and a tiny smiling face.
    ellipse(0,-r*.48,r*.22,r*.13,type===1?'#639551':type===3?'#3b8ca9':type===4?'#8157b7':'#ef856c');
    ellipse(-r*.48,r*.15,4,2.5,'#f9b4a9');ellipse(r*.48,r*.15,4,2.5,'#f9b4a9');
    if(mood===1){ctx.strokeStyle='#45352d';ctx.lineWidth=2;for(const x of [-8,8]){ctx.beginPath();ctx.arc(x,0,3,Math.PI,2*Math.PI);ctx.stroke();}}else{ellipse(-8,-1,1.8,type===2?1.3:2.5,'#45352d');if(type===3&&mood===0){ctx.beginPath();ctx.moveTo(5,-1);ctx.lineTo(11,-1);ctx.strokeStyle='#45352d';ctx.stroke();}else ellipse(8,-1,type===4?2.6:1.8,type===1?3.5:2.5,'#45352d');}if(mood===2)ellipse(0,7,3,4,'#45352d');
    ctx.beginPath();ctx.arc(0,2,mood===1?6:type===4?3:4.2,0,Math.PI);ctx.strokeStyle='#45352d';ctx.lineWidth=1.8;ctx.stroke();
  }
  function hand(alpha=1){const dip=world.recoil;ctx.save();ctx.translate(world.prevX+(world.x-world.prevX)*alpha,world.paddleY+dip);ctx.rotate(dip*.002);if(sprites.hand){const sprite=sprites.hand;ctx.drawImage(sprite.image,-sprite.width/2,-22,sprite.width,sprite.height);}else handArt();ctx.restore();}
  function handArt(){
    ctx.save();ctx.scale(world.basePaddleWidth/720,world.basePaddleWidth/720);ctx.translate(-360,-100);ctx.lineCap='round';ctx.lineJoin='round';
    // Open grip inspired by the reference; palm and curled fingers behind wood.
    function gripLayer(front){ctx.save();ctx.translate(360,100);ctx.scale(C.handScale,C.handScale);ctx.translate(-360,-100);
      if(!front){
        ctx.beginPath();ctx.moveTo(340,89);ctx.bezierCurveTo(409,69,477,103,511,165);ctx.bezierCurveTo(545,221,562,274,550,319);ctx.bezierCurveTo(538,365,512,405,501,449);ctx.bezierCurveTo(495,482,505,511,513,535);ctx.bezierCurveTo(478,559,414,575,367,563);ctx.bezierCurveTo(355,521,330,477,323,435);ctx.bezierCurveTo(315,390,343,341,372,300);ctx.lineTo(392,214);ctx.lineTo(339,151);ctx.closePath();path('#edc18e','#daa56d',3);
        ctx.beginPath();ctx.moveTo(491,161);ctx.bezierCurveTo(541,223,547,288,533,325);ctx.bezierCurveTo(519,369,496,408,486,448);ctx.bezierCurveTo(479,485,487,514,496,542);ctx.lineTo(513,535);ctx.bezierCurveTo(501,494,494,482,501,449);ctx.bezierCurveTo(512,405,551,344,550,299);ctx.closePath();path('#e7b681');
        for(const f of [{x:283,y:228,dx:80,dy:-36},{x:267,y:291,dx:107,dy:-59},{x:301,y:321,dx:82,dy:-70}]){ctx.beginPath();ctx.moveTo(f.x+f.dx,f.y+f.dy);ctx.bezierCurveTo(f.x+f.dx-10,f.y+f.dy-21,f.x-17,f.y-8,f.x-13,f.y+10);ctx.bezierCurveTo(f.x-5,f.y+38,f.x+18,f.y+28,f.x+f.dx+17,f.y+f.dy+23);ctx.closePath();path('#efc795','#d8a36e',3);}
      }else{
        ctx.beginPath();ctx.moveTo(374,350);ctx.lineTo(370,218);ctx.lineTo(374,144);ctx.bezierCurveTo(374,118,385,104,402,108);ctx.bezierCurveTo(423,112,432,128,430,156);ctx.lineTo(431,216);ctx.bezierCurveTo(431,247,439,272,458,287);ctx.bezierCurveTo(476,303,464,319,446,328);ctx.bezierCurveTo(432,347,438,371,414,398);ctx.bezierCurveTo(399,416,374,424,356,414);ctx.bezierCurveTo(357,391,366,368,374,350);ctx.closePath();path('#edc18e');
        ctx.beginPath();ctx.moveTo(374,350);ctx.lineTo(370,218);ctx.lineTo(374,144);ctx.bezierCurveTo(374,118,385,104,402,108);ctx.bezierCurveTo(423,112,432,128,430,156);ctx.lineTo(431,216);ctx.bezierCurveTo(431,247,439,272,458,287);ctx.bezierCurveTo(476,303,464,319,446,328);ctx.strokeStyle='#d6a06a';ctx.lineWidth=4;ctx.stroke();
        ctx.beginPath();ctx.moveTo(382,332);ctx.lineTo(379,215);ctx.lineTo(382,145);ctx.bezierCurveTo(382,125,387,117,393,118);ctx.strokeStyle='#f8dcb2';ctx.lineWidth=9;ctx.stroke();
        ctx.beginPath();ctx.moveTo(435,182);ctx.lineTo(463,213);ctx.lineTo(445,234);ctx.strokeStyle='#d9a46c';ctx.lineWidth=4;ctx.stroke();
        ctx.beginPath();ctx.moveTo(441,336);ctx.quadraticCurveTo(432,349,430,362);ctx.strokeStyle='#e0ad76';ctx.lineWidth=3;ctx.stroke();
      }ctx.restore();}
    gripLayer(false);
    ctx.save();const stickScale=activeSkin().size||1;ctx.translate(360,100);ctx.scale(stickScale,stickScale);ctx.translate(-360,-100);drawChopsticks(activeSkin());ctx.restore();
    gripLayer(true);
    ctx.restore();
  }
  function drawChopsticks(material){

    // Top chopstick matches paddleSlope; the second opens out beneath it.
    for(const stick of [{left:0,right:200},{left:210,right:285}]){
      const slope=(stick.right-stick.left)/720;
      ctx.beginPath();ctx.moveTo(0,stick.left-5);ctx.lineTo(715,stick.right-13);ctx.quadraticCurveTo(726,stick.right-13,724,stick.right-2);ctx.lineTo(721,stick.right+12);ctx.lineTo(0,stick.left+5);ctx.closePath();let finish=material.base;const middle=stick.left+slope*360;finish=ctx.createLinearGradient(360+slope*18,middle-18,360-slope*18,middle+18);finish.addColorStop(0,material.edge);finish.addColorStop(.2,material.base);finish.addColorStop(.42,material.light);finish.addColorStop(.52,material.base);finish.addColorStop(.8,material.base);finish.addColorStop(1,material.edge);path(finish,material.edge,2);
      ctx.beginPath();ctx.moveTo(10,stick.left-2);ctx.lineTo(591,stick.left+slope*591-6);ctx.strokeStyle=material.light;ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.moveTo(20,stick.left+slope*20+2);ctx.lineTo(590,stick.left+slope*590+7);ctx.strokeStyle=material.edge;ctx.globalAlpha=.4;ctx.lineWidth=1.5;ctx.stroke();ctx.globalAlpha=1;
      ctx.beginPath();ctx.moveTo(602,stick.left+slope*602-12);ctx.lineTo(715,stick.right-13);ctx.quadraticCurveTo(726,stick.right-13,724,stick.right-2);ctx.lineTo(721,stick.right+12);ctx.lineTo(599,stick.left+slope*599+12);ctx.closePath();path(material.cap);
      ctx.beginPath();ctx.moveTo(602,stick.left+slope*602-12);ctx.lineTo(599,stick.left+slope*599+12);ctx.strokeStyle='#772b50';ctx.lineWidth=9;ctx.stroke();if(material.id!=='wood'){ctx.beginPath();ctx.moveTo(618,stick.left+slope*618-11);ctx.lineTo(616,stick.left+slope*616+11);ctx.strokeStyle=material.light;ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.moveTo(20,stick.left+slope*20+2);ctx.lineTo(590,stick.left+slope*590+7);ctx.strokeStyle=material.edge;ctx.globalAlpha=.4;ctx.lineWidth=1.5;ctx.stroke();ctx.globalAlpha=1;if(material.id!=='metal'){for(let i=0;i<5;i++){const a=i*Math.PI*2/5;ellipse(680+Math.cos(a)*5,stick.left+slope*680+Math.sin(a)*5,2.6,2.6,material.light);}}}
      if(material.pattern)drawOrnament(material,stick.left,slope);
    }
  }
  function drawOrnament(material,left,slope){
    ctx.save();ctx.transform(1,slope,0,1,0,left);ctx.strokeStyle=material.light;ctx.fillStyle=material.light;ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
    const kind=material.pattern;
    if(kind==='thorn'){
      // Sculpted spikes protrude from the shaft; curls and a gemstone finish the handle.
      for(let x=150;x<590;x+=62){ctx.beginPath();ctx.moveTo(x-12,-4);ctx.quadraticCurveTo(x-3,-12,x+2,-24);ctx.quadraticCurveTo(x+8,-15,x+15,-3);ctx.closePath();path(material.cap,material.light,2.5);ctx.beginPath();ctx.moveTo(x+12,4);ctx.quadraticCurveTo(x+20,12,x+26,20);ctx.quadraticCurveTo(x+29,11,x+36,3);ctx.closePath();path(material.cap,material.light,2.5);}
      for(let x=205;x<600;x+=130){ctx.beginPath();ctx.moveTo(x,-5);ctx.bezierCurveTo(x+30,-36,x+52,-15,x+29,-11);ctx.bezierCurveTo(x+14,-8,x+16,-22,x+27,-20);ctx.strokeStyle=material.light;ctx.lineWidth=3;ctx.stroke();}
      ctx.beginPath();ctx.moveTo(650,-9);ctx.quadraticCurveTo(675,-32,708,-10);ctx.moveTo(650,9);ctx.quadraticCurveTo(675,32,708,10);ctx.stroke();
    }
    if(kind==='dragon'){ctx.beginPath();ctx.moveTo(140,0);for(let x=140;x<580;x+=34)ctx.bezierCurveTo(x+8,-10,x+26,10,x+34,0);ctx.stroke();for(let x=180;x<570;x+=34){ctx.beginPath();ctx.moveTo(x,-4);ctx.lineTo(x+5,-9);ctx.lineTo(x+10,-3);ctx.stroke();}}
    if(kind==='wave'){for(let x=150;x<590;x+=46){ctx.beginPath();ctx.moveTo(x-12,4);ctx.bezierCurveTo(x+2,4,x-5,-10,x+12,-7);ctx.bezierCurveTo(x+28,-4,x+19,7,x+11,2);ctx.stroke();}}
    if(kind==='blossom'){ctx.beginPath();ctx.moveTo(140,4);ctx.bezierCurveTo(270,-6,390,7,580,-3);ctx.stroke();for(let x=180;x<580;x+=75){ctx.beginPath();ctx.moveTo(x,1);ctx.lineTo(x+12,-7);ctx.stroke();for(let n=0;n<5;n++){const a=n*Math.PI*2/5;ellipse(x+13+Math.cos(a)*5,-5+Math.sin(a)*5,2.8,2.8,material.light);}}}
    if(kind==='bamboo'){for(let x=160;x<590;x+=65){ctx.beginPath();ctx.moveTo(x,-8);ctx.lineTo(x,8);ctx.moveTo(x+5,-8);ctx.lineTo(x+5,8);ctx.stroke();ctx.beginPath();ctx.moveTo(x+22,3);ctx.quadraticCurveTo(x+30,-11,x+40,-4);ctx.quadraticCurveTo(x+35,4,x+22,3);path(material.light);}}
    if(kind==='thunder'){for(let x=150;x<580;x+=65){ctx.beginPath();ctx.moveTo(x+22,-8);ctx.lineTo(x+5,1);ctx.lineTo(x+18,1);ctx.lineTo(x+1,9);ctx.lineTo(x+36,-2);ctx.lineTo(x+22,-2);ctx.closePath();path(material.light);}}
    if(kind==='galaxy'){ctx.beginPath();ctx.moveTo(150,1);for(let x=150;x<590;x+=48)ctx.lineTo(x,x%96===54?-5:5);ctx.stroke();for(let x=150;x<590;x+=48)sparkle(x,x%96===54?-5:5,5,material.light);}
    if(kind==='koi'){for(let x=150;x<590;x+=30){ctx.beginPath();ctx.arc(x,0,7,-Math.PI/2,Math.PI/2);ctx.stroke();}for(let x=175;x<590;x+=90){ellipse(x,0,9,5,material.cap);ellipse(x+7,-1,4,3,material.light);}}
    if(kind==='ice'){for(let x=155;x<590;x+=52){ctx.beginPath();ctx.moveTo(x,-8);ctx.lineTo(x+16,0);ctx.lineTo(x,8);ctx.lineTo(x-16,0);ctx.closePath();ctx.moveTo(x,-8);ctx.lineTo(x,8);ctx.stroke();}}
    if(kind==='flame'){for(let x=150;x<590;x+=45){ctx.beginPath();ctx.moveTo(x-6,6);ctx.bezierCurveTo(x+4,-1,x-4,-6,x+20,-9);ctx.bezierCurveTo(x+9,-2,x+32,0,x+23,6);ctx.closePath();path(material.light);}}
    if(kind==='royal'){for(let x=160;x<590;x+=55){ctx.beginPath();ctx.moveTo(x,-7);ctx.bezierCurveTo(x+20,-13,x+28,9,x+8,6);ctx.bezierCurveTo(x-10,3,x-14,-7,x,-7);ctx.stroke();ellipse(x+5,0,2,2,material.cap);}}
    // A distinct carved finial on the handle, within the original stick footprint.
    ctx.translate(680,0);ctx.lineWidth=2.5;
    if(kind==='thorn'){ctx.beginPath();ctx.moveTo(0,-19);ctx.lineTo(13,0);ctx.lineTo(0,19);ctx.lineTo(-13,0);ctx.closePath();path('#72d6cd',material.light,3);ctx.beginPath();ctx.moveTo(0,-14);ctx.lineTo(0,12);ctx.strokeStyle='#e1fff4';ctx.lineWidth=2;ctx.stroke();}
    else if(kind==='dragon'){ctx.beginPath();ctx.moveTo(-15,0);ctx.quadraticCurveTo(10,-19,16,-2);ctx.quadraticCurveTo(18,12,3,8);ctx.quadraticCurveTo(-8,3,4,-1);ctx.stroke();ctx.beginPath();ctx.moveTo(9,-8);ctx.lineTo(7,-15);ctx.moveTo(14,-6);ctx.lineTo(20,-11);ctx.stroke();}
    else if(kind==='bamboo'){ctx.beginPath();ctx.moveTo(-12,8);ctx.lineTo(8,-8);ctx.moveTo(0,-1);ctx.quadraticCurveTo(-16,-16,-14,-2);ctx.moveTo(0,0);ctx.quadraticCurveTo(21,-3,12,8);ctx.stroke();}
    else if(kind==='royal'){ctx.beginPath();ctx.moveTo(-17,7);ctx.lineTo(-19,-5);ctx.lineTo(-8,0);ctx.lineTo(0,-12);ctx.lineTo(8,0);ctx.lineTo(19,-5);ctx.lineTo(17,7);ctx.closePath();path(material.light);}
    else if(kind==='galaxy'||kind==='ice')sparkle(0,0,13,material.light);
    else if(kind==='wave'){ctx.beginPath();ctx.arc(0,0,11,.3,Math.PI*1.9);ctx.quadraticCurveTo(6,-1,0,3);ctx.stroke();}
    else if(kind==='thunder'){ctx.beginPath();ctx.moveTo(5,-13);ctx.lineTo(-9,2);ctx.lineTo(0,2);ctx.lineTo(-5,13);ctx.lineTo(12,-3);ctx.lineTo(2,-3);ctx.closePath();path(material.light);}
    else if(kind==='flame'){ctx.beginPath();ctx.moveTo(-9,7);ctx.bezierCurveTo(-12,-1,5,-2,3,-14);ctx.bezierCurveTo(23,4,10,15,-9,7);path(material.light);}
    else if(kind==='koi'){ellipse(0,0,12,6,material.light);ctx.beginPath();ctx.moveTo(-10,0);ctx.lineTo(-19,-7);ctx.lineTo(-19,7);ctx.closePath();path(material.light);ellipse(7,-1,2,2,material.cap);}
    else for(let n=0;n<5;n++){const a=n*Math.PI*2/5;ellipse(Math.cos(a)*7,Math.sin(a)*7,4,4,material.light);}
    ctx.restore();
  }
  function effect(e){
    const f=e.life/e.duration;ctx.save();ctx.globalAlpha=1-f;
    if(e.kind==='level'){ctx.translate(e.x,e.y-(reducedMotion?0:f*24));ctx.textAlign='center';ctx.font='800 21px system-ui';ctx.fillStyle='#8a3d50';ctx.fillText(e.label,0,0);if(!reducedMotion)for(let i=0;i<6;i++)sparkle(Math.cos(i*Math.PI/3)*(38+f*55),Math.sin(i*Math.PI/3)*(19+f*20)-5,3*(1-f),'#d592a5');ctx.restore();return;}
    if(e.kind==='wall'){if(!reducedMotion){ctx.strokeStyle='#e9c4ce';ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,5+f*16,0,Math.PI*2);ctx.stroke();}ctx.restore();return;}
    // A short contact flash, a spreading ring and tiny rice/petal confetti.
    if(!reducedMotion){ctx.save();ctx.globalAlpha=(1-f)*.55;ellipse(e.x,e.y,9+f*37,4+f*12,'#f5e3e8');ctx.strokeStyle='#c77b91';ctx.lineWidth=2*(1-f)+.4;ctx.beginPath();ctx.ellipse(e.x,e.y,8+f*32,4+f*14,0,0,Math.PI*2);ctx.stroke();ctx.restore();
      for(let i=0;i<C.impactParticles;i++){const angle=-Math.PI+.22+i*(Math.PI-.44)/(C.impactParticles-1),speed=48+(i*23+e.seed*11)%57,age=e.life,px=e.x+Math.cos(angle)*speed*age,py=e.y+Math.sin(angle)*speed*age+65*age*age;ctx.save();ctx.translate(px,py);ctx.rotate(age*(i%2?5:-5));if(i%3===0)sparkle(0,0,3.5*(1-f)+.5,'#b66a80');else ellipse(0,0,i%3===1?2.1:3.1,i%3===1?4:1.8,i%3===1?'#fff0e5':'#d89caf');ctx.restore();}
      if(f<.33){ctx.save();ctx.globalAlpha=1-f*3;sparkle(e.x,e.y-2,11+f*16,'#ddb1bf');ctx.restore();}}
    ctx.translate(e.x,e.y-25-(reducedMotion?0:f*43));const pop=reducedMotion?1:1+Math.sin(Math.min(1,f*4)*Math.PI)*.22;ctx.scale(pop,pop);ctx.font='800 20px system-ui';ctx.textAlign='center';ctx.lineWidth=4;ctx.strokeStyle='#fff';ctx.strokeText('+1',0,0);ctx.fillStyle='#8a3d50';ctx.fillText('+1',0,0);ctx.restore();
  }
  function draw(alpha=1){
    if(!world)return;ctx.clearRect(0,0,world.width,world.height);
    if(!running){const t=performance.now()/1000;roll({x:world.width*.23,y:world.height*.23+Math.sin(t)*5,angle:-.25,type:0,squash:0});roll({x:world.width*.8,y:world.height*.55+Math.sin(t+1)*6,angle:.2,type:1,squash:0});}
    else {for(const b of world.rolls)trail(b);for(const b of world.rolls)roll(b,alpha);}
    hand(alpha);
    for(const e of world.effects)effect(e);
  }
  let rewardToastTimer=0,legendaryEarned=false;
  function announceLegend(){legendaryEarned=true;const toast=document.getElementById('rewardToast');toast.textContent='100 очков! Открыт «Терновый дракон» · зона подбивания +15%';toast.hidden=false;clearTimeout(rewardToastTimer);rewardToastTimer=setTimeout(()=>toast.hidden=true,3400);sound.play('level');}
  function announceReward(skin){const toast=document.getElementById('rewardToast');toast.textContent='Новые палочки: '+skin.name+' · '+collection.owned.size+'/10';toast.hidden=false;clearTimeout(rewardToastTimer);rewardToastTimer=setTimeout(()=>toast.hidden=true,2800);sound.play('level');}
  function sync(){if(shownScore===world.score)return;const reward=collection.earn(world.score);if(reward)announceReward(reward);if(world.score>=100&&best<100)announceLegend();if(shownScore>=0&&world.score>shownScore)sound.play(milestone(world.score)?'level':'hit');shownScore=world.score;scoreEl.textContent=world.score;levelEl.textContent=world.stage.label;if(world.score>best){best=world.score;newBest=true;bestEl.textContent=best;try{localStorage.setItem(C.storageKey,String(best));}catch{}}}
  function finish(){running=false;pauseButton.hidden=true;sync();sound.play('lose');document.getElementById('overlayKicker').textContent=newBest?'НОВЫЙ ЛИЧНЫЙ РЕКОРД!':'ЕЩЁ ОДИН РОЛЛ?';document.getElementById('overlayTitle').textContent=world.score+' '+(world.score%10===1&&world.score%100!==11?'очко':world.score%10>=2&&world.score%10<=4&&(world.score%100<12||world.score%100>14)?'очка':'очков');document.getElementById('overlayText').textContent='Ролл ускользнул. Ваш рекорд — '+best+'.';document.getElementById('overlayHint').textContent=legendaryEarned?'Открыт «Терновый дракон» — выберите в меню палочек':collection.lastReward?'Получены палочки «'+collection.lastReward.name+'» · Коллекция '+collection.owned.size+'/10':collection.owned.size===10?'Коллекция за 67 очков собрана: 10/10':'67 очков — случайные новые палочки · '+collection.owned.size+'/10';button.textContent='Играть снова';overlay.hidden=false;}
  button.addEventListener('click',()=>{if(skinDialog.open)skinDialog.close();sound.unlock().then(()=>sound.play('start'));collection.beginRound();legendaryEarned=false;clearTimeout(rewardToastTimer);document.getElementById('rewardToast').hidden=true;world.reset();newBest=false;shownScore=-1;running=true;paused=false;pauseButton.hidden=false;overlay.hidden=true;accumulator=0;last=0;sync();scheduleFrame();});
  function pointer(event){if(!running||paused)return;const rect=canvas.getBoundingClientRect();world.move(event.clientX-rect.left);}
  field.addEventListener('pointerdown',event=>{if(!running||paused||event.target?.closest?.('button'))return;field.setPointerCapture?.(event.pointerId);pointer(event);});
  field.addEventListener('pointermove',pointer);
  function scheduleFrame(){if(!frameRequest)frameRequest=requestAnimationFrame(frame);}
  function cancelFrame(){if(frameRequest){if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(frameRequest);frameRequest=0;}}
  let resumeTimer=0;
  const pauseButton=document.createElement('button');pauseButton.hidden=true;pauseButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.8"/><rect x="14" y="4" width="5" height="16" rx="1.8"/></svg>';pauseButton.setAttribute('aria-label','Пауза');pauseButton.className='pause-button';field.appendChild(pauseButton);
  const pauseScreen=document.createElement('div');pauseScreen.className='pause-screen';pauseScreen.style.cssText='position:absolute;inset:0;z-index:6;background:#fbf8f5dd;display:none;align-items:center;justify-content:center;flex-direction:column;gap:20px;font:700 36px Georgia;color:#8a3d50';field.appendChild(pauseScreen);
  function pauseGame(){if(!running)return;clearTimeout(resumeTimer);paused=true;last=0;accumulator=0;cancelFrame();draw();pauseScreen.replaceChildren();pauseScreen.style.display='flex';pauseScreen.textContent='Пауза';const btn=document.createElement('button');btn.className='resume-button';btn.innerHTML='<span aria-hidden="true">▶</span> Продолжить';btn.onclick=resumeGame;pauseScreen.appendChild(btn);}
  function resumeGame(){if(!running||document.hidden)return;clearTimeout(resumeTimer);paused=true;pauseScreen.style.display='flex';let count=3;pauseScreen.textContent=count;function tick(){if(document.hidden){pauseGame();return;}count--;if(count){pauseScreen.textContent=count;resumeTimer=setTimeout(tick,500);}else{pauseScreen.style.display='none';paused=false;last=0;accumulator=0;scheduleFrame();}}resumeTimer=setTimeout(tick,500);}
  pauseButton.type='button';pauseButton.style.touchAction='manipulation';pauseButton.addEventListener('pointerdown',event=>event.stopPropagation());pauseScreen.addEventListener('pointerdown',event=>event.stopPropagation());pauseButton.addEventListener('click',pauseGame);
  const skinDialog=document.getElementById('skinDialog'),skinList=document.getElementById('skinList');
  function renderSkins(){skinList.replaceChildren();document.getElementById('collectionProgress').textContent=collection.owned.size+' из 10 · за 67 очков в каждой партии';for(const skin of skins){if(skin.legendary){const heading=document.createElement('h3');heading.className='collection-heading';heading.textContent='Легендарные · 100 очков';skinList.appendChild(heading);}if(skin.id==='dragon'){const heading=document.createElement('h3');heading.className='collection-heading';heading.textContent='Особая коллекция · 67';skinList.appendChild(heading);}const unlocked=isUnlocked(skin),chosen=skin.id===selectedSkin;const card=document.createElement('button');card.type='button';card.className='skin-choice'+(skin.collectible?' special-skin':skin.legendary?' legendary-skin':'')+(!unlocked?' locked':'')+(chosen?' selected':'');card.disabled=!unlocked;card.setAttribute('aria-pressed',String(chosen));card.innerHTML=`<span class="skin-name">${skin.name}</span>${skin.legendary?'<span class="skin-bonus">Зона подбивания +15%</span>':''}<span class="skin-state">${!unlocked?(skin.collectible?'🔒 Награда за 67':'🔒 '+skin.at+' очков'):chosen?'✓ Выбраны':'Выбрать'}</span>`;const oldDpr=spriteDpr;spriteDpr=3;let preview;try{preview=makeSprite(160,70,()=>{ctx.translate(3,4);ctx.scale(154/730,154/730);ctx.lineCap='round';ctx.lineJoin='round';drawChopsticks(skin);});}finally{spriteDpr=oldDpr;}preview.image.className='skin-preview';preview.image.setAttribute('aria-hidden','true');card.prepend(preview.image);card.onclick=()=>{if(running||!isUnlocked(skin))return;selectedSkin=skin.id;try{localStorage.setItem(C.storageKey+'-skin',selectedSkin);}catch{}world.paddleScale=activeSkin().size||1;world.move(world.target);world.x=clamp(world.x,world.paddleWidth/2+5,world.width-world.paddleWidth/2-5);world.prevX=world.x;buildSprites();draw();renderSkins();};skinList.appendChild(card);}}
  function openSkins(){if(running)return;renderSkins();if(!skinDialog.open)skinDialog.showModal();}
  document.getElementById('openSkins').addEventListener('click',openSkins);
  document.getElementById('closeSkins').addEventListener('click',()=>skinDialog.close());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseGame();else if(running&&paused&&!skinDialog.open)resumeGame();});
  new ResizeObserver(resize).observe(field);
  function frame(now){frameRequest=0;const dt=last?Math.min(C.maxFrameTime,(now-last)/1000):0;last=now;if(running&&!paused){accumulator+=dt;while(accumulator>=C.fixedStep&&running){world.step(C.fixedStep);accumulator-=C.fixedStep;if(world.over)finish();}sync();}draw(running&&!paused?clamp(accumulator/C.fixedStep,0,1):1);if(running&&!paused)scheduleFrame();}
  resize();scheduleFrame();
  // Small host API for a future embedded view; no VK or network dependency.
  root.RollJuggle={pause:pauseGame,resume:resumeGame,getScore(){return world.score;}};
})(typeof globalThis!=='undefined'?globalThis:this);

