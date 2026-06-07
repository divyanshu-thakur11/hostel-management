import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState, useMemo } from 'react';
import { membersAPI, receiptsAPI, electricAPI, salaryAPI, backupAPI } from '../utils/api';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

/* ── Constants ─────────────────────────────────────────────────────────────── */
const C = {
  gold:   '#f0a500', green:  '#2ecc71', blue:   '#3498db',
  purple: '#9b59b6', red:    '#e74c3c', teal:   '#1abc9c',
  orange: '#e67e22', pink:   '#e91e8c',
};
const PIE_COLORS = Object.values(C);
const fmt  = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtK = (v) => v >= 100000 ? `₹${(v/100000).toFixed(1)}L` : v >= 1000 ? `₹${Math.round(v/1000)}k` : `₹${v}`;

/* ── Reusable tooltip ──────────────────────────────────────────────────────── */
const CT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:10,padding:'10px 14px',fontSize:'0.8rem',boxShadow:'0 8px 24px rgba(0,0,0,0.4)',minWidth:140}}>
      {label && <div style={{color:'var(--text3)',marginBottom:8,fontSize:'0.72rem',textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</div>}
      {payload.map((p,i) => (
        <div key={i} style={{display:'flex',justifyContent:'space-between',gap:16,color:p.color||'var(--text2)',padding:'2px 0'}}>
          <span>{p.name}</span>
          <span style={{fontWeight:700,fontFamily:'Rajdhani'}}>
            {typeof p.value === 'number' && p.name?.toLowerCase().includes('rate') ? `${p.value}%` : typeof p.value === 'number' ? `₹${fmt(p.value)}` : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

/* ── Insight badge ─────────────────────────────────────────────────────────── */
const Insight = ({ icon, text, color = C.gold }) => (
  <div style={{display:'flex',alignItems:'flex-start',gap:8,padding:'8px 12px',background:`${color}11`,border:`1px solid ${color}33`,borderRadius:8,fontSize:'0.78rem',color:'var(--text2)'}}>
    <span style={{fontSize:'1rem',flexShrink:0}}>{icon}</span>
    <span dangerouslySetInnerHTML={{__html:text}} />
  </div>
);

/* ── Section header ────────────────────────────────────────────────────────── */
const SH = ({ title, sub }) => (
  <div style={{marginBottom:12}}>
    <div style={{fontFamily:'Rajdhani',fontSize:'0.95rem',fontWeight:700,color:'var(--text)',textTransform:'uppercase',letterSpacing:'0.06em'}}>{title}</div>
    {sub && <div style={{fontSize:'0.72rem',color:'var(--text3)',marginTop:2}}>{sub}</div>}
  </div>
);

/* ── Tax Summary — proper component so useState hooks work correctly ─────── */
function TaxSummary({ receipts, salary }) {
  const toFY = (date) => {
    const d = new Date(date); const m = d.getMonth(); const y = d.getFullYear();
    return m >= 3 ? `${y}-${y+1}` : `${y-1}-${y}`;
  };
  const taxYears = [...new Set(receipts.map(r => toFY(r.receiptDate)))].sort().reverse();
  const [selYear, setSelYear] = useState(taxYears[0] || '');
  const [fromY, toY] = selYear ? selYear.split('-').map(Number) : [0, 0];

  const yearReceipts = receipts.filter(r => toFY(r.receiptDate) === selYear);
  const yearSalary   = salary.filter(s => toFY(s.salaryDate || s.createdAt) === selYear);

  const rentIncome    = yearReceipts.filter(r=>r.packageName==='rent').reduce((s,r)=>s+(r.amountPaid||r.totalAmount||0),0);
  const electricIncome= yearReceipts.filter(r=>r.packageName==='electric').reduce((s,r)=>s+(r.amountPaid||r.totalAmount||0),0);
  const advanceIncome = yearReceipts.filter(r=>r.packageName==='advance').reduce((s,r)=>s+(r.amountPaid||r.totalAmount||0),0);
  const finalIncome   = yearReceipts.filter(r=>r.packageName==='final').reduce((s,r)=>s+(r.amountPaid||r.totalAmount||0),0);
  const otherIncome   = yearReceipts.filter(r=>!['rent','electric','advance','final'].includes(r.packageName)).reduce((s,r)=>s+(r.amountPaid||r.totalAmount||0),0);
  const grossIncome   = rentIncome + electricIncome + advanceIncome + finalIncome + otherIncome;
  const salaryExp     = yearSalary.reduce((s,r)=>s+(r.netSalary||0),0);
  const maintExp      = yearSalary.reduce((s,r)=>s+(r.maintenanceCosts||[]).reduce((a,c)=>a+(c.amount||0),0),0);
  const totalExpenses = salaryExp + maintExp;
  const netProfit     = grossIncome - totalExpenses;

  const printTax = () => {
    const w = window.open('','_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>Tax Summary ${selYear}</title>
      <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;padding:32px;color:#111;font-size:13px;}
      h1{font-size:1.4rem;margin-bottom:4px;}p{color:#666;margin-bottom:20px;}
      table{width:100%;border-collapse:collapse;margin-bottom:20px;}
      th{background:#f5f5f5;padding:9px 12px;text-align:left;border-bottom:2px solid #ccc;font-size:11px;text-transform:uppercase;}
      td{padding:9px 12px;border-bottom:1px solid #eee;}
      .total{font-weight:700;background:#fffbe6;}.net{font-weight:700;font-size:1.1rem;}
      .right{text-align:right;}@media print{@page{margin:12mm;}}</style>
      </head><body>
      <h1>Income &amp; Expenditure Statement</h1>
      <p>Financial Year: April ${fromY} – March ${toY} &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString('en-IN')}</p>
      <table><thead><tr><th>Income Head</th><th class="right">Amount (₹)</th></tr></thead><tbody>
        <tr><td>Rent Collected</td><td class="right">₹${rentIncome.toLocaleString('en-IN')}</td></tr>
        <tr><td>Electric Bill Collected</td><td class="right">₹${electricIncome.toLocaleString('en-IN')}</td></tr>
        <tr><td>Advance Received</td><td class="right">₹${advanceIncome.toLocaleString('en-IN')}</td></tr>
        <tr><td>Final Bills Collected</td><td class="right">₹${finalIncome.toLocaleString('en-IN')}</td></tr>
        <tr><td>Other Income</td><td class="right">₹${otherIncome.toLocaleString('en-IN')}</td></tr>
        <tr class="total"><td>Total Gross Income</td><td class="right">₹${grossIncome.toLocaleString('en-IN')}</td></tr>
      </tbody></table>
      <table><thead><tr><th>Expenditure Head</th><th class="right">Amount (₹)</th></tr></thead><tbody>
        <tr><td>Staff Salary</td><td class="right">₹${salaryExp.toLocaleString('en-IN')}</td></tr>
        <tr><td>Maintenance &amp; Repairs</td><td class="right">₹${maintExp.toLocaleString('en-IN')}</td></tr>
        <tr class="total"><td>Total Expenditure</td><td class="right">₹${totalExpenses.toLocaleString('en-IN')}</td></tr>
      </tbody></table>
      <table><tbody>
        <tr class="net"><td>Net Profit / Loss</td><td class="right">₹${netProfit.toLocaleString('en-IN')}${netProfit<0?' (Loss)':' (Profit)'}</td></tr>
      </tbody></table>
      <p style="margin-top:40px;font-size:11px;color:#aaa">System-generated summary. Verify with your CA before filing returns.</p>
      </body></html>`);
    w.document.close(); setTimeout(()=>w.print(),400);
  };

  if (taxYears.length === 0) return (
    <div className="card"><div className="empty-state"><div className="empty-icon">🧾</div><p>No receipt data yet to generate tax summary</p></div></div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div className="card">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:18}}>
          <div>
            <div style={{fontFamily:'Rajdhani',fontWeight:700,fontSize:'1.05rem',color:'var(--text)'}}>🧾 Income Tax Summary</div>
            <div style={{fontSize:'0.75rem',color:'var(--text3)',marginTop:2}}>Financial year-wise income & expenditure. Hand this to your CA for ITR filing.</div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <select value={selYear} onChange={e=>setSelYear(e.target.value)}
              style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 12px',color:'var(--text)',fontSize:'0.85rem',outline:'none'}}>
              {taxYears.map(y=><option key={y} value={y}>FY {y}</option>)}
            </select>
            <button className="btn btn-secondary" onClick={printTax}>🖨 Print / PDF</button>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:18}}>
          <div style={{background:'rgba(46,204,113,0.04)',border:'1px solid rgba(46,204,113,0.2)',borderRadius:8,padding:'14px 16px'}}>
            <div style={{fontFamily:'Rajdhani',fontWeight:700,color:'var(--success)',marginBottom:12,fontSize:'0.9rem',textTransform:'uppercase',letterSpacing:'0.05em'}}>📥 Income</div>
            {[
              {label:'Rent Collected',     value:rentIncome},
              {label:'Electric Collected', value:electricIncome},
              {label:'Advance Received',   value:advanceIncome},
              {label:'Final Bills',        value:finalIncome},
              {label:'Other Income',       value:otherIncome},
            ].map((row,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px dashed var(--border)',fontSize:'0.85rem'}}>
                <span style={{color:'var(--text2)'}}>{row.label}</span>
                <span style={{fontWeight:600}}>₹{row.value.toLocaleString('en-IN')}</span>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0 0',fontSize:'1rem',fontFamily:'Rajdhani',fontWeight:700,color:'var(--success)'}}>
              <span>Gross Income</span><span>₹{grossIncome.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div style={{background:'rgba(231,76,60,0.04)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:8,padding:'14px 16px'}}>
            <div style={{fontFamily:'Rajdhani',fontWeight:700,color:'var(--danger)',marginBottom:12,fontSize:'0.9rem',textTransform:'uppercase',letterSpacing:'0.05em'}}>📤 Expenditure</div>
            {[
              {label:'Staff Salary',         value:salaryExp},
              {label:'Maintenance & Repairs',value:maintExp},
            ].map((row,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px dashed var(--border)',fontSize:'0.85rem'}}>
                <span style={{color:'var(--text2)'}}>{row.label}</span>
                <span style={{fontWeight:600}}>₹{row.value.toLocaleString('en-IN')}</span>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0 0',fontSize:'1rem',fontFamily:'Rajdhani',fontWeight:700,color:'var(--danger)'}}>
              <span>Total Expenses</span><span>₹{totalExpenses.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        <div style={{padding:'18px 20px',background:netProfit>=0?'rgba(46,204,113,0.08)':'rgba(231,76,60,0.08)',border:`2px solid ${netProfit>=0?'rgba(46,204,113,0.3)':'rgba(231,76,60,0.3)'}`,borderRadius:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontFamily:'Rajdhani',fontWeight:700,fontSize:'1rem',color:'var(--text)'}}>{netProfit>=0?'Net Profit':'Net Loss'} — FY {selYear}</div>
            <div style={{fontSize:'0.75rem',color:'var(--text3)',marginTop:2}}>Gross Income − Total Expenses</div>
          </div>
          <div style={{fontFamily:'Rajdhani',fontWeight:800,fontSize:'2rem',color:netProfit>=0?'var(--success)':'var(--danger)'}}>
            ₹{Math.abs(netProfit).toLocaleString('en-IN')}
          </div>
        </div>

        <div style={{marginTop:14,padding:'10px 14px',background:'var(--bg3)',borderRadius:6,fontSize:'0.75rem',color:'var(--text3)'}}>
          ⚠️ Advance deposits excluded (refundable). For reference only — verify with your CA before ITR filing.
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN REPORTS COMPONENT
══════════════════════════════════════════════════════════════════════════════ */
export default function Reports() {
  const { hostelSwitchCount } = useHostel();
  const [members,  setMembers]  = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [electric, setElectric] = useState([]);
  const [salary,   setSalary]   = useState([]);
  const [tab,      setTab]      = useState('overview');
  const [filters,  setFilters]  = useState({ room:'', mode:'', type:'', search:'', from:'', to:'', partPay:'' });
  const [loading,  setLoading]  = useState(true);
  const [exporting,setExporting]= useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      membersAPI.getAll({ limit: 1000 }),
      receiptsAPI.getAll({ limit: 2000 }),
      electricAPI.getAll(),
      salaryAPI.getAll(),
    ]).then(([m,r,e,s]) => {
      setMembers(m.data?.data  || m.data || []);
      setReceipts(r.data?.data || r.data || []);
      setElectric(e.data?.data || e.data || []);
      setSalary(s.data?.data   || s.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [hostelSwitchCount]);

  /* ── Base numbers ── */
  const activeMembers  = members.filter(m => m.isActive !== false && m.roomNumber);
  const totalIncome    = receipts.reduce((s,r) => s + (r.amountPaid || r.totalAmount || 0), 0);
  const cashTotal      = receipts.filter(r=>r.modeOfPayment==='cash').reduce((s,r)=>s+(r.amountPaid||r.totalAmount||0),0);
  const onlineTotal    = receipts.filter(r=>r.modeOfPayment==='online').reduce((s,r)=>s+(r.amountPaid||r.totalAmount||0),0);
  const totalSalary    = salary.reduce((s,r)=>s+(r.netSalary||0),0);
  const totalMaint     = salary.reduce((s,r)=>s+(r.maintenanceCosts||[]).reduce((a,c)=>a+(c.amount||0),0),0);
  const totalExpend    = totalSalary + totalMaint;
  const netBalance     = totalIncome - totalExpend;
  const totalDues      = receipts.filter(r=>r.isPartPayment&&(r.balanceDue||0)>0).reduce((s,r)=>s+(r.balanceDue||0),0);
  const maxRooms       = Math.max(...members.filter(m=>m.roomNumber).map(m=>m.roomNumber), 20);

  /* ── Monthly data (12 months) ── */
  const monthlyData = useMemo(() => {
    const map = {};
    receipts.forEach(r => {
      const d   = new Date(r.receiptDate);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const lbl = d.toLocaleString('en-IN', { month:'short', year:'2-digit' });
      if (!map[key]) map[key] = { key, label:lbl, income:0, rent:0, electric:0, advance:0, other:0, count:0, cash:0, online:0 };
      const amt  = r.amountPaid || r.totalAmount || 0;
      const type = r.packageName || r.paymentType || 'other';
      map[key].income += amt;
      if (type === 'rent')          map[key].rent     += amt;
      else if (type === 'electric') map[key].electric += amt;
      else if (type === 'advance')  map[key].advance  += amt;
      else                          map[key].other    += amt;
      map[key].count += 1;
      if (r.modeOfPayment === 'cash')   map[key].cash   += amt;
      if (r.modeOfPayment === 'online') map[key].online += amt;
    });
    return Object.values(map).sort((a,b)=>a.key.localeCompare(b.key)).slice(-12);
  }, [receipts]);

  /* ── Room revenue ranking ── */
  const roomRevenue = useMemo(() => {
    const map = {};
    receipts.forEach(r => {
      if (!r.roomNumber) return;
      if (!map[r.roomNumber]) map[r.roomNumber] = { room: r.roomNumber, total:0, rent:0, electric:0, count:0 };
      const amt  = r.amountPaid || r.totalAmount || 0;
      const type = r.packageName || r.paymentType || 'other';
      map[r.roomNumber].total += amt;
      if (type === 'rent')          map[r.roomNumber].rent     += amt;
      else if (type === 'electric') map[r.roomNumber].electric += amt;
      map[r.roomNumber].count += 1;
    });
    return Object.values(map).sort((a,b)=>b.total-a.total).slice(0,10).map(r=>({...r,label:`R${r.room}`}));
  }, [receipts]);

  /* ── Day-of-week payment pattern ── */
  const dowData = useMemo(() => {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const map  = Object.fromEntries(days.map(d=>[d,{day:d,count:0,amount:0}]));
    receipts.forEach(r => {
      const d = days[new Date(r.receiptDate).getDay()];
      map[d].count  += 1;
      map[d].amount += r.amountPaid || r.totalAmount || 0;
    });
    return days.map(d=>map[d]);
  }, [receipts]);

  /* ── Monthly collection rate (% members who paid that month) ── */
  const collectionRate = useMemo(() => {
    return monthlyData.map(m => {
      const paidRooms = new Set(receipts.filter(r => {
        const d = new Date(r.receiptDate);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === m.key;
      }).map(r => r.roomNumber)).size;
      const totalRooms = activeMembers.length > 0 ? Math.max(1, new Set(activeMembers.map(m=>m.roomNumber)).size) : 1;
      return { ...m, rate: Math.min(100, Math.round((paidRooms / totalRooms) * 100)) };
    });
  }, [monthlyData, receipts, activeMembers]);

  /* ── Electric consumption per room ── */
  const elecByRoom = useMemo(() => {
    const map = {};
    electric.forEach(e => {
      if (!map[e.roomNumber]) map[e.roomNumber] = { room:e.roomNumber, units:0, amount:0, readings:0 };
      map[e.roomNumber].units    += (e.endReading - e.startReading) || e.unitsConsumed || 0;
      map[e.roomNumber].amount   += e.totalAmount || 0;
      map[e.roomNumber].readings += 1;
    });
    return Object.values(map).sort((a,b)=>b.units-a.units).slice(0,10).map(r=>({...r,label:`R${r.room}`}));
  }, [electric]);

  /* ── Tenure distribution (how long members stay) ── */
  const tenureData = useMemo(() => {
    const buckets = {'<1 mo':0,'1-3 mo':0,'3-6 mo':0,'6-12 mo':0,'>1 yr':0};
    members.forEach(m => {
      const join  = m.roomJoinDate ? new Date(m.roomJoinDate) : null;
      const leave = m.roomLeavingDate ? new Date(m.roomLeavingDate) : new Date();
      if (!join) return;
      const months = (leave - join) / (1000*60*60*24*30);
      if      (months < 1)  buckets['<1 mo']++;
      else if (months < 3)  buckets['1-3 mo']++;
      else if (months < 6)  buckets['3-6 mo']++;
      else if (months < 12) buckets['6-12 mo']++;
      else                  buckets['>1 yr']++;
    });
    return Object.entries(buckets).map(([name,value])=>({name,value})).filter(x=>x.value>0);
  }, [members]);

  /* ── Income vs Expenditure with net ── */
  const incomeVsExpend = useMemo(() => {
    return monthlyData.map(m => {
      const salaryForMonth = salary.filter(s => {
        const d = new Date(s.salaryDate || s.createdAt);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` === m.key;
      }).reduce((sum,s) => sum + (s.netSalary||0) + (s.maintenanceCosts||[]).reduce((a,c)=>a+(c.amount||0),0), 0);
      return { ...m, expend: salaryForMonth, net: m.income - salaryForMonth };
    });
  }, [monthlyData, salary]);

  /* ── Payment mode trend ── */
  const modeTrend = useMemo(() => monthlyData.map(m => ({
    label: m.label,
    cashPct:   m.income > 0 ? Math.round(m.cash/m.income*100)   : 0,
    onlinePct: m.income > 0 ? Math.round(m.online/m.income*100) : 0,
  })), [monthlyData]);

  /* ── Insights engine ── */
  const insights = useMemo(() => {
    const ins = [];
    if (monthlyData.length >= 2) {
      const last  = monthlyData[monthlyData.length-1];
      const prev  = monthlyData[monthlyData.length-2];
      const delta = last.income - prev.income;
      const pct   = prev.income > 0 ? Math.round(Math.abs(delta)/prev.income*100) : 0;
      if (delta > 0) ins.push({ icon:'📈', text:`Revenue <strong>up ${pct}%</strong> this month (₹${fmt(delta)} more than last month)`, color:C.green });
      if (delta < 0) ins.push({ icon:'📉', text:`Revenue <strong>down ${pct}%</strong> this month (₹${fmt(Math.abs(delta))} less than last month)`, color:C.red });
    }
    // Best month
    if (monthlyData.length > 0) {
      const best = [...monthlyData].sort((a,b)=>b.income-a.income)[0];
      ins.push({ icon:'🏆', text:`Best month: <strong>${best.label}</strong> with ₹${fmt(best.income)} income`, color:C.gold });
    }
    // Online adoption
    if (totalIncome > 0) {
      const onlinePct = Math.round(onlineTotal/totalIncome*100);
      if (onlinePct >= 60) ins.push({ icon:'📱', text:`<strong>${onlinePct}%</strong> payments are online — excellent digital adoption`, color:C.teal });
      else if (onlinePct <= 30) ins.push({ icon:'💵', text:`Only <strong>${onlinePct}%</strong> online payments — consider encouraging UPI/online`, color:C.orange });
    }
    // Dues warning
    if (totalDues > 0) {
      ins.push({ icon:'⚠️', text:`₹${fmt(totalDues)} in <strong>pending dues</strong> from part payments — follow up needed`, color:C.red });
    }
    // Police verification gap
    const unverified = members.filter(m=>m.isActive!==false&&!m.policeFormVerified).length;
    if (unverified > 0) ins.push({ icon:'🚔', text:`<strong>${unverified} member${unverified>1?'s':''}</strong> without police verification — compliance risk`, color:C.orange });
    // Top paying day
    if (dowData.length > 0) {
      const topDay = [...dowData].sort((a,b)=>b.amount-a.amount)[0];
      if (topDay.count > 0) ins.push({ icon:'📅', text:`Most payments happen on <strong>${topDay.day}</strong> — schedule follow-ups accordingly`, color:C.blue });
    }
    // Low occupancy months
    const lowMonths = collectionRate.filter(m=>m.rate < 60 && m.count > 0);
    if (lowMonths.length > 0) ins.push({ icon:'🔍', text:`Low collection rate in <strong>${lowMonths.map(m=>m.label).join(', ')}</strong> — may indicate payment delays`, color:C.purple });
    // High electric rooms
    if (elecByRoom.length > 0) {
      const highElec = elecByRoom[0];
      ins.push({ icon:'⚡', text:`Room <strong>${highElec.room}</strong> is highest electricity consumer (${highElec.units} units) — check for excess usage`, color:C.orange });
    }
    // Long tenure members
    const longStay = members.filter(m => {
      if (!m.roomJoinDate || m.isActive===false) return false;
      return (new Date() - new Date(m.roomJoinDate)) > 365*24*60*60*1000;
    });
    if (longStay.length > 0) ins.push({ icon:'🌟', text:`<strong>${longStay.length} loyal member${longStay.length>1?'s':''}</strong> staying 1+ year — consider loyalty benefit`, color:C.green });
    // Net margin
    if (totalIncome > 0 && totalExpend > 0) {
      const margin = Math.round((netBalance/totalIncome)*100);
      ins.push({ icon:'💹', text:`Net margin: <strong>${margin}%</strong> (₹${fmt(netBalance)} of ₹${fmt(totalIncome)} income kept after expenses)`, color: margin>=60?C.green:margin>=30?C.gold:C.red });
    }
    return ins;
  }, [monthlyData, totalIncome, onlineTotal, totalDues, members, dowData, collectionRate, elecByRoom, netBalance, totalExpend]);

  /* ── Filtered receipts (payments tab) ── */
  const filteredReceipts = useMemo(() => receipts.filter(r =>
    (!filters.room   || String(r.roomNumber)===filters.room) &&
    (!filters.mode   || r.modeOfPayment===filters.mode) &&
    (!filters.type   || r.packageName===filters.type) &&
    (!filters.partPay || (filters.partPay==='yes' ? r.isPartPayment : !r.isPartPayment)) &&
    (!filters.search || (r.memberName||'').toLowerCase().includes(filters.search.toLowerCase()) ||
      String(r.roomNumber).includes(filters.search) || (r.billNumber||'').includes(filters.search)) &&
    (!filters.from || new Date(r.receiptDate) >= new Date(filters.from)) &&
    (!filters.to   || new Date(r.receiptDate) <= new Date(filters.to))
  ), [receipts, filters]);

  /* ── Export helpers ── */
  const downloadBlob = (data, filename, type) => {
    const url = window.URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
    window.URL.revokeObjectURL(url);
  };
  const exportCSV = async (col) => {
    setExporting(col);
    try { const r = await backupAPI.exportCSV(col); downloadBlob(r.data,`${col}-${new Date().toISOString().split('T')[0]}.csv`,'text/csv'); }
    catch { alert('Export failed'); } finally { setExporting(''); }
  };
  const exportJSON = async () => {
    setExporting('json');
    try { const r = await backupAPI.exportJSON(); downloadBlob(r.data,`hostel-backup-${new Date().toISOString().split('T')[0]}.json`,'application/json'); }
    catch { alert('Backup failed'); } finally { setExporting(''); }
  };
  const exportFilteredCSV = () => {
    const hdrs = ['Date','Bill No','Room','Member','Type','Mode','Total','Paid','Due'];
    const rows = filteredReceipts.map(r => [
      new Date(r.receiptDate).toLocaleDateString('en-IN'), r.billNumber||'', r.roomNumber,
      (r.memberName||'').replace(/,/g,';'), r.packageName, r.modeOfPayment,
      r.totalAmount||0, r.amountPaid||r.totalAmount||0, r.balanceDue||0,
    ]);
    downloadBlob([hdrs.join(','), ...rows.map(r=>r.join(','))].join('\n'),
      `receipts-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
  };

  const selStyle = { background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:6, padding:'7px 10px', color:'var(--text)', outline:'none', fontSize:'0.82rem' };
  const StatCard = ({ label, value, color='var(--accent)', sub, icon }) => (
    <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:10, padding:'16px 18px', display:'flex', alignItems:'center', gap:12 }}>
      {icon && <span style={{fontSize:'1.6rem',opacity:0.8}}>{icon}</span>}
      <div style={{flex:1,minWidth:0}}>
        <div style={{ fontSize:'0.68rem', color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{label}</div>
        <div style={{ fontFamily:'Rajdhani', fontSize:'1.45rem', fontWeight:700, color, lineHeight:1 }}>{value}</div>
        {sub && <div style={{ fontSize:'0.7rem', color:'var(--text3)', marginTop:3 }}>{sub}</div>}
      </div>
    </div>
  );

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:300,flexDirection:'column',gap:12}}>
      <div style={{width:36,height:36,border:'3px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{color:'var(--text3)',fontSize:'0.85rem'}}>Loading analytics...</span>
    </div>
  );

  const TABS = [
    { id:'overview',  label:'📊 Overview'  },
    { id:'trends',    label:'📈 Trends'    },
    { id:'insights',  label:'🔍 Insights'  },
    { id:'rooms',     label:'🏠 Rooms'     },
    { id:'payments',  label:'🧾 Payments'  },
    { id:'members',   label:'👥 Members'   },
    { id:'register',  label:'📋 Rent Register' },
    { id:'tax',       label:'🧾 Tax Summary' },
    { id:'export',    label:'💾 Export'    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Reports & Analytics</h2>
          <p>{receipts.length} receipts · {activeMembers.length} active members · ₹{fmtK(totalIncome)} total income</p>
        </div>
        <button className="btn btn-secondary" onClick={exportJSON} disabled={!!exporting}>
          {exporting==='json' ? '⏳' : '💾'} Full Backup
        </button>
      </div>

      <div className="tabs" style={{marginBottom:20}}>
        {TABS.map(t => (
          <button key={t.id} className={`tab ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════
          OVERVIEW TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <div style={{display:'flex',flexDirection:'column',gap:16}}>

          {/* KPI Cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(165px,1fr))',gap:12}}>
            <StatCard icon="💰" label="Total Income"      value={`₹${fmtK(totalIncome)}`}    color={C.green} sub={`${receipts.length} receipts`} />
            <StatCard icon="📤" label="Total Expenditure" value={`₹${fmtK(totalExpend)}`}    color={C.red}   sub="Salary + Maintenance" />
            <StatCard icon="💹" label="Net Balance"       value={`₹${fmtK(netBalance)}`}     color={netBalance>=0?C.green:C.red} sub={totalIncome>0?`${Math.round(netBalance/totalIncome*100)}% margin`:''} />
            <StatCard icon="👥" label="Active Members"    value={activeMembers.length}        color={C.blue}  sub={`of ${members.length} total`} />
            <StatCard icon="💵" label="Cash Collected"    value={`₹${fmtK(cashTotal)}`}      sub={totalIncome>0?`${Math.round(cashTotal/totalIncome*100)}% of income`:''} />
            <StatCard icon="📱" label="Online Collected"  value={`₹${fmtK(onlineTotal)}`}    color={C.teal}  sub={totalIncome>0?`${Math.round(onlineTotal/totalIncome*100)}% of income`:''} />
            <StatCard icon="⚠️" label="Pending Dues"      value={`₹${fmtK(totalDues)}`}      color={totalDues>0?C.red:'var(--text3)'} sub="Part payment balances" />
            <StatCard icon="🚔" label="Police Unverified" value={members.filter(m=>m.isActive!==false&&!m.policeFormVerified).length} color={C.orange} sub="Compliance gap" />
          </div>

          {/* Income vs Expenditure Composed Chart */}
          {incomeVsExpend.length > 0 && (
            <div className="card">
              <SH title="Income vs Expenditure vs Net" sub="Monthly comparison — green area = profit zone" />
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={incomeVsExpend} margin={{top:4,right:8,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={fmtK} />
                  <Tooltip content={<CT />} />
                  <Legend wrapperStyle={{fontSize:'0.75rem',paddingTop:8}} />
                  <Area type="monotone" dataKey="income" name="Income" fill={`${C.green}22`} stroke={C.green} strokeWidth={2} />
                  <Bar dataKey="expend" name="Expenditure" fill={`${C.red}88`} radius={[3,3,0,0]} />
                  <Line type="monotone" dataKey="net" name="Net Balance" stroke={C.gold} strokeWidth={2.5} dot={{r:4,fill:C.gold}} activeDot={{r:6}} strokeDasharray="5 3" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly Breakdown Bar + Collection Rate */}
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:14}}>
            <div className="card">
              <SH title="Monthly Revenue Breakdown" sub="Rent · Electric · Advance stacked" />
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={monthlyData} margin={{top:4,right:4,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={fmtK} />
                  <Tooltip content={<CT />} />
                  <Legend wrapperStyle={{fontSize:'0.72rem'}} />
                  <Bar dataKey="rent"     name="Rent"     stackId="a" fill={C.gold}   radius={[0,0,0,0]} />
                  <Bar dataKey="electric" name="Electric" stackId="a" fill={C.blue}   radius={[0,0,0,0]} />
                  <Bar dataKey="advance"  name="Advance"  stackId="a" fill={C.green}  radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <SH title="Collection Rate" sub="% of rooms that paid each month" />
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={collectionRate} layout="vertical" margin={{top:4,right:20,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" domain={[0,100]} tick={{fill:'var(--text3)',fontSize:10}} tickFormatter={v=>`${v}%`} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" tick={{fill:'var(--text3)',fontSize:10}} axisLine={false} tickLine={false} width={38} />
                  <Tooltip formatter={v=>`${v}%`} contentStyle={{background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:8,fontSize:'0.8rem'}} />
                  <ReferenceLine x={80} stroke={C.green} strokeDasharray="4 2" />
                  <Bar dataKey="rate" name="Collected %" fill={C.teal} radius={[0,3,3,0]}
                    label={{ position:'right', fill:'var(--text3)', fontSize:10, formatter:v=>`${v}%` }} />
                </BarChart>
              </ResponsiveContainer>
              <div style={{fontSize:'0.68rem',color:'var(--text3)',marginTop:6}}>Green line = 80% target</div>
            </div>
          </div>

          {/* Payment Mode Trend + Type Pie */}
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:14}}>
            <div className="card">
              <SH title="Cash vs Online Trend" sub="% split of payment modes month-by-month" />
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={modeTrend} margin={{top:4,right:4,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} domain={[0,100]} />
                  <Tooltip formatter={v=>`${v}%`} contentStyle={{background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:8,fontSize:'0.8rem'}} />
                  <Legend wrapperStyle={{fontSize:'0.72rem'}} />
                  <Area type="monotone" dataKey="cashPct"   name="Cash %"   stackId="1" fill={`${C.gold}55`}  stroke={C.gold}  strokeWidth={2} />
                  <Area type="monotone" dataKey="onlinePct" name="Online %" stackId="1" fill={`${C.teal}55`}  stroke={C.teal}  strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="card" style={{display:'flex',flexDirection:'column',justifyContent:'space-between'}}>
              <SH title="Payment Type Split" />
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={(() => {
                    const t={};
                    receipts.forEach(r=>{ const k=r.packageName||'other'; t[k]=(t[k]||0)+(r.amountPaid||r.totalAmount||0); });
                    return Object.entries(t).map(([name,value])=>({name,value}));
                  })()} cx="50%" cy="50%" outerRadius={70} innerRadius={38} paddingAngle={3} dataKey="value">
                    {PIE_COLORS.map((c,i)=><Cell key={i} fill={c} />)}
                  </Pie>
                  <Tooltip formatter={v=>`₹${fmt(v)}`} contentStyle={{background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:8,fontSize:'0.8rem'}} />
                  <Legend wrapperStyle={{fontSize:'0.7rem'}} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          TRENDS TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'trends' && (
        <div style={{display:'flex',flexDirection:'column',gap:16}}>

          {/* Revenue line + rolling avg */}
          <div className="card">
            <SH title="Revenue Trend — All Time" sub="Month-by-month income with trajectory" />
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={monthlyData} margin={{top:8,right:8,left:0,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} />
                <YAxis tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={fmtK} />
                <Tooltip content={<CT />} />
                <Legend wrapperStyle={{fontSize:'0.75rem',paddingTop:8}} />
                <Bar dataKey="income" name="Monthly Income" fill={`${C.gold}33`} radius={[3,3,0,0]} />
                <Line type="monotone" dataKey="income" name="Trend" stroke={C.gold} strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Day of week heatmap-style */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div className="card">
              <SH title="Payments by Day of Week" sub="When do members typically pay?" />
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dowData} margin={{top:4,right:4,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{fill:'var(--text3)',fontSize:12}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} />
                  <Tooltip content={<CT />} />
                  <Bar dataKey="count" name="# Payments" fill={C.blue} radius={[4,4,0,0]}>
                    {dowData.map((d,i) => {
                      const max = Math.max(...dowData.map(x=>x.count));
                      const alpha = max > 0 ? 0.3 + (d.count/max)*0.7 : 0.3;
                      return <Cell key={i} fill={C.blue} fillOpacity={alpha} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <SH title="Revenue by Day of Week" sub="Which day generates most income?" />
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dowData} margin={{top:4,right:4,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{fill:'var(--text3)',fontSize:12}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={fmtK} />
                  <Tooltip content={<CT />} />
                  <Bar dataKey="amount" name="Revenue" fill={C.gold} radius={[4,4,0,0]}>
                    {dowData.map((d,i) => {
                      const max = Math.max(...dowData.map(x=>x.amount));
                      const alpha = max > 0 ? 0.3 + (d.amount/max)*0.7 : 0.3;
                      return <Cell key={i} fill={C.gold} fillOpacity={alpha} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tenure distribution */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div className="card">
              <SH title="Member Tenure Distribution" sub="How long do members typically stay?" />
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={tenureData} cx="50%" cy="50%" outerRadius={85} innerRadius={45} paddingAngle={4} dataKey="value" label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                    {tenureData.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={v=>`${v} members`} contentStyle={{background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:8,fontSize:'0.8rem'}} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Electric consumption trend */}
            <div className="card">
              <SH title="Electric Consumption by Room" sub="Total units consumed — highest consumers" />
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={elecByRoom} layout="vertical" margin={{top:4,right:24,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{fill:'var(--text3)',fontSize:10}} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} width={32} />
                  <Tooltip formatter={(v,name)=> name==='units' ? `${v} units` : `₹${fmt(v)}`} contentStyle={{background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:8,fontSize:'0.8rem'}} />
                  <Bar dataKey="units" name="units" fill={C.blue} radius={[0,4,4,0]}
                    label={{position:'right',fill:'var(--text3)',fontSize:10}} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Room revenue radar */}
          {roomRevenue.length >= 3 && (
            <div className="card">
              <SH title="Room Revenue Ranking" sub="Top 10 rooms by total income generated" />
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={roomRevenue} margin={{top:4,right:8,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={fmtK} />
                  <Tooltip content={<CT />} />
                  <Legend wrapperStyle={{fontSize:'0.72rem'}} />
                  <Bar dataKey="rent"     name="Rent"     stackId="a" fill={C.gold}  radius={[0,0,0,0]} />
                  <Bar dataKey="electric" name="Electric" stackId="a" fill={C.blue}  radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          INSIGHTS TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'insights' && (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div className="card" style={{borderColor:'rgba(240,165,0,0.3)'}}>
            <SH title="🔍 Pattern Analysis & Insights" sub="Auto-detected from your hostel data" />
            {insights.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">🔍</div><p>Add more data to unlock insights</p></div>
            ) : (
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:10,marginTop:4}}>
                {insights.map((ins,i) => <Insight key={i} {...ins} />)}
              </div>
            )}
          </div>

          {/* Month-by-month table */}
          <div className="card">
            <SH title="Month-wise Breakdown Table" sub="Detailed financial summary per month" />
            <div className="table-wrap">
              <table>
                <thead><tr><th>Month</th><th>Receipts</th><th>Rent</th><th>Electric</th><th>Advance</th><th>Other</th><th>Total Income</th><th>Collection %</th></tr></thead>
                <tbody>
                  {[...monthlyData].reverse().map(m => {
                    const cr = collectionRate.find(c=>c.key===m.key);
                    return (
                      <tr key={m.key}>
                        <td style={{fontWeight:600}}>{m.label}</td>
                        <td style={{color:'var(--text3)'}}>{m.count}</td>
                        <td>{m.rent     ? `₹${fmt(m.rent)}`     : '—'}</td>
                        <td>{m.electric ? `₹${fmt(m.electric)}` : '—'}</td>
                        <td>{m.advance  ? `₹${fmt(m.advance)}`  : '—'}</td>
                        <td>{m.other    ? `₹${fmt(m.other)}`    : '—'}</td>
                        <td style={{color:'var(--accent)',fontWeight:700}}>₹{fmt(m.income)}</td>
                        <td>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <div style={{flex:1,height:6,background:'var(--bg3)',borderRadius:3,overflow:'hidden'}}>
                              <div style={{width:`${cr?.rate||0}%`,height:'100%',background:cr?.rate>=80?C.green:cr?.rate>=50?C.gold:C.red,borderRadius:3,transition:'width 0.3s'}} />
                            </div>
                            <span style={{fontSize:'0.75rem',color:cr?.rate>=80?C.green:cr?.rate>=50?C.gold:C.red,fontWeight:600,minWidth:32}}>{cr?.rate||0}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          ROOMS TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'rooms' && (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div className="card">
              <SH title="Room Revenue Comparison" />
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={roomRevenue} margin={{top:4,right:4,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} tickFormatter={fmtK} />
                  <Tooltip content={<CT />} />
                  <Bar dataKey="total" name="Total Revenue" fill={C.gold} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <SH title="Electric Consumption Ranking" />
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={elecByRoom} margin={{top:4,right:4,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:'var(--text3)',fontSize:11}} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v,n)=>n==='units'?`${v} units`:`₹${fmt(v)}`} contentStyle={{background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:8,fontSize:'0.8rem'}} />
                  <Bar dataKey="units" name="units consumed" fill={C.blue} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card">
            <SH title="Room Summary Table" />
            <div className="table-wrap">
              <table>
                <thead><tr><th>Room</th><th>Members</th><th>Fixed Rent</th><th>Rent Collected</th><th>Electric</th><th>Advance</th><th>Total Paid</th><th>Payments</th></tr></thead>
                <tbody>
                  {Array.from({length:maxRooms},(_,i)=>i+1).map(rn => {
                    const rr = receipts.filter(r=>r.roomNumber===rn);
                    const rm = activeMembers.filter(m=>m.roomNumber===rn);
                    if (rr.length===0 && rm.length===0) return null;
                    return (
                      <tr key={rn}>
                        <td><span className="badge badge-blue">Room {rn}</span></td>
                        <td style={{fontSize:'0.8rem',color:'var(--text2)'}}>{rm.map(m=>m.name).join(', ')||'—'}</td>
                        <td>{rm[0]?.rent ? `₹${fmt(rm[0].rent)}` : '—'}</td>
                        <td>₹{fmt(rr.reduce((s,r)=>s+(r.rent||0),0))}</td>
                        <td>₹{fmt(rr.reduce((s,r)=>s+(r.electric||0),0))}</td>
                        <td>₹{fmt(rr.reduce((s,r)=>s+(r.advance||0),0))}</td>
                        <td style={{color:'var(--accent)',fontWeight:700}}>₹{fmt(rr.reduce((s,r)=>s+(r.amountPaid||r.totalAmount||0),0))}</td>
                        <td style={{color:'var(--text3)'}}>{rr.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          PAYMENTS TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'payments' && (
        <div className="card">
          <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
            <input value={filters.search} onChange={e=>setFilters(p=>({...p,search:e.target.value}))} placeholder="Search member / bill..." style={selStyle} />
            <select style={selStyle} value={filters.room} onChange={e=>setFilters(p=>({...p,room:e.target.value}))}>
              <option value="">All Rooms</option>
              {Array.from({length:maxRooms},(_,i)=>i+1).map(n=><option key={n} value={n}>Room {n}</option>)}
            </select>
            <select style={selStyle} value={filters.mode} onChange={e=>setFilters(p=>({...p,mode:e.target.value}))}>
              <option value="">All Modes</option>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
            </select>
            <select style={selStyle} value={filters.type} onChange={e=>setFilters(p=>({...p,type:e.target.value}))}>
              <option value="">All Types</option>
              <option value="rent">Rent</option>
              <option value="advance">Advance</option>
              <option value="electric">Electric</option>
              <option value="final">Final Bill</option>
              <option value="other">Other</option>
            </select>
            <select style={selStyle} value={filters.partPay} onChange={e=>setFilters(p=>({...p,partPay:e.target.value}))}>
              <option value="">All Payments</option>
              <option value="yes">Part Payments Only</option>
              <option value="no">Full Payments Only</option>
            </select>
            <input type="date" style={selStyle} value={filters.from} onChange={e=>setFilters(p=>({...p,from:e.target.value}))} title="From date" />
            <input type="date" style={selStyle} value={filters.to}   onChange={e=>setFilters(p=>({...p,to:e.target.value}))}   title="To date"   />
            <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
              <span style={{color:'var(--accent)',fontFamily:'Rajdhani',fontWeight:700}}>₹{fmt(filteredReceipts.reduce((s,r)=>s+(r.amountPaid||r.totalAmount||0),0))}</span>
              <button className="btn btn-secondary btn-xs" onClick={exportFilteredCSV}>📥 CSV</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Bill No</th><th>Room</th><th>Member</th><th>Type</th><th>Mode</th><th>Total</th><th>Paid</th><th style={{color:'var(--danger)'}}>Balance</th></tr></thead>
              <tbody>
                {filteredReceipts.length===0 ? (
                  <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon">🧾</div><p>No records found</p></div></td></tr>
                ) : filteredReceipts.map(r=>(
                  <tr key={r._id}>
                    <td style={{fontSize:'0.8rem'}}>{new Date(r.receiptDate).toLocaleDateString('en-IN')}</td>
                    <td style={{fontFamily:'monospace',fontSize:'0.78rem',color:'var(--text3)'}}>{r.billNumber||'—'}</td>
                    <td><span className="badge badge-blue">R{r.roomNumber}</span></td>
                    <td style={{fontWeight:500}}>{r.memberName||'—'}</td>
                    <td>
                      <span className="badge badge-yellow">{r.packageName}</span>
                      {r.isPartPayment && <span style={{marginLeft:4,fontSize:'0.65rem',background:'rgba(243,156,18,0.15)',color:C.orange,padding:'1px 6px',borderRadius:8}}>Part</span>}
                    </td>
                    <td><span className={`badge ${r.modeOfPayment==='cash'?'badge-green':'badge-blue'}`}>{r.modeOfPayment}</span></td>
                    <td style={{fontWeight:600}}>₹{fmt(r.totalAmount)}</td>
                    <td style={{color:C.green,fontWeight:600}}>₹{fmt(r.amountPaid||r.totalAmount)}</td>
                    <td style={{color:(r.balanceDue||0)>0?C.red:'var(--text3)',fontWeight:(r.balanceDue||0)>0?700:400}}>
                      {(r.balanceDue||0)>0?`₹${fmt(r.balanceDue)}`:'—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          MEMBERS TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'members' && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Name</th><th>Mobile</th><th>Room</th><th>Join</th><th>Leaving</th><th>Rent</th><th>Police</th><th>Status</th></tr></thead>
              <tbody>
                {members.length===0 ? (
                  <tr><td colSpan={9}><div className="empty-state"><div className="empty-icon">👥</div><p>No members</p></div></td></tr>
                ) : members.map(m=>(
                  <tr key={m._id}>
                    <td style={{fontFamily:'monospace',fontSize:'0.76rem',color:'var(--accent)'}}>{m.memberId||'—'}</td>
                    <td style={{fontWeight:500}}>{m.name}</td>
                    <td style={{fontSize:'0.82rem'}}>{m.mobileNo}</td>
                    <td>{m.roomNumber?<span className="badge badge-blue">R{m.roomNumber}</span>:'—'}</td>
                    <td style={{fontSize:'0.8rem'}}>{m.roomJoinDate?new Date(m.roomJoinDate).toLocaleDateString('en-IN'):'—'}</td>
                    <td style={{fontSize:'0.8rem',color:m.roomLeavingDate&&new Date(m.roomLeavingDate)<new Date()?C.red:'inherit'}}>
                      {m.roomLeavingDate?new Date(m.roomLeavingDate).toLocaleDateString('en-IN'):'—'}
                    </td>
                    <td>₹{fmt(m.rent)}</td>
                    <td><span className={`badge ${m.policeFormVerified?'badge-green':'badge-red'}`}>{m.policeFormVerified?'Done':'Pending'}</span></td>
                    <td><span className={`badge ${m.isActive!==false?'badge-green':'badge-red'}`}>{m.isActive!==false?'Active':'Archived'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* ════════════════════════════════════════════════════════
          RENT COLLECTION REGISTER TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'register' && (() => {
        // Build last 12 months list
        const months = [];
        for (let i = 11; i >= 0; i--) {
          const d = new Date();
          d.setDate(1);
          d.setMonth(d.getMonth() - i);
          months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }) });
        }

        // All occupied rooms (from members)
        const roomNums = [...new Set(members.filter(m => m.roomNumber && m.isActive !== false).map(m => m.roomNumber))].sort((a, b) => a - b);

        // Build lookup: "roomNum-year-month" → amountPaid
        const paidMap = {};
        receipts.forEach(r => {
          if (!r.roomNumber || !r.receiptDate) return;
          const type = r.packageName || r.paymentType || '';
          if (type === 'electric') return; // only rent-type payments
          const d = new Date(r.receiptDate);
          const key = `${r.roomNumber}-${d.getFullYear()}-${d.getMonth() + 1}`;
          paidMap[key] = (paidMap[key] || 0) + (r.amountPaid ?? r.totalAmount ?? 0);
        });

        // Room name lookup
        const roomMemberNames = {};
        members.filter(m => m.isActive !== false && m.roomNumber).forEach(m => {
          if (!roomMemberNames[m.roomNumber]) roomMemberNames[m.roomNumber] = m.name;
        });

        const curMon2 = new Date().getMonth() + 1;
        const curYr2  = new Date().getFullYear();

        const printRegister = () => {
          const headerCols = months.map(m => `<th style="min-width:52px;text-align:center;font-size:10px">${m.label}</th>`).join('');
          const bodyRows = roomNums.map(rn => {
            const cells = months.map(({ year, month }) => {
              const key = `${rn}-${year}-${month}`;
              const paid = paidMap[key] || 0;
              const isFuture = year > curYr2 || (year === curYr2 && month > curMon2);
              if (isFuture) return `<td style="text-align:center;background:#f5f5f5;color:#aaa;font-size:10px">—</td>`;
              if (paid > 0) return `<td style="text-align:center;background:#d4edda;color:#155724;font-weight:700;font-size:10px">₹${(paid/1000).toFixed(0)}k</td>`;
              return `<td style="text-align:center;background:#f8d7da;color:#721c24;font-size:11px;font-weight:700">✗</td>`;
            }).join('');
            return `<tr><td style="font-weight:600;white-space:nowrap;font-size:11px">Rm ${rn}</td><td style="font-size:10px;color:#666;white-space:nowrap">${roomMemberNames[rn]||'—'}</td>${cells}</tr>`;
          }).join('');
          const w = window.open('','_blank');
          w.document.write(`<!DOCTYPE html><html><head><title>Rent Collection Register</title>
            <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:11px;padding:16px;}
            h2{font-size:1rem;margin-bottom:4px;}p{color:#666;font-size:0.75rem;margin-bottom:12px;}
            table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ddd;padding:5px 6px;}
            th{background:#f5f5f5;font-size:10px;text-transform:uppercase;}
            @media print{@page{margin:6mm;size:A4 landscape;}}</style>
            </head><body>
            <h2>Rent Collection Register</h2>
            <p>Last 12 months · ✓ = paid · ✗ = not paid · Generated ${new Date().toLocaleDateString('en-IN')}</p>
            <table><thead><tr><th>Room</th><th>Primary Member</th>${headerCols}</tr></thead>
            <tbody>${bodyRows}</tbody></table>
            </body></html>`);
          w.document.close();
          setTimeout(() => w.print(), 400);
        };

        const paidCount   = roomNums.filter(rn => { const { year, month } = months[months.length-1]; return (paidMap[`${rn}-${year}-${month}`]||0)>0; }).length;
        const unpaidCount = roomNums.length - paidCount;

        return (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:10}}>
              <div style={{display:'flex',gap:14,flexWrap:'wrap'}}>
                <div className="card" style={{padding:'10px 16px',display:'flex',gap:10,alignItems:'center'}}>
                  <span style={{fontSize:'1.2rem'}}>✅</span>
                  <div><div style={{fontSize:'0.68rem',color:'var(--text3)',textTransform:'uppercase'}}>Paid This Month</div><div style={{fontFamily:'Rajdhani',fontSize:'1.4rem',fontWeight:700,color:'var(--success)'}}>{paidCount} rooms</div></div>
                </div>
                <div className="card" style={{padding:'10px 16px',display:'flex',gap:10,alignItems:'center'}}>
                  <span style={{fontSize:'1.2rem'}}>❌</span>
                  <div><div style={{fontSize:'0.68rem',color:'var(--text3)',textTransform:'uppercase'}}>Unpaid This Month</div><div style={{fontFamily:'Rajdhani',fontSize:'1.4rem',fontWeight:700,color:'var(--danger)'}}>{unpaidCount} rooms</div></div>
                </div>
              </div>
              <button className="btn btn-secondary btn-xs" onClick={printRegister}>🖨 Print Register</button>
            </div>

            <div className="card" style={{padding:0,overflow:'hidden'}}>
              <div style={{overflowX:'auto'}}>
                <table style={{borderCollapse:'collapse',width:'100%',fontSize:'0.78rem'}}>
                  <thead>
                    <tr style={{background:'var(--bg3)'}}>
                      <th style={{padding:'10px 12px',textAlign:'left',fontWeight:700,color:'var(--text3)',fontSize:'0.68rem',textTransform:'uppercase',whiteSpace:'nowrap',position:'sticky',left:0,background:'var(--bg3)',zIndex:2}}>Room</th>
                      <th style={{padding:'10px 12px',textAlign:'left',fontWeight:700,color:'var(--text3)',fontSize:'0.68rem',textTransform:'uppercase',whiteSpace:'nowrap',position:'sticky',left:60,background:'var(--bg3)',zIndex:2,minWidth:100}}>Member</th>
                      {months.map(m => (
                        <th key={m.label} style={{padding:'8px 6px',textAlign:'center',fontWeight:700,color: m.year===curYr2&&m.month===curMon2 ? 'var(--accent)':'var(--text3)',fontSize:'0.65rem',textTransform:'uppercase',minWidth:52, background: m.year===curYr2&&m.month===curMon2 ? 'rgba(var(--accent-rgb,240,165,0),0.07)':'var(--bg3)'}}>{m.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roomNums.map((rn, ri) => (
                      <tr key={rn} style={{borderBottom:'1px solid var(--border)',background:ri%2===0?'transparent':'var(--bg2)'}}>
                        <td style={{padding:'8px 12px',fontWeight:700,color:'var(--accent)',whiteSpace:'nowrap',position:'sticky',left:0,background:ri%2===0?'var(--bg)':'var(--bg2)',zIndex:1}}>
                          <span className="badge badge-blue" style={{fontSize:'0.7rem'}}>Rm {rn}</span>
                        </td>
                        <td style={{padding:'8px 12px',color:'var(--text2)',fontSize:'0.75rem',whiteSpace:'nowrap',position:'sticky',left:60,background:ri%2===0?'var(--bg)':'var(--bg2)',zIndex:1,maxWidth:110,overflow:'hidden',textOverflow:'ellipsis'}}>{roomMemberNames[rn]||'—'}</td>
                        {months.map(({ year, month, label }) => {
                          const key = `${rn}-${year}-${month}`;
                          const paid = paidMap[key] || 0;
                          const isFuture = year > curYr2 || (year === curYr2 && month > curMon2);
                          const isCurr   = year === curYr2 && month === curMon2;
                          if (isFuture) return (
                            <td key={label} style={{textAlign:'center',color:'var(--text3)',fontSize:'0.7rem',background:'var(--bg3)'}}>—</td>
                          );
                          if (paid > 0) return (
                            <td key={label} style={{textAlign:'center',background:'rgba(46,204,113,0.12)',border: isCurr?'2px solid var(--success)':'none'}}>
                              <div style={{fontWeight:700,color:'var(--success)',fontSize:'0.72rem'}}>✓</div>
                              <div style={{fontSize:'0.62rem',color:'var(--text3)'}}>₹{paid>=1000?(paid/1000).toFixed(1)+'k':paid}</div>
                            </td>
                          );
                          return (
                            <td key={label} style={{textAlign:'center',background:isCurr?'rgba(231,76,60,0.1)':'rgba(231,76,60,0.05)',border:isCurr?'2px solid var(--danger)':'none'}}>
                              <span style={{color:'var(--danger)',fontWeight:700,fontSize:'0.85rem'}}>✗</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{padding:'10px 16px',fontSize:'0.72rem',color:'var(--text3)',borderTop:'1px solid var(--border)',display:'flex',gap:20,flexWrap:'wrap'}}>
                <span><span style={{color:'var(--success)',fontWeight:700}}>✓ Green</span> = rent paid (any type except electric)</span>
                <span><span style={{color:'var(--danger)',fontWeight:700}}>✗ Red</span> = no payment recorded</span>
                <span><strong style={{color:'var(--accent)'}}>Bold border</strong> = current month</span>
                <span>Amounts shown are total non-electric receipts for that month</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ════════════════════════════════════════════════════════
          TAX SUMMARY TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'tax' && <TaxSummary receipts={receipts} salary={salary} />}

      {/* ════════════════════════════════════════════════════════
          EXPORT TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'export' && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:14}}>
          {[
            { key:'members',  label:'Members',          icon:'👥', desc:'All member records — names, rooms, contacts, aadhar, dates' },
            { key:'receipts', label:'Receipts',          icon:'🧾', desc:'All payment receipts with amounts, dates, modes' },
            { key:'electric', label:'Electric',          icon:'⚡', desc:'Room-wise electricity readings and bills' },
            { key:'salary',   label:'Salary & Expenses', icon:'💰', desc:'Staff salaries and maintenance records' },
          ].map(c=>(
            <div key={c.key} className="card" style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{fontSize:'2rem'}}>{c.icon}</div>
              <div>
                <div style={{fontWeight:700,color:'var(--text)',fontSize:'1rem',marginBottom:4}}>{c.label}</div>
                <div style={{fontSize:'0.8rem',color:'var(--text3)'}}>{c.desc}</div>
              </div>
              <button className="btn btn-secondary" onClick={()=>exportCSV(c.key)} disabled={!!exporting} style={{marginTop:'auto'}}>
                {exporting===c.key?'⏳ Exporting...':'📥 Download CSV (Excel)'}
              </button>
            </div>
          ))}
          <div className="card" style={{display:'flex',flexDirection:'column',gap:14,border:'1px solid rgba(240,165,0,0.3)'}}>
            <div style={{fontSize:'2rem'}}>💾</div>
            <div>
              <div style={{fontWeight:700,color:'var(--text)',fontSize:'1rem',marginBottom:4}}>Full Database Backup</div>
              <div style={{fontSize:'0.8rem',color:'var(--text3)'}}>Complete encrypted JSON backup of all data.</div>
            </div>
            <button className="btn btn-primary" onClick={exportJSON} disabled={!!exporting} style={{marginTop:'auto'}}>
              {exporting==='json'?'⏳ Generating...':'💾 Download Full Backup'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
