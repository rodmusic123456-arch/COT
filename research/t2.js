const {R,ev,fmt,sg}=require('./lib');
const res=[];
for(let a=-1;a<=1.001;a+=0.1)for(let b=-1;b<=1.001;b+=0.1){const c=1-Math.abs(a)-Math.abs(b);if(c<-1e-9)continue;
 for(const cs of [1,-1]){const cc=cs*c;if(cs<0&&c<1e-9)continue;
 const f=r=>{const s=a*r.pos+b*r.mom+cc*r.acc;return Math.abs(s)>20?sg(s):0};
 const o=ev(f,'r1');const o2=ev(f,'r2',()=>true,2);
 if(!o.IS||o.IS.n<300)continue;
 res.push({a:+a.toFixed(1),b:+b.toFixed(1),c:+cc.toFixed(1),f,IS:o.IS.m/o.IS.n,ISh:o.IS.h/o.IS.n,OOS:o.OOS.m/o.OOS.n,OOSh:o.OOS.h/o.OOS.n,n:o.ALL.n,IS2:o2.IS.m/o2.IS.n,o});}}
res.sort((x,y)=>y.IS-x.IS);
console.log('top 12 by IS 1w avg move (weights pos/mom/acc)');
for(const r of res.slice(0,12))console.log(`${r.a}/${r.b}/${r.c} IS ${(100*r.ISh).toFixed(1)}% ${r.IS.toFixed(3)} | OOS ${(100*r.OOSh).toFixed(1)}% ${r.OOS.toFixed(3)} n=${r.n} IS2w ${r.IS2.toFixed(3)}`);
const cur=res.find(r=>r.a==0.5&&r.b==0.3&&r.c==0.2);console.log('current',cur&&`IS ${(100*cur.ISh).toFixed(1)} ${cur.IS.toFixed(3)} OOS ${(100*cur.OOSh).toFixed(1)} ${cur.OOS.toFixed(3)}`);
// rank correlation IS vs OOS
console.log('pick:');const p=res[0];console.log(fmt(`${p.a}/${p.b}/${p.c}`,p.o));
// simple candidates
const C={'0.5/-0.3/0.2 (flip mom)':[0.5,-0.3,0.2],'0.7/0/0.3 (drop mom)':[0.7,0,0.3],'0.5/0/0.2 raw':[0.5,0,0.2],'0.4/-0.4/0.2':[0.4,-0.4,0.2],'0/-0.6/0.4':[0,-0.6,0.4],'0/-1/0':[0,-1,0]};
for(const k in C){const [a,b,c]=C[k];for(const h of ['r1','r2']){const f=r=>{const s=a*r.pos+b*r.mom+c*r.acc;return Math.abs(s)>20?sg(s):0};console.log(fmt(k+' '+h,ev(f,h,()=>true,h=='r1'?1:2)))}}
