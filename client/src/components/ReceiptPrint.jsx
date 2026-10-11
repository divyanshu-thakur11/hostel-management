import React from 'react';
import { METHODS } from '../utils/dues';

export function numberToWords(num) {
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  if (!num || num === 0) return 'Zero';
  let n = Math.floor(num), w = '';
  if (Math.floor(n/100000)>0){w+=numberToWords(Math.floor(n/100000))+' Lakh ';n%=100000;}
  if (Math.floor(n/1000)>0){w+=numberToWords(Math.floor(n/1000))+' Thousand ';n%=1000;}
  if (Math.floor(n/100)>0){w+=numberToWords(Math.floor(n/100))+' Hundred ';n%=100;}
  if (n>0){if(n<20)w+=a[n];else w+=b[Math.floor(n/10)]+(n%10?' '+a[n%10]:'');}
  return w.trim();
}

export const PKG = { rent:'Rent / किराया', advance:'Advance / एडवांस', electric:'Electric / बिजली', final:'Final Bill / अंतिम', other:'Other / अन्य' };

const inr = (n) => `₹${(n||0).toLocaleString('en-IN')}`;
const methodName = (r) => {
  const v = r.paymentMethod || (r.modeOfPayment === 'online' ? 'online_other' : 'cash');
  return (METHODS.find(m => m.value === v) || METHODS[5]).label;
};

// Receipt for one payment. For bills paid in installments it also shows the
// bill total, what was paid today, the running total and the remaining balance;
// when `receipt.installments` is attached it lists every payment
// ("₹600 Cash + ₹400 UPI = ₹1,000 Paid").
export default function ReceiptPrint({ receipt }) {
  const fmt = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'}) : '—';
  const isInst   = !!receipt.parentReceiptId;
  const paidAmt  = receipt.isPartPayment ? (receipt.amountPaid||0) : (receipt.totalAmount||0);
  const words    = receipt.amountInWords || (numberToWords(paidAmt)+' Rupees Only');
  const billTotal = isInst ? (receipt.billTotal || receipt.totalAmount || 0) : (receipt.totalAmount || 0);
  const balNow   = isInst ? (receipt.balanceAfter || 0) : (receipt.balanceDue || 0);
  const isPartPay = isInst || (receipt.isPartPayment && balNow > 0);
  const paidToDate = isInst ? (receipt.paidToDate || 0) : (receipt.cumulativePaid ?? receipt.amountPaid ?? 0);
  const insts = receipt.installments || null;
  const membersList = receipt.members?.length > 0 ? receipt.members.map(m=>m.name).join(', ') : receipt.memberName || '—';

  return (
    <div style={{fontFamily:'"Noto Sans",sans-serif',background:'white',color:'#111',padding:'28px',fontSize:'13px'}}>
      <div style={{textAlign:'center',borderBottom:'2px solid #111',paddingBottom:12,marginBottom:16}}>
        <div style={{fontSize:'1.5rem',fontWeight:700,letterSpacing:1}}>HOSTEL MANAGER</div>
        <div style={{fontSize:'0.75rem',color:'#555',letterSpacing:'0.1em',textTransform:'uppercase'}}>
          {isInst ? `Installment #${receipt.installmentNo || ''} Receipt` : isPartPay ? 'Part Payment Receipt' : 'Payment Receipt / भुगतान रसीद'}
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
        <div><span style={{color:'#555'}}>Date: </span><strong>{fmt(receipt.receiptDate)}</strong></div>
        <div><span style={{color:'#555'}}>Receipt #</span><strong>{receipt.receiptNumber}</strong></div>
      </div>
      <div style={{marginBottom:12}}><span style={{color:'#555'}}>Bill No.: </span><strong style={{fontSize:'1rem',color:'#c00'}}>{receipt.billNumber||'—'}</strong></div>
      {[
        ['Members / सदस्य', membersList],
        ['Room / कमरा', receipt.roomNumber ? `Room ${receipt.roomNumber}` : '—'],
        ['Package / पैकेज', PKG[receipt.packageName]||receipt.packageName],
        ['From / दिनांक से', fmt(receipt.fromDate)],
        ['To / दिनांक तक', fmt(receipt.toDate)],
        ['Mode / भुगतान', methodName(receipt)],
        ...(receipt.referenceNo ? [['Reference / Txn ID', receipt.referenceNo]] : []),
      ].map(([l,v],i)=>(
        <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px dashed #ddd'}}>
          <span style={{color:'#555'}}>{l}</span><span style={{fontWeight:500}}>{v}</span>
        </div>
      ))}
      {isPartPay && (
        <div style={{margin:'12px 0',padding:'10px',background:'#fff8e1',border:'1px solid #f39c12',borderRadius:4}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{color:'#555'}}>Total Bill</span><span style={{fontWeight:600}}>{inr(billTotal)}</span></div>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{color:'#555'}}>Paid Today</span><span style={{fontWeight:700,color:'#27ae60'}}>{inr(paidAmt)}</span></div>
          {paidToDate > paidAmt && <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{color:'#555'}}>Paid So Far</span><span style={{fontWeight:600}}>{inr(paidToDate)}</span></div>}
          <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid #f39c12',paddingTop:6,marginTop:4}}>
            <span style={{color:balNow>0?'#c00':'#27ae60',fontWeight:700}}>{balNow>0?'Balance Due':'Bill fully paid'}</span>
            <span style={{fontWeight:700,color:balNow>0?'#c00':'#27ae60'}}>{inr(balNow)}</span>
          </div>
        </div>
      )}
      {insts && insts.length > 1 && (
        <div style={{margin:'10px 0',fontSize:'12px'}}>
          <div style={{fontWeight:700,marginBottom:4}}>Payment breakdown</div>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <tbody>
              {insts.map(x => (
                <tr key={x._id}>
                  <td style={{padding:'3px 4px',border:'1px solid #ddd'}}>#{x.installmentNo}</td>
                  <td style={{padding:'3px 4px',border:'1px solid #ddd'}}>{fmt(x.receiptDate)}</td>
                  <td style={{padding:'3px 4px',border:'1px solid #ddd'}}>{x.methodLabel}{x.referenceNo ? ` · ${x.referenceNo}` : ''}</td>
                  <td style={{padding:'3px 4px',border:'1px solid #ddd',textAlign:'right',fontWeight:600}}>{inr(x.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {receipt.paymentBreakdownText && <div style={{marginTop:4,fontWeight:600}}>{receipt.paymentBreakdownText}</div>}
        </div>
      )}
      <div style={{margin:'14px 0',padding:'10px',background:'#f9f9f9',border:'1px solid #ddd',borderRadius:4}}>
        <div style={{fontSize:'11px',color:'#777',textTransform:'uppercase',letterSpacing:1,marginBottom:3}}>Sum of Rupees Paid / भुगतान राशि शब्दों में</div>
        <div style={{fontSize:'1rem',fontWeight:600,color:'#222'}}>{words}</div>
      </div>
      <div style={{textAlign:'center',padding:'14px',background:'#111',color:'white',borderRadius:6,margin:'10px 0'}}>
        <div style={{fontSize:'11px',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:3,opacity:0.7}}>AMOUNT PAID</div>
        <div style={{fontSize:'2rem',fontWeight:900}}>{inr(paidAmt)}</div>
        {isPartPay && <div style={{fontSize:'0.75rem',opacity:0.7,marginTop:3}}>{balNow>0 ? `Part Payment · Balance: ${inr(balNow)}` : 'Final installment · Bill fully paid'}</div>}
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:28}}>
        <div style={{width:180,textAlign:'center'}}>
          <div style={{borderTop:'1px solid #333',paddingTop:6,fontSize:'12px',color:'#555'}}>हस्ताक्षर / Signature</div>
        </div>
      </div>
      {receipt.notes && <div style={{marginTop:10,fontSize:'11px',color:'#777'}}>Note: {receipt.notes}</div>}
    </div>
  );
}
