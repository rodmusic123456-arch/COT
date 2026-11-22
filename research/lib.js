const b=require('../docs/backtest.json');
const R=b.rows.filter(r=>r.r1!==''&&r.r1!=null).map(r=>({...r,r1:+r.r1,r2:r.r2===''?null:+r.r2,r4:r.r4===''?null:+r.r4,y:r.week.slice(0,4)}));
const weeks=[...new Set(R.map(r=>r.week))].sort();const wi={};weeks.forEach((w,i)=>wi[w]=i);
function ev(sig,h='r1',filt=()=>true,step=1){ // sig(row)-> +1/-1/0
 const out={};const add=(k,d)=>{const o=out[k]=out[k]||{n:0,h:0,m:0,W:{}};o.n++;o.m+=d;if(d>0)o.h++;}
 const wk={};
 for(const r of R){if(r[h]==null||!filt(r))continue;if(wi[r.week]%step)continue;const s=sig(r);if(!s)continue;const d=s*r[h];
  add(r.y,d);add('ALL',d);add(r.y<'2025'?'IS':'OOS',d);
  (wk[r.week]=wk[r.week]||[]).push(d);}
 for(const w in wk){const m=wk[w].reduce((a,b)=>a+b,0)/wk[w].length;for(const k of [w.slice(0,4),'ALL',w<'2025'?'IS':'OOS']){const o=out[k];o.wn=(o.wn||0)+1;if(m>0)o.wh=(o.wh||0)+1;}}
 return out;}
function fmt(name,o,keys=['2022','2023','2024','2025','2026','IS','OOS','ALL']){
 return name.padEnd(34)+keys.map(k=>{const x=o[k];if(!x)return k+': -';return `${k}:${(100*x.h/x.n).toFixed(0)}%/${(x.m/x.n>=0?'+':'')}${(x.m/x.n).toFixed(2)}(${x.n})`}).join(' ')+`  wk:${o.ALL?(100*o.ALL.wh/o.ALL.wn).toFixed(0)+'%/'+o.ALL.wn:''} wkOOS:${o.OOS?(100*o.OOS.wh/o.OOS.wn).toFixed(0)+'%/'+o.OOS.wn:''}`;}
const sg=x=>x>0?1:x<0?-1:0;
module.exports={R,ev,fmt,sg,weeks};
