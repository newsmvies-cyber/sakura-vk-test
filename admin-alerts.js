(function(root){
  function createTracker(){var seen=null;return {reset:function(){seen=null},observe:function(orders){var fresh=[];if(seen===null){seen=new Set();orders.forEach(function(o){seen.add(o.id)});return fresh}orders.forEach(function(o){if(!seen.has(o.id)&&(o.status==='new'||o.status==='pending'))fresh.push(o.id);seen.add(o.id)});return fresh}}}
  var api={createTracker:createTracker};if(typeof module==='object')module.exports=api;else root.SakuraAdminAlerts=api;
})(typeof window==='object'?window:globalThis);
