const {R,ev,fmt,sg,weeks}=require('./lib');
const prev={};const key=(p,w)=>p+'|'+w;const wi={};weeks.forEach((w,i)=>wi[w]=i);
for(const r of R)prev[key(r.pair,weeks[wi[r.week]+1])]=r.r1; // r1 of week t-1 = move into week t
for(const r of R)r.p1=prev[key(r.pair,r.week)];
const has=r=>r.p1!=null;
// corr mom vs prior move
let n=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;for(const r of R){if(!has(r))continue;n++;sx+=r.mom;sy+=r.p1;sxx+=r.mom**2;syy+=r.p1**2;sxy+=r.mom*r.p1}
console.log('corr(mom, prior-week price move)',((n*sxy-sx*sy)/Math.sqrt((n*sxx-sx*sx)*(n*syy-sy*sy))).toFixed(3));
const T={
 'FADE mom>40':r=>Math.abs(r.mom)>40?-sg(r.mom):0,
 'FADE prior-week move':r=>has(r)&&Math.abs(r.p1)>0.5?-sg(r.p1):0,
 'FADE mom>40, prior move SAME dir as mom':r=>has(r)&&Math.abs(r.mom)>40&&sg(r.p1)===sg(r.mom)?-sg(r.mom):0,
 'FADE mom>40, prior move OPPOSITE':r=>has(r)&&Math.abs(r.mom)>40&&sg(r.p1)!==sg(r.mom)?-sg(r.mom):0,
 'FADE mom>40 & agrees w/ pos fade':r=>Math.abs(r.mom)>40&&sg(r.pos)===sg(r.mom)?-sg(r.mom):0,
 'FADE mom>40 bull-mom only':r=>r.mom>40?-1:0,
 'FADE mom>40 bear-mom only':r=>r.mom<-40?1:0,
 'current calls, skip if |mom|>40 same side':r=>Math.abs(r.score)>20&&!(Math.abs(r.mom)>40&&sg(r.mom)===sg(r.score))?sg(r.score):0,
};
for(const k in T)console.log(fmt(k,ev(T[k],'r1')));
// per currency for fade mom
const ccy=['EUR','GBP','AUD','NZD','USD','JPY','CHF','CAD','XAU','XAG','WTI','Brent'];
for(const c of ccy){const o=ev(r=>r.pair.includes(c)&&Math.abs(r.mom)>40?-sg(r.mom):0,'r1');const x=o.ALL;if(x)console.log(c.padEnd(6),(100*x.h/x.n).toFixed(0)+'%',(x.m/x.n).toFixed(2),x.n,'IS',(100*o.IS.h/o.IS.n).toFixed(0),'OOS',(100*o.OOS.h/o.OOS.n).toFixed(0))}
// news tilt in scorecard
const s=require('../docs/scorecard.json');const g={};
for(const w of s.weeks.filter(w=>w.status==='final'))for(const c of w.calls){const t=c[9];if(t==null||t==='')continue;const k=t*c[2]>0?'agree':t*c[2]<0?'disagree':'zero';const d=c[5]*c[2];g[k]=g[k]||{n:0,h:0,m:0,w:new Set()};g[k].n++;g[k].m+=d;if(d>0)g[k].h++;g[k].w.add(w.week)}
for(const k in g)console.log('news',k,g[k].n,(100*g[k].h/g[k].n).toFixed(1)+'%',(g[k].m/g[k].n).toFixed(3),'weeks',g[k].w.size);
