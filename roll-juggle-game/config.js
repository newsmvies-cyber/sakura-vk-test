/* Speeds use pixels/second. Shorter flightSeconds gives faster mobile play. */
(function(root){
  'use strict';
  const config={
    storageKey:'roll-juggle-best-v1',
    fixedStep:1/120,
    maxFrameTime:0.05,
    paddleWidth:108,
    paddleSlope:0.278,
    paddleRecoil:7,
    handScale:0.74,
    trailPoints:6,
    impactParticles:6,
    maxEffects:8,
    maxPixelRatio:1.5,
    rollEvery:10,
    maxRolls:5,
    speedUpAfter:50,
    speedStepGain:0.08,
    paddleBottom:103,
    followSpeed:28,
    rollRadius:20,
    gravityScale:1,
    bounceHeightRatio:0.82,
    spawnDelay:0.6,
    minLandingGap:0.27,
    stages:[
      {from:0,rolls:1,flightSeconds:2.65,horizontalSpeed:68,label:'Плавно'},
      {from:10,rolls:2,flightSeconds:2.5,horizontalSpeed:85,label:'В ритме'},
      {from:20,rolls:3,flightSeconds:2.35,horizontalSpeed:102,label:'Жарко!'},
      {from:30,rolls:4,flightSeconds:2.2,horizontalSpeed:118,label:'Очень жарко!'},
      {from:50,rolls:5,flightSeconds:2.05,horizontalSpeed:132,label:'Экстрим!'}
    ],
    // Difficulty keeps increasing past 80, without a score ceiling.
    endlessSpeedGain:0.004,
    maxEndlessMultiplier:1.55
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=config;
  root.ROLL_GAME_CONFIG=config;
})(typeof globalThis!=='undefined'?globalThis:this);
