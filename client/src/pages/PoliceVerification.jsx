import React, { useEffect, useState, useRef } from 'react';
import { membersAPI } from '../utils/api';

export default function PoliceVerification() {
  const [members, setMembers] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [thana, setThana] = useState('थाना संयोगितागंज');
  const [address, setAddress] = useState('1-B शिवकृपा कॉलोनी साजन नगर, इंदौर');
  const [officeAddress, setOfficeAddress] = useState('');
  const [duration, setDuration] = useState('1 वर्ष');
  const [ownerMobile, setOwnerMobile] = useState('');
  const printRef = useRef();

  useEffect(() => { membersAPI.getAll().then(r => setMembers(r.data?.data || r.data || [])); }, []);

  const handleMemberSelect = (id) => {
    setSelectedMemberId(id);
    const m = members.find(x => x._id === id);
    setSelectedMember(m || null);
    // Auto-fill office address from member occupation
    if (m?.studentOccupation) {
      setOfficeAddress(m.studentOccupation);
    } else {
      setOfficeAddress('');
    }
  };

  const doPrint = () => {
    const w = window.open('', '_blank');
    w.document.write('<html><head><title>Police Verification</title>');
    w.document.write('<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&display=swap" rel="stylesheet">');
    w.document.write('<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:"Noto Sans Devanagari","Noto Sans",sans-serif;padding:24px;color:#111;font-size:13.5px;line-height:1.9;} input{border:none;border-bottom:1px solid #333;outline:none;font-family:inherit;font-size:inherit;background:transparent;}</style>');
    w.document.write('</head><body>');
    w.document.write(printRef.current.innerHTML);
    w.document.write('</body></html>');
    w.document.close();
    setTimeout(() => w.print(), 600);
  };

  const m = selectedMember;
  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '……/……/………';

  return (
    <div>
      <div className="page-header">
        <div><h2>Police Verification / पुलिस सत्यापन</h2><p>Generate police verification form</p></div>
        <button className="btn btn-primary" onClick={doPrint} disabled={!selectedMember}>🖨 Print Form</button>
      </div>

      <div className="card" style={{marginBottom:20}}>
        <div className="form-grid">
          <div className="form-group">
            <label>Select Member / सदस्य चुनें</label>
            <select value={selectedMemberId} onChange={e => handleMemberSelect(e.target.value)}>
              <option value="">— Select Member —</option>
              {members.map(m => <option key={m._id} value={m._id}>{m.name} {m.roomNumber ? `(Room ${m.roomNumber})` : ''}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>थाना / Police Station</label>
            <select value={thana} onChange={e => setThana(e.target.value)}>
              <option value="थाना संयोगितागंज">थाना संयोगितागंज</option>
              <option value="थाना भंवरकुआं">थाना भंवरकुआं</option>
            </select>
          </div>
          <div className="form-group">
            <label>किराये का पता / Rental Address</label>
            <select value={address} onChange={e => setAddress(e.target.value)}>
              <option value="1-B शिवकृपा कॉलोनी साजन नगर, इंदौर">1-B शिवकृपा कॉलोनी साजन नगर, इंदौर</option>
              <option value="160-A, नेमावर रोड, जगन्नाथ कॉलोनी, नवलखा, इंदौर">160-A, नेमावर रोड, जगन्नाथ कॉलोनी, नवलखा, इंदौर</option>
            </select>
          </div>
          <div className="form-group">
            <label>कार्यालय का पता व फोन / Office Address & Phone</label>
            <input value={officeAddress} onChange={e=>setOfficeAddress(e.target.value)} placeholder="Auto-filled from occupation — edit if needed" />
          </div>
          <div className="form-group">
            <label>किरायेदारी की संभावित अवधि / Expected Duration</label>
            <input value={duration} onChange={e=>setDuration(e.target.value)} placeholder="e.g. 6 महीने / 1 वर्ष" />
          </div>
          <div className="form-group">
            <label>मकान मालिक का मो. नं.</label>
            <input value={ownerMobile} onChange={e=>setOwnerMobile(e.target.value)} placeholder="Owner mobile number" />
          </div>
        </div>
      </div>

      {/* Form Preview */}
      <div className="card" style={{background:'white',color:'#111'}}>
        <div ref={printRef}>
          <PoliceForm
            member={m} thana={thana} address={address}
            officeAddress={officeAddress} duration={duration}
            ownerMobile={ownerMobile} fmt={fmt}
          />
        </div>
      </div>
    </div>
  );
}

function PoliceForm({ member, thana, address, officeAddress, duration, ownerMobile, fmt }) {
  const s = (val, fallback='……………………………') => val || fallback;
  const inp = (w=160) => (
    <input
      style={{border:'none',borderBottom:'1px solid #333',outline:'none',width:w,fontFamily:'inherit',fontSize:'inherit',background:'transparent'}}
    />
  );

  return (
    <div style={{fontFamily:'"Noto Sans Devanagari","Noto Sans",sans-serif',color:'#111',padding:'28px',fontSize:'13.5px',lineHeight:1.9}}>

      {/* Title + Photo */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20}}>
        <div style={{flex:1,textAlign:'center'}}>
          <div style={{fontWeight:700,fontSize:'1.1rem',textDecoration:'underline',marginBottom:4}}>किरायेदार की सम्पूर्ण जानकारी</div>
          <div style={{fontSize:'12px',color:'#555'}}>{thana}</div>
        </div>
        <div style={{width:90,height:110,border:'2px dashed #999',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',color:'#aaa',fontSize:'10px',textAlign:'center',borderRadius:4,marginLeft:16,flexShrink:0}}>
          <div style={{fontSize:'20px'}}>📷</div>
          <div>फोटो चिपकाएं</div>
        </div>
      </div>

      <hr style={{borderColor:'#333',marginBottom:16}} />

      {/* Owner Info */}
      <div style={{fontWeight:700,textAlign:'center',textDecoration:'underline',marginBottom:10,fontSize:'1rem'}}>मकान मालिक की जानकारी</div>

      <p><strong>1. मकान मालिक का पूरा नाम –</strong> दिनेश सिंह ठाकुर &nbsp;&nbsp;&nbsp; <strong>मो. नं.</strong> 9826400917</p>
      <p style={{paddingLeft:16}}><strong>पिता का नाम –</strong> श्री मदन सिंह ठाकुर</p>
      <p style={{paddingLeft:16}}>
        <strong>मो. नं. –</strong>{' '}
        {ownerMobile || <span style={{borderBottom:'1px solid #333',display:'inline-block',minWidth:160}}>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>}
      </p>
      <p><strong>2. पूर्ण पता –</strong> 108 प्रकाश नगर नवलखा, इंदौर</p>
      <p><strong>3. किराये पर दिए गए स्थान का पता –</strong> {address}</p>

      <hr style={{borderColor:'#aaa',margin:'14px 0'}} />

      {/* Tenant Info */}
      <div style={{fontWeight:700,textAlign:'center',textDecoration:'underline',marginBottom:10,fontSize:'1rem'}}>किरायेदार की जानकारी</div>

      <p>
        <strong>4. किरायेदार का नाम, उपनाम –</strong> {s(member?.name)} &nbsp;&nbsp;
        <strong>मो. नं. –</strong> {s(member?.mobileNo)}
      </p>
      <p style={{paddingLeft:16}}>
        <strong>पिता का नाम –</strong> {s(member?.fathersName)} &nbsp;&nbsp;
        <strong>मो. नं. –</strong> {s(member?.fathersMobileNo)}
      </p>

      <p><strong>5. किरायेदार का स्थायी पता –</strong> {s(member?.permanentAddress)}</p>

      <p><strong>6. मकान किराये से दिलाने वाले व्यक्ति का नाम एवं पता –</strong> स्वयं</p>

      <p><strong>7. किरायेदार जहाँ काम करता है / व्यवसाय व कार्यालय का पता –</strong> {s(officeAddress)}</p>

      <p>
        <strong>8. मकान किराये पर देने की दिनांक –</strong> {fmt(member?.admissionDate || member?.roomJoinDate)} &nbsp;&nbsp;
        <strong>किरायेदारी की संभावित अवधि –</strong> {s(duration)}
      </p>

      <p>
        <strong>9. किरायेदार के परिवार के सदस्य</strong> &nbsp;&nbsp;
        1: ………………… &nbsp;&nbsp;
        2: ………………… &nbsp;&nbsp;
        3: ………………… &nbsp;&nbsp;
        4: ………………… &nbsp;&nbsp;
        5: …………………
      </p>
      <p style={{paddingLeft:16}}>
        <strong>स्थानीय परिचित का नाम, पता व फोन नं. –</strong>{' '}
        {member?.localRelativeName
          ? `${member.localRelativeName}, ${member.localRelativeAddress || ''}, ${member.localRelativeMobile || ''}`
          : '……………………………………………………………………………'}
      </p>

      <p><strong>10. वाहन का नाम व रजिस्ट्रेशन नं. –</strong> ………………………………………………………………………</p>

      <div style={{display:'flex',justifyContent:'space-between',gap:16}}>
        <p style={{flex:1}}><strong>11. ड्राइविंग लाइसेंस एवं जारी करने वाले कार्यालय का नाम –</strong> ………………………………</p>
        <p style={{flexShrink:0}}><strong>फोन –</strong> ………………………</p>
      </div>

      <div style={{display:'flex',justifyContent:'space-between',gap:16}}>
        <p style={{flex:1}}><strong>12. हथियार का विवरण –</strong> …………………………………………………</p>
        <p style={{flexShrink:0}}><strong>लाइसेंस –</strong> ………………………</p>
      </div>

      <p><strong>13. लाइसेंस कहाँ से जारी हुआ –</strong> ………………………………………………………………………</p>

      <p>
        <strong>14. पहचान पत्र अथवा पहचान संबंधी दस्तावेज का विवरण Aadhar number –</strong>{' '}
        {s(member?.aadharNumber)}
      </p>

      <p><strong>15. तस्दीक के समय की गई कार्यवाही –</strong> ………………………………………………………………</p>

      {/* Signatures */}
      <div style={{marginTop:40,borderTop:'1px solid #aaa',paddingTop:16}}>
        <div style={{fontWeight:600,marginBottom:16}}>हस्ताक्षर:</div>
        <div style={{display:'flex',justifyContent:'space-between'}}>
          <div style={{textAlign:'center',width:'30%'}}>
            <div style={{borderTop:'1px solid #333',paddingTop:8,fontSize:'12px'}}>
              किरायेदार के हस्ताक्षर<br/>__________________
            </div>
          </div>
          <div style={{textAlign:'center',width:'30%'}}>
            <div style={{borderTop:'1px solid #333',paddingTop:8,fontSize:'12px'}}>
              मकान मालिक के हस्ताक्षर<br/>__________________
            </div>
          </div>
          <div style={{textAlign:'center',width:'30%'}}>
            <div style={{borderTop:'1px solid #333',paddingTop:8,fontSize:'12px'}}>
              जांच कर्ता के हस्ताक्षर व सील<br/>__________________
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
