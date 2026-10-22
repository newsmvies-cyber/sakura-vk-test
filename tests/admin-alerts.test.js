const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTracker}=require('../admin-alerts');
test('Initial snapshot, duplicates, statuses and reopen do not alert',()=>{const t=createTracker();assert.deepEqual(t.observe([{id:'old',status:'new'}]),[]);assert.deepEqual(t.observe([{id:'old',status:'accepted'},{id:'new',status:'new'}]),['new']);assert.deepEqual(t.observe([{id:'new',status:'new'}]),[]);assert.deepEqual(t.observe([{id:'done',status:'done'}]),[]);t.reset();assert.deepEqual(t.observe([{id:'reopen',status:'new'}]),[])});
