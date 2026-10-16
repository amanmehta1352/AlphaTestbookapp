# seeds realistic history across days for dashboard screenshots
SEED = """(()=>{const ws=WorkspaceManager.current().id;const m=getWorkspaceModule('maths-percentage-class-test');const qs=m.groups.flatMap(g=>g.questions);
const days=[0,1,2,3,5,6,8,9,10,13,15,20,22,23,24,30,33,40];let k=0;
days.forEach(d=>{const day=sjAddDays(sjLocalDay(),-d);const n=5+((d*7)%28);for(let i=0;i<n;i++){const q=qs[(k++)%qs.length];AttemptHistory.push({v:1,ts:new Date(Date.now()-d*86400000).toISOString(),day,mode:'practice',ws,moduleId:m.moduleId,cid:q.canonicalQId,qno:q.originalQNo,subject:'maths',topic:'Percentage',correct:((i+d)%3)!==0,sec:40+(i%5)*12});}});
const e=getWorkspaceModule('science-physics-electricity-class-test');e.groups[0].questions.forEach((q,i)=>AttemptHistory.push({v:1,ts:new Date().toISOString(),day:sjLocalDay(),mode:'test',ws,moduleId:e.moduleId,cid:q.canonicalQId,subject:'science',topic:'Electricity',correct:i%2===0,sec:70}));
[55,62,58,71,66,80].forEach((acc,i)=>ResultHistory.unshift({v:1,id:'R-seed-'+i,ts:new Date(Date.now()-(6-i)*86400000).toISOString(),day:sjAddDays(sjLocalDay(),-(6-i)),ws,moduleId:m.moduleId,groupId:m.groups[0].groupId,topicTitle:'Percentage',total:20,correct:Math.round(acc/5),wrong:20-Math.round(acc/5),unattempted:0,score:Math.round(acc/5),accuracy:acc,questionIds:qs.slice(0,20).map(q=>q.canonicalQId)}));
[0,1,2].forEach(i=>onPracticeSelect('B',e.groups[0].questions[i].originalQNo,e.moduleId,i));
StudySettings.dailyGoal=50; StudySettings.examDate=sjAddDays(sjLocalDay(),45); StudySettings.focusLog[sjLocalDay()]=3000;
LearningStatsCache={key:'',value:null}; navigate('home');})()"""
