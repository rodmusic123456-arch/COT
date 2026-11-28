// 2026-11-28: regime switch (trailing record), agree/disagree split, 4w acc fade update, news tilt update.
const {R,ev,fmt,sg,weeks}=require('./lib.js');
const FX=r=>!/XAU|XAG|WTI|Brent/.test(r.pair);
const cur=r=>Math.abs(r.score)>20?sg(r.score):0;
const fade=r=>FX(r)&&Math.abs(r.mom)>40?-sg(r.mom):0;
console.log('last week with r1:',[...new Set(R.map(r=>r.week))].sort().at(-1));
console.log(fmt('current 1w',ev(cur)));
console.log(fmt('fade 1w',ev(fade)));
console.log(fmt('fade 2w (non-overlap)',ev(fade,'r2',()=>true,2)));
console.log(fmt('current 2w (non-overlap)',ev(cur,'r2',()=>true,2)));
// agree / disagree
const agree=r=>{const a=cur(r),b=fade(r);return a&&b&&a===b?a:0;};
const dis_fade=r=>{const a=cur(r),b=fade(r);return a&&b&&a!==b?b:0;};
const fadeOnly=r=>{const a=cur(r),b=fade(r);return b&&!a?b:0;};
const curOnly=r=>{const a=cur(r),b=fade(r);return a&&!fade(r)&&FX(r)?a:0;};
console.log(fmt('BOTH AGREE 1w',ev(agree)));
console.log(fmt('BOTH AGREE 2w',ev(agree,'r2',()=>true,2)));
console.log(fmt('disagree: follow fade',ev(dis_fade)));
console.log(fmt('fade, no current call',ev(fadeOnly)));
console.log(fmt('current FX, no fade',ev(curOnly)));
// regime switch: per-week avg of each list; choose list with better trailing N-week avg, using weeks <= t-2
const wk={};for(const r of R){const w=wk[r.week]=wk[r.week]||{c:[],f:[],y:r.week.slice(0,4),rows:[]};const a=cur(r),b=fade(r);if(a)w.c.push(a*r.r1);if(b)w.f.push(b*r.r1);}
const ws=Object.keys(wk).sort();const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
for(const N of [2,4,6,8,13]){const res={};
 ws.forEach((w,i)=>{if(i<N+2)return;let sc=0,sf=0;for(let j=i-N-1;j<=i-2;j++){sc+=avg(wk[ws[j]].c);sf+=avg(wk[ws[j]].f);}
  const pick=sc>sf?'c':'f';const ds=wk[w][pick];if(!ds.length)return;const y=wk[w].y;
  for(const k of [y,'ALL',y<'2025'?'IS':'OOS']){const o=res[k]=res[k]||{n:0,h:0,m:0,wn:0,wh:0,wm:0};for(const d of ds){o.n++;o.m+=d;if(d>0)o.h++;}o.wn++;o.wm+=avg(ds);if(avg(ds)>0)o.wh++;}});
 console.log(`switch N=${N}`.padEnd(14)+Object.entries(res).map(([k,o])=>`${k}:${(100*o.h/o.n).toFixed(0)}%/${(o.m/o.n).toFixed(2)} wk${(100*o.wh/o.wn).toFixed(0)}%(${o.wn}) wkavg${(o.wm/o.wn).toFixed(2)}`).join(' '));}
// weekly-avg baseline for comparison
for(const k of ['c','f']){const res={};for(const w of ws){const ds=wk[w][k];if(!ds.length)continue;const y=wk[w].y;for(const kk of [y,'ALL',y<'2025'?'IS':'OOS']){const o=res[kk]=res[kk]||{wn:0,wh:0,wm:0};o.wn++;o.wm+=avg(ds);if(avg(ds)>0)o.wh++;}}
 console.log(`always ${k}`.padEnd(14)+Object.entries(res).map(([kk,o])=>`${kk}: wk${(100*o.wh/o.wn).toFixed(0)}%(${o.wn}) wkavg${(o.wm/o.wn).toFixed(2)}`).join(' '));}
// autocorrelation of weekly (fade - current) spread
const sp=ws.map(w=>avg(wk[w].f)-avg(wk[w].c));const corr=(a,b)=>{const ma=avg(a),mb=avg(b);let x=0,y=0,z=0;for(let i=0;i<a.length;i++){x+=(a[i]-ma)*(b[i]-mb);y+=(a[i]-ma)**2;z+=(b[i]-mb)**2;}return x/Math.sqrt(y*z);};
for(const L of [1,2,3,4])console.log('spread autocorr lag',L,corr(sp.slice(L),sp.slice(0,-L)).toFixed(3));
// 4w acc fade
console.log(fmt('4w fade acc>20 (non-overlap)',ev(r=>FX(r)&&Math.abs(r.acc)>20?-sg(r.acc):0,'r4',()=>true,4)));
for(const off of [1,2,3])console.log(fmt(` ..offset ${off}`,ev(r=>FX(r)&&Math.abs(r.acc)>20&&(weeks.indexOf(r.week)%4)===off?-sg(r.acc):0,'r4')));
// fade strength bands
for(const [lo,hi] of [[40,60],[60,80],[80,999]])console.log(fmt(`fade |mom| ${lo}-${hi}`,ev(r=>FX(r)&&Math.abs(r.mom)>lo&&Math.abs(r.mom)<=hi?-sg(r.mom):0)));
console.log(fmt('fade 2w offset 1',ev(r=>fade(r)&&(weeks.indexOf(r.week)%2)===1?fade(r):0,'r2')));
console.log(fmt('fade 1w ALL instruments',ev(r=>Math.abs(r.mom)>40?-sg(r.mom):0)));
