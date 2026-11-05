/* Scene editing and search UI. Classic script shares the original canvas state. */
(function () {
 'use strict';
 const core=RoutePlannerCore, $=id=>document.getElementById(id);
 const state={objects:[],sequence:[],selectedId:null,tool:'shot',drag:null,serial:0,revision:0,
   searchToken:0,running:false,results:[],resultOrigin:null,selectedRoute:null,stamp:'',lastLog:''};
 const panel=$('plannerPanel'), toggle=$('plannerToggle');
 const colors={boss:'#b68cff',book:'#65c9ff',enemy:'#f58e8e',weak:'#ffd364',mine:'#8ee768'};
 const kindName={boss:'ボス',book:'本',enemy:'敵',weak:'弱点',mine:'地雷'};
 const wallName={left:'左',right:'右',top:'上',bottom:'下'};
 const label=o=>o.label||kindName[o.role||o.kind];
 const selected=()=>state.objects.find(o=>o.id===state.selectedId);
 const currentDegrees=()=>core.normalize(-pullAngle*180/Math.PI);
 function number(id,fallback,min,max){const n=Number($(id).value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
 function scene(){return {start:{...cursor},bounds:bounds(),objects:state.objects.map(o=>({...o})),sequence:state.sequence.map(s=>({...s}))};}
 function options(){const b=bounds();return {initialMines:Math.trunc(number('initialMines',0,0,4)),maxBounces:Math.trunc(number('searchBounces',6,0,20)),
   maxDistance:(b.r-b.l)*number('searchDistance',6,.5,50),playerRadius:number('playerRadius',0,0,100),
   angleTolerance:Math.trunc(number('angleTolerance',1,0,3)),startTolerance:number('startTolerance',2,0,30),maxResults:8};}
 function status(text){$('searchStatus').textContent=text;}
 function openPanel(open){panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));if(open)setTool('shot');}
 toggle.onclick=()=>openPanel(panel.hidden);
 $('plannerClose').onclick=()=>openPanel(false);
 $('placementDone').onclick=()=>openPanel(true);
 function setTool(tool){
   state.tool=tool;state.drag=null;
   $('plannerPlacement').hidden=tool==='shot';
   $('placementHint').textContent=tool==='start'?'画像上をタップして始点を置く':tool==='select'?'対象をタップして選択、ドラッグして移動':`${kindName[tool]}をタップで連続配置`;
 }
 function ready(){if(imgW&&!stage.hidden)return true;status('先に「画像を選択」でスクリーンショットを読み込んでください。');return false;}
 for(const button of document.querySelectorAll('[data-tool]'))button.onclick=()=>{
   if(!ready())return;
   if(zoomMode)zoomBtn.click();
   setTool(button.dataset.tool);openPanel(false);
 };
 function stopSearch(message){
   state.searchToken++;state.running=false;$('searchRoutes').disabled=false;$('cancelSearch').disabled=true;
   if(message)status(message);
 }
 function changed(message='配置・条件が変わりました。もう一度検索してください。'){
   const hadResults=state.results.length||state.running;
   state.revision++;stopSearch();state.results=[];state.resultOrigin=null;state.selectedRoute=null;
   window.plannerGuideDistance=undefined;state.lastLog='';renderResults();
   if(hadResults)status(message);
 }
 $('angleMode').onchange=()=>{
   angleMode=$('angleMode').value;setShotAngle(pullAngle);state.selectedRoute=null;
   window.plannerGuideDistance=undefined;updateAngleUI();draw();
 };
 function makeObject(tool,p){
   const width=imgW;
   const role=tool==='boss'||tool==='book'?tool:undefined;
   const object={id:`target-${++state.serial}`,kind:['boss','book','enemy'].includes(tool)?'enemy':tool,role,
     label:`${kindName[tool]}${state.objects.filter(o=>(o.role||o.kind)===tool).length+1}`,x:p.x,y:p.y,
     rx:Math.round(width*({boss:.16,book:.065,enemy:.055,weak:.013,mine:.012}[tool])),
     ry:Math.round(width*({boss:.18,book:.04,enemy:.055,weak:.013,mine:.012}[tool]))};
   if(tool==='weak')object.parentId=selected()?.kind==='enemy'?selected().id:state.objects.find(o=>o.role==='book')?.id||'';
   state.objects.push(object);state.selectedId=object.id;
   if(tool==='book'){
     state.objects.push({id:`target-${++state.serial}`,kind:'weak',parentId:object.id,label:`${object.label}の弱点`,
       x:p.x,y:p.y,rx:Math.max(3,Math.round(width*.013)),ry:Math.max(3,Math.round(width*.013))});
   }
   return object;
 }
 function hitTarget(p){
   return [...state.objects].sort((a,b)=>(a.rx*a.ry)-(b.rx*b.ry)).find(o=>core.contains(o,p,Math.max(3,imgW*.006)));
 }
 window.plannerPointerDown=e=>{
   if(state.tool==='shot')return false;
   e.preventDefault();cv.setPointerCapture(e.pointerId);
   const p=pos(e),b=bounds();
   if(p.x<b.l||p.x>b.r||p.y<b.t||p.y>b.b)return true;
   if(state.tool==='start'){
     cursor={x:p.x,y:p.y};changed();setTool('shot');openPanel(true);draw();return true;
   }
   if(state.tool==='select'){
     const o=hitTarget(p);state.selectedId=o?.id||null;
     if(o)state.drag={id:o.id,x:p.x,y:p.y,originX:o.x,originY:o.y,
       children:state.objects.filter(c=>c.parentId===o.id).map(c=>({id:c.id,x:c.x,y:c.y}))};
   }else{
     if(state.objects.length+(state.tool==='book'?2:1)>80){status('配置は80個までです。');openPanel(true);return true;}
     makeObject(state.tool,p);changed();
   }
   renderObjects();draw();return true;
 };
 window.plannerPointerMove=e=>{
   if(state.tool==='shot')return false;
   if(state.drag){
     const o=state.objects.find(o=>o.id===state.drag.id),p=pos(e),b=bounds();
     o.x=Math.max(b.l,Math.min(b.r,state.drag.originX+p.x-state.drag.x));
     o.y=Math.max(b.t,Math.min(b.b,state.drag.originY+p.y-state.drag.y));
     for(const child of state.drag.children){const target=state.objects.find(o=>o.id===child.id);target.x=child.x+o.x-state.drag.originX;target.y=child.y+o.y-state.drag.originY;}
     changed();draw();
   }
   e.preventDefault();return true;
 };
 window.plannerPointerUp=()=>{if(state.tool==='shot')return false;state.drag=null;return true;};

 function renderObjects(){
   const list=$('objectList');list.replaceChildren();
   if(!state.objects.length){list.textContent='まだ配置されていません。';}
   for(const o of state.objects){
     const button=document.createElement('button');button.type='button';button.textContent=`${o.kind==='mine'?'●':o.kind==='weak'?'◇':'○'} ${label(o)}${o.avoid?'（避ける）':''}`;
     button.setAttribute('aria-pressed',String(o.id===state.selectedId));button.onclick=()=>{state.selectedId=o.id;renderObjects();draw();};list.append(button);
   }
   const o=selected();$('objectEditor').hidden=!o;if(!o)return;
   $('objectName').value=label(o);$('objectRx').value=o.rx;$('objectRy').value=o.ry;
   $('parentField').hidden=o.kind!=='weak';$('avoidField').hidden=o.kind!=='enemy';$('objectAvoid').checked=!!o.avoid;
   $('addCondition').disabled=o.kind==='mine'||o.avoid;
   $('objectParent').replaceChildren();
   for(const p of [{id:'',label:'所属なし'},...state.objects.filter(o=>o.kind==='enemy')]){
     const opt=document.createElement('option');opt.value=p.id;opt.textContent=label(p);$('objectParent').append(opt);
   }
   $('objectParent').value=o.parentId||'';
 }
 for(const [id,property] of [['objectName','label'],['objectRx','rx'],['objectRy','ry'],['objectParent','parentId']]){
   $(id).addEventListener('input',()=>{
     const o=selected();if(!o)return;
     if(property==='rx'||property==='ry'){
       const n=Number($(id).value);if(!Number.isFinite(n)||n<1)return;
       o[property]=Math.min(Math.max(imgW,imgH),n);
     }else o[property]=$(id).value;
     changed();renderConditions();draw();
   });
   $(id).addEventListener('change',renderObjects);
 }
 $('objectAvoid').onchange=()=>{const o=selected();if(!o)return;o.avoid=$('objectAvoid').checked;changed();renderObjects();renderConditions();draw();};
 $('deleteObject').onclick=()=>{
   const o=selected();if(!o)return;
   const ids=new Set([o.id,...state.objects.filter(c=>c.parentId===o.id).map(c=>c.id)]);
   state.objects=state.objects.filter(o=>!ids.has(o.id));state.sequence=state.sequence.filter(s=>!ids.has(s.objectId));
   state.selectedId=null;changed();renderObjects();renderConditions();draw();
 };
 $('addCondition').onclick=()=>{const o=selected();if(!o||o.kind==='mine')return;state.sequence.push({objectId:o.id,minMines:o.kind==='weak'?1:0});changed();renderConditions();draw();};
 function renderConditions(){
   const list=$('conditionList');list.replaceChildren();
   for(let i=0;i<state.sequence.length;i++){
     const step=state.sequence[i],o=state.objects.find(o=>o.id===step.objectId),row=document.createElement('li');
     const name=document.createElement('span');name.className='conditionName';name.textContent=`${i+1}. ${o?label(o):'対象なし'}${o?.avoid?' ⚠ 避ける設定':''}`;row.append(name);
     const input=document.createElement('input');input.type='number';input.min='0';input.max='4';input.step='1';input.value=step.minMines;
     input.setAttribute('aria-label',`条件${i+1}の必要地雷数`);input.onchange=()=>{step.minMines=Math.max(0,Math.min(4,Math.trunc(Number(input.value)||0)));input.value=step.minMines;changed();draw();};row.append(input);
     for(const [text,action,disabled] of [ ['↑',()=>{[state.sequence[i-1],state.sequence[i]]=[state.sequence[i],state.sequence[i-1]];},i===0],
       ['↓',()=>{[state.sequence[i+1],state.sequence[i]]=[state.sequence[i],state.sequence[i+1]];},i===state.sequence.length-1],['×',()=>state.sequence.splice(i,1),false]]){
       const button=document.createElement('button');button.type='button';button.className='stepButton';button.textContent=text;button.disabled=disabled;
       button.setAttribute('aria-label',`条件${i+1}を${text==='×'?'削除':text==='↑'?'上へ':'下へ'}`);
       button.onclick=()=>{action();changed();renderConditions();draw();};row.append(button);
     }
     list.append(row);
   }
   if(!state.sequence.length){const li=document.createElement('li');li.textContent='対象を選び「順番条件に追加」、または上の本ルートを設定。';list.append(li);}
 }
 $('bookPreset').onclick=()=>{
   const boss=state.objects.find(o=>o.role==='boss'),book=state.objects.find(o=>o.role==='book'),weak=state.objects.find(o=>o.kind==='weak'&&o.parentId===book?.id);
   if(!boss||!book||!weak){status('まず「ボス」と「本＋内部弱点」を画像上に置いてください。');return;}
   boss.avoid=false;book.avoid=false;
   state.sequence=[{objectId:boss.id,minMines:0},{objectId:book.id,minMines:2},{objectId:weak.id,minMines:1}];
   changed();renderObjects();renderConditions();draw();status('ボス → 地雷2個で本 → 内部弱点を設定しました。目玉などは「避ける」にできます。');
 };
 for(const id of ['initialMines','searchBounces','searchDistance','playerRadius','angleTolerance','startTolerance'])$(id).addEventListener('change',()=>{changed();draw();});

 function renderResults(){
   const list=$('routeResults');list.replaceChildren();
   for(const [i,route] of state.results.entries()){
     const button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed',String(state.selectedRoute===route));
     const title=document.createElement('span');title.textContent=`${i+1}. ${route.degrees.toFixed(4)}°`;
     const detail=document.createElement('small');detail.textContent=`${route.bounces}反射・距離${Math.round(route.distance)}px・方向#${route.index}`;title.append(detail);
     const tolerance=document.createElement('span');tolerance.textContent=`誤差検査 ${route.robustness.passed}/${route.robustness.total}`;
     button.append(title,tolerance);button.onclick=()=>applyRoute(route);list.append(button);
   }
 }
 function applyRoute(route){
   angleMode='1024';$('angleMode').value='1024';setShotAngle(-route.degrees*Math.PI/180);
   reflections=route.bounces;updateCount();updateAngleUI();
   state.selectedRoute=route;state.stamp=`${cursor.x},${cursor.y},${pullAngle},${reflections},${state.revision}`;
   window.plannerGuideDistance=Math.max(.001,route.distance);renderResults();draw();
 }
 $('cancelSearch').onclick=()=>stopSearch('検索を中止しました。');
 $('searchRoutes').onclick=async()=>{
   if(!ready())return;
   const s=scene(),opts=options(),error=core.validateScene(s,opts);if(error){status(error);return;}
   stopSearch();const token=state.searchToken;state.running=true;state.results=[];state.selectedRoute=null;window.plannerGuideDistance=undefined;
   $('searchRoutes').disabled=true;$('cancelSearch').disabled=false;renderResults();
   const initialStamp=`${cursor.x},${cursor.y},${state.revision}`;
   try{
     const generator=core.searchRoutes(s,opts);let progress;
     while(true){
       if(token!==state.searchToken)return;
       progress=generator.next();if(progress.done)break;
       const p=progress.value;status(p.phase==='angles'?`1024方向を探索中… ${p.done}/${p.total}`:`ずれへの強さを検査中… ${p.done}/${p.total}`);
       await new Promise(resolve=>setTimeout(resolve,0));
     }
     if(token!==state.searchToken)return;
     if(initialStamp!==`${cursor.x},${cursor.y},${state.revision}`){stopSearch('始点または配置が変わりました。もう一度検索してください。');return;}
     state.results=progress.value.routes;state.resultOrigin={...cursor};
     status(state.results.length?`成立する方向：${progress.value.validDirections}/1024。誤差検査の成立数を優先し、近い候補をまとめて表示。`:
       '条件を満たす方向がありません。始点・判定サイズ・地雷・順番条件・探索上限を確認してください。');
     renderResults();if(state.results.length)applyRoute(state.results[0]);
   }catch(error){status(`検索できませんでした：${error.message}`);}
   finally{if(token===state.searchToken){state.running=false;$('searchRoutes').disabled=false;$('cancelSearch').disabled=true;}}
 };

 window.plannerBeforeDraw=()=>{
   if(state.resultOrigin&&(state.resultOrigin.x!==cursor.x||state.resultOrigin.y!==cursor.y)){
     changed('始点が変わりました。もう一度検索してください。');
   }
   const stamp=`${cursor.x},${cursor.y},${pullAngle},${reflections},${state.revision}`;
   if(state.selectedRoute&&stamp!==state.stamp){state.selectedRoute=null;window.plannerGuideDistance=undefined;renderResults();}
 };
 function drawLog(){
   const signature=`${cursor.x},${cursor.y},${pullAngle},${reflections},${state.revision}`;
   if(state.lastLog===signature)return;state.lastLog=signature;
   const log=$('contactLog');log.replaceChildren();
   if(!state.objects.length){log.textContent='対象を配置すると接触順と地雷残数を表示します。';return;}
   const analysis=core.analyseRoute(scene(),currentDegrees(),{...options(),maxBounces:reflections});
   const rows=[];
   for(const e of analysis.events)rows.push({distance:e.distance,name:`${e.step?`✓ ${e.step}. `:''}${e.type==='mine'?'回収 ':''}${label(e.object)}`,mines:`地雷 ${e.minesBefore} → ${e.minesAfter}`,goal:!!e.step});
   for(const segment of analysis.trace.segments){
     const distance=segment.distance+segment.length;
     if(segment.walls.length&&distance<=analysis.distance+1e-7)rows.push({distance,name:`${segment.walls.map(w=>wallName[w]).join('・')}壁`,mines:''});
   }
   rows.sort((a,b)=>a.distance-b.distance);
   for(const row of rows){const div=document.createElement('div');if(row.goal)div.className='goalEvent';const name=document.createElement('span');name.textContent=row.name;
     const count=document.createElement('span');count.textContent=row.mines;div.append(name,count);log.append(div);}
   if(!analysis.success&&state.sequence.length){const p=document.createElement('p');p.textContent=`達成 ${analysis.stepsDone}/${state.sequence.length}：${analysis.reason}`;log.append(p);}
 }
 window.plannerAfterDraw=context=>{
   for(const o of state.objects){
     const color=o.avoid?'#ff6f79':colors[o.role||o.kind],s=imgW/706;
     context.save();context.strokeStyle=color;context.fillStyle=color+'22';context.lineWidth=(o.id===state.selectedId?4:2)*s;
     context.setLineDash(o.avoid?[7*s,4*s]:[]);context.beginPath();context.ellipse(o.x,o.y,o.rx,o.ry,0,0,Math.PI*2);context.fill();context.stroke();
     context.setLineDash([]);context.font=`bold ${15*s}px -apple-system,BlinkMacSystemFont,sans-serif`;
     context.textAlign='center';context.lineWidth=4*s;context.strokeStyle='#101822';context.strokeText(label(o),o.x,Math.max(18*s,o.y-o.ry-7*s));
     context.fillStyle=color;context.fillText(label(o),o.x,Math.max(18*s,o.y-o.ry-7*s));context.restore();
   }
   drawLog();
 };
 window.plannerImageChanged=()=>{
   state.objects=[];state.sequence=[];state.selectedId=null;changed();setTool('shot');renderObjects();renderConditions();
   $('playerRadius').value=Math.round(imgW*.015);status('画像を読み込みました。始点と対象を配置してください。');
 };
 renderObjects();renderConditions();updateAngleUI();
})();
