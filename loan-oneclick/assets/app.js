const fa=n=>new Intl.NumberFormat('fa-IR').format(Math.round(n));
const cards=[...document.querySelectorAll('.loan-card')],grid=document.querySelector('#loanGrid');
const max=Math.max(0,...cards.map(c=>+c.dataset.amount));document.querySelector('#maxAmount').textContent=fa(max)+' تومان';
function filter(){const q=document.querySelector('#search').value.trim().toLowerCase(),sort=document.querySelector('#sort').value;let visible=cards.filter(c=>c.dataset.title.toLowerCase().includes(q));cards.forEach(c=>c.hidden=!visible.includes(c));visible.sort((a,b)=>sort==='amount'?b.dataset.amount-a.dataset.amount:sort==='rate'?a.dataset.rate-b.dataset.rate:sort==='months'?b.dataset.months-a.dataset.months:b.dataset.featured-a.dataset.featured).forEach(c=>grid.appendChild(c));document.querySelector('#empty').hidden=visible.length>0}
document.querySelector('#search').addEventListener('input',filter);document.querySelector('#sort').addEventListener('change',filter);
const principal=document.querySelector('#principal'),rate=document.querySelector('#rate'),months=document.querySelector('#months');
function calc(){const p=+principal.value,r=(+rate.value/100)/12,n=+months.value;let pay=r===0?p/n:p*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1);if(!isFinite(pay)||pay<0)pay=0;document.querySelector('#payment').textContent=fa(pay)+' تومان';document.querySelector('#total').textContent='مجموع بازپرداخت: '+fa(pay*n)+' تومان'}
[principal,rate,months].forEach(i=>i.addEventListener('input',calc));calc();
document.querySelectorAll('.calc-loan').forEach(b=>b.addEventListener('click',()=>{principal.value=b.dataset.amount;rate.value=b.dataset.rate;months.value=b.dataset.months;calc();document.querySelector('#calculator').scrollIntoView()}));
