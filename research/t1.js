const {R,ev,fmt,sg}=require('./lib');
const FX=r=>!/XAU|XAG|WTI|Brent/.test(r.pair);
const tests={
 'current |s|>20':r=>Math.abs(r.score)>20?sg(r.score):0,
 'current strong |s|>50':r=>Math.abs(r.score)>50?sg(r.score):0,
 'band 20-35':r=>Math.abs(r.score)>20&&Math.abs(r.score)<=35?sg(r.score):0,
 'band 35-50':r=>Math.abs(r.score)>35&&Math.abs(r.score)<=50?sg(r.score):0,
 'FADE current |s|>20':r=>Math.abs(r.score)>20?-sg(r.score):0,
 'pos only |pos|>40':r=>Math.abs(r.pos)>40?sg(r.pos):0,
 'pos only |pos|>70':r=>Math.abs(r.pos)>70?sg(r.pos):0,
 'FADE pos |pos|>70':r=>Math.abs(r.pos)>70?-sg(r.pos):0,
 'mom |mom|>40':r=>Math.abs(r.mom)>40?sg(r.mom):0,
 'FADE mom |mom|>40':r=>Math.abs(r.mom)>40?-sg(r.mom):0,
 'FADE mom |mom|>60':r=>Math.abs(r.mom)>60?-sg(r.mom):0,
 'acc |acc|>20':r=>Math.abs(r.acc)>20?sg(r.acc):0,
 'FADE acc |acc|>20':r=>Math.abs(r.acc)>20?-sg(r.acc):0,
 'calls bull only':r=>r.score>20?1:0,
 'calls bear only':r=>r.score<-20?-1:0,
 'calls where mom disagrees':r=>Math.abs(r.score)>20&&sg(r.mom)!==sg(r.score)?sg(r.score):0,
 'calls where mom agrees':r=>Math.abs(r.score)>20&&sg(r.mom)===sg(r.score)?sg(r.score):0,
 'pos>40 & mom opposite':r=>Math.abs(r.pos)>40&&sg(r.mom)===-sg(r.pos)?sg(r.pos):0,
};
for(const h of ['r1','r2','r4']){console.log('=== '+h+(h==='r1'?'':' (non-overlapping weeks only)'));
 for(const k in tests)console.log(fmt(k,ev(tests[k],h,()=>true,h==='r1'?1:h==='r2'?2:4)));}
console.log('=== FX only r1');for(const k of ['current |s|>20','FADE mom |mom|>40','pos only |pos|>70'])console.log(fmt(k,ev(tests[k],'r1',FX)));
