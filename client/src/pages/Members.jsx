import { useHostel } from '../context/HostelContext';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { membersAPI, roomsAPI, whatsapp as wa } from '../utils/api';
import { useToast } from '../context/ToastContext';
import Fuse from 'fuse.js';

const EMPTY = {
  name:'', mobileNo:'', fathersName:'', fathersMobileNo:'', aadharNumber:'',
  fathersOccupation:'', studentOccupation:'', admissionDate:'',
  permanentAddress:'', permanentAddressRelativeName:'',
  permanentAddressRelativeAddress:'', permanentAddressRelativeMobile:'',
  localRelativeName:'', localRelativeAddress:'', localRelativeMobile:'',
  memberIdNumber:'',
};

const validateMobile = (v) => v && !/^[6-9]\d{9}$/.test(v.replace(/\D/g,'')) ? '10-digit mobile starting with 6-9' : '';
const validateAadhar = (v) => v && !/^\d{12}$/.test(v.replace(/[\s-]/g,'')) ? 'Aadhar must be 12 digits' : '';

function MobileInput({ label, value, onChange, required }) {
  const err = validateMobile(value);
  return (
    <div className="form-group">
      <label>{label}{required && ' *'}</label>
      <input value={value} onChange={e => onChange(e.target.value.replace(/\D/g,'').slice(0,10))}
        placeholder="10-digit mobile" maxLength={10} inputMode="numeric"
        style={{ borderColor: value && err ? 'var(--danger)' : '' }} />
      {value && err && <span style={{fontSize:'0.72rem',color:'var(--danger)'}}>{err}</span>}
    </div>
  );
}

function AadharInput({ value, onChange }) {
  const err = validateAadhar(value);
  return (
    <div className="form-group">
      <label>Aadhar Number *</label>
      <input value={value} onChange={e => onChange(e.target.value.replace(/\D/g,'').slice(0,12))}
        placeholder="12-digit Aadhar" maxLength={12} inputMode="numeric"
        style={{ borderColor: value && err ? 'var(--danger)' : '', letterSpacing: value ? '0.1em' : '' }} />
      {value && <span style={{fontSize:'0.72rem',color: err ? 'var(--danger)' : 'var(--success)'}}>{err || `✓ ${value.length}/12 digits`}</span>}
    </div>
  );
}

const PAGE_SIZE = 20;

export default function Members() {
  const { hostelSwitchCount } = useHostel();
  const [archived, setArchived] = useState([]);
  const [total, setTotal]       = useState(0);
  const [archivedTotal, setArchivedTotal] = useState(0);
  const [page, setPage]         = useState(1);
  const [archivedPage, setArchivedPage] = useState(1);
  const [tab, setTab]           = useState('active');
  const [showModal, setShowModal] = useState(false);
  const [showVacateModal, setShowVacateModal] = useState(null);
  const [showRestoreModal, setShowRestoreModal] = useState(null);
  const [restoreRoom, setRestoreRoom] = useState('');
  const [showPrintMember, setShowPrintMember] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState(EMPTY);
  const [vacateReason, setVacateReason] = useState('Plan expired / Left hostel');
  const [search, setSearch]     = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [saving, setSaving]     = useState(false);
  const printMemberRef = useRef();
  const printRulesRef  = useRef();
  const toast = useToast();

  const [allMembers, setAllMembers] = useState([]); // full list for fuzzy search

  const loadActive = useCallback((p = 1, s = search, r = roomFilter) => {
    const params = { page: 1, limit: 500 }; // load all for fuzzy
    if (r) params.room = r;
    membersAPI.getAll(params).then(res => {
      const data = res.data?.data || [];
      setAllMembers(data);
      setTotal(res.data?.total || data.length);
    });
  }, [search, roomFilter]);

  const loadArchived = useCallback((p = 1, s = search) => {
    const params = { page: p, limit: PAGE_SIZE };
    if (s) params.search = s;
    membersAPI.getArchived(params).then(res => {
      setArchived(res.data?.data || []);
      setArchivedTotal(res.data?.total || 0);
    });
  }, [search]);

  useEffect(() => { loadActive(1); }, [hostelSwitchCount]);
  useEffect(() => { loadArchived(1); }, []);

  // F1: Fuzzy search on client-side loaded members
  const fuzzyMembers = useMemo(() => {
    if (!search.trim()) return allMembers;
    const fuse = new Fuse(allMembers, {
      keys: ['name', 'mobileNo', 'aadharNumber', 'fathersName'],
      threshold: 0.35,
      ignoreLocation: true,
    });
    return fuse.search(search).map(r => r.item);
  }, [allMembers, search]);

  // Paginate fuzzy results
  const members = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return fuzzyMembers.slice(start, start + PAGE_SIZE);
  }, [fuzzyMembers, page]);

  const computedTotal = search ? fuzzyMembers.length : total;

  const handleSearch = (val) => {
    setSearch(val); setPage(1); setArchivedPage(1);
    loadActive(1, val, roomFilter);
    loadArchived(1, val);
  };

  const handleRoomFilter = (val) => {
    setRoomFilter(val); setPage(1);
    loadActive(1, search, val);
  };

  const open = (m = null) => {
    setEditing(m);
    setForm(m ? { ...m, admissionDate: m.admissionDate ? m.admissionDate.split('T')[0] : '', memberIdNumber: m.memberIdNumber || '' } : EMPTY);
    setShowModal(true);
  };

  const setF = (k) => (v) => setForm(p => ({ ...p, [k]: v }));
  const F    = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({ ...p, [k]: e.target.value })) });

  const save = async () => {
    if (!form.name || !form.mobileNo || !form.aadharNumber) { toast('Name, Mobile, and Aadhar are required', 'error'); return; }
    if (validateMobile(form.mobileNo)) { toast(validateMobile(form.mobileNo), 'error'); return; }
    if (form.fathersMobileNo && validateMobile(form.fathersMobileNo)) { toast("Father's: " + validateMobile(form.fathersMobileNo), 'error'); return; }
    if (validateAadhar(form.aadharNumber)) { toast(validateAadhar(form.aadharNumber), 'error'); return; }
    setSaving(true);
    try {
      if (editing) await membersAPI.update(editing._id, form);
      else await membersAPI.create(form);
      toast(editing ? 'Member updated' : 'Member registered');
      setShowModal(false);
      loadActive(page);
    } catch(e) {
      // F2: Handle duplicate detection
      if (e.response?.status === 409 && e.response?.data?.duplicate) {
        const dup = e.response.data.existingMember;
        const confirm = window.confirm(
          `⚠️ Possible duplicate detected!\n\nExisting member: "${dup.name}" (${dup.mobileNo})\n\nDo you want to register anyway?`
        );
        if (confirm) {
          try {
            await membersAPI.create({ ...form, forceSave: true });
            toast('Member registered (duplicate override)');
            setShowModal(false);
            loadActive(page);
          } catch(e2) { toast(e2.response?.data?.message || 'Error saving member', 'error'); }
        }
      } else {
        toast(e.response?.data?.message || 'Error saving member', 'error');
      }
    }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!window.confirm('Permanently delete this member? Use Vacate to keep their data.')) return;
    try { await membersAPI.delete(id); toast('Member deleted'); loadActive(page); }
    catch(e) { toast(e.response?.data?.message || 'Error', 'error'); }
  };

  const handleVacate = async () => {
    if (!showVacateModal) return;
    try {
      await membersAPI.vacate(showVacateModal._id, vacateReason);
      toast(`${showVacateModal.name} vacated and archived`);
      setShowVacateModal(null);
      loadActive(1); loadArchived(1); setPage(1);
    } catch(e) { toast(e.response?.data?.message || 'Error', 'error'); }
  };

  const handleRestore = async (id, name) => {
    if (!window.confirm(`Restore ${name}?`)) return;
    try { await membersAPI.restoreArchived(id); toast(`${name} restored`); loadActive(1); loadArchived(archivedPage); }
    catch(e) { toast(e.response?.data?.message || 'Error', 'error'); }
  };

  const handleDeleteArchived = async (id, name) => {
    if (!window.confirm(`Permanently delete ${name}?`)) return;
    try { await membersAPI.deleteArchived(id); toast('Deleted'); loadArchived(archivedPage); }
    catch(e) { toast('Error', 'error'); }
  };

  const doPrint = (ref) => {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Print</title>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:"Noto Sans","Noto Sans Devanagari",sans-serif;color:#111;font-size:11.5px;}
        @media print{@page{margin:6mm;size:A4;}body{padding:0;}}
      </style></head><body>`);
    w.document.write(ref.current.innerHTML);
    w.document.write('</body></html>');
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  const totalPages = Math.ceil(computedTotal / PAGE_SIZE);
  const archivedTotalPages = Math.ceil(archivedTotal / PAGE_SIZE);
  const inputStyle = { width:'100%', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:6, padding:'9px 12px', color:'var(--text)', outline:'none', fontSize:'0.88rem' };

  return (
    <div>
      <div className="page-header">
        <div><h2>Member Registration</h2><p>{total} active · {archivedTotal} archived</p></div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <button className="btn btn-secondary" onClick={() => setShowRules(true)}>📜 Rules</button>
          {tab === 'active' && <button className="btn btn-primary" onClick={() => open()}>+ Register Member</button>}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab==='active'?'active':''}`} onClick={() => setTab('active')}>Active ({total})</button>
        <button className={`tab ${tab==='archived'?'active':''}`} onClick={() => setTab('archived')}>🗂 Archived ({archivedTotal})</button>
      </div>

      <div className="card" style={{marginBottom:14,display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
        <input style={{...inputStyle,flex:2,minWidth:200}} placeholder="Search by name, mobile, room, aadhar, member ID..."
          value={search} onChange={e => handleSearch(e.target.value)} />
        <select style={{...inputStyle,flex:1,minWidth:130}} value={roomFilter} onChange={e => handleRoomFilter(e.target.value)}>
          <option value="">All Rooms</option>
          {Array.from({length:50},(_,i)=>i+1).map(n=><option key={n} value={n}>Room {n}</option>)}
        </select>
        {(search || roomFilter) && (
          <button className="btn btn-secondary btn-xs" onClick={() => { setSearch(''); setRoomFilter(''); loadActive(1,'',''); }}>✕ Clear</button>
        )}
      </div>

      {tab === 'active' && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Name</th><th>Mobile</th><th>Occupation</th><th>Room</th><th>Actions</th></tr></thead>
              <tbody>
                {members.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">👥</div><p>No members found</p></div></td></tr>
                ) : members.map(m => (
                  <tr key={m._id}>
                    <td style={{fontFamily:'monospace',color:'var(--accent)',fontSize:'0.78rem'}}>{m.memberId||'—'}</td>
                    <td style={{color:'var(--text)',fontWeight:500}}>{m.name}</td>
                    <td style={{fontFamily:'monospace'}}>{m.mobileNo}</td>
                    <td style={{color:'var(--text3)',fontSize:'0.82rem'}}>{m.studentOccupation||'—'}</td>
                    <td>{m.roomNumber ? <span className="badge badge-blue">R{m.roomNumber}</span> : <span style={{color:'var(--text3)'}}>—</span>}</td>
                    <td>
                      <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                        <button className="btn btn-success btn-xs" onClick={() => setShowPrintMember(m)} title="Print">🖨</button>
                        {m.mobileNo && <button style={{background:'#25d366',color:'white',border:'none',borderRadius:5,padding:'3px 7px',cursor:'pointer',fontSize:'0.72rem',fontWeight:700}} onClick={() => wa.sendCustom(m.mobileNo,`नमस्ते ${m.name} जी,\n\nआपकी होस्टल जानकारी के लिए संपर्क करें।\n\nधन्यवाद 🙏`)} title="WhatsApp">📱</button>}
                        <button className="btn btn-secondary btn-xs" onClick={() => open(m)}>Edit</button>
                        <button className="btn btn-xs" style={{background:'rgba(243,156,18,0.15)',color:'#f39c12',border:'1px solid rgba(243,156,18,0.3)'}} onClick={() => { setShowVacateModal(m); setVacateReason('Plan expired / Left hostel'); }}>📦 Vacate</button>
                        <button className="btn btn-danger btn-xs" onClick={() => del(m._id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:16,alignItems:'center',flexWrap:'wrap'}}>
              <button className="btn btn-secondary btn-xs" disabled={page===1} onClick={() => { setPage(1); loadActive(1); }}>«</button>
              <button className="btn btn-secondary btn-xs" disabled={page===1} onClick={() => { setPage(p=>p-1); loadActive(page-1); }}>‹ Prev</button>
              <span style={{color:'var(--text3)',fontSize:'0.82rem'}}>Page {page} of {totalPages} · {total} members</span>
              <button className="btn btn-secondary btn-xs" disabled={page===totalPages} onClick={() => { setPage(p=>p+1); loadActive(page+1); }}>Next ›</button>
              <button className="btn btn-secondary btn-xs" disabled={page===totalPages} onClick={() => { setPage(totalPages); loadActive(totalPages); }}>»</button>
            </div>
          )}
        </div>
      )}

      {tab === 'archived' && (
        <div className="card" style={{border:'1px solid rgba(243,156,18,0.25)'}}>
          <div style={{marginBottom:12,padding:'10px 12px',background:'rgba(243,156,18,0.06)',borderRadius:6,fontSize:'0.82rem',color:'var(--text2)'}}>
            🗂 <strong style={{color:'var(--accent)'}}>Archive</strong> — Vacated members. Their data is preserved. Restore or delete permanently.
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Mobile</th><th>Room Was</th><th>Vacated</th><th>Reason</th><th>Actions</th></tr></thead>
              <tbody>
                {archived.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty-state"><div className="empty-icon">🗂</div><p>No archived members</p></div></td></tr>
                ) : archived.map(m => (
                  <tr key={m._id}>
                    <td style={{fontWeight:500}}>{m.name}</td>
                    <td style={{fontFamily:'monospace',fontSize:'0.82rem'}}>{m.mobileNo}</td>
                    <td>{m.roomNumber ? `Room ${m.roomNumber}` : '—'}</td>
                    <td style={{fontSize:'0.8rem',color:'var(--text3)'}}>{m.vacatedOn ? new Date(m.vacatedOn).toLocaleDateString('en-IN') : '—'}</td>
                    <td style={{fontSize:'0.78rem',color:'var(--text3)'}}>{m.vacatedReason||'—'}</td>
                    <td>
                      <div style={{display:'flex',gap:5}}>
                        <button className="btn btn-success btn-xs" onClick={() => handleRestore(m._id,m.name)}>↩ Restore</button>
                        <button className="btn btn-danger btn-xs" onClick={() => handleDeleteArchived(m._id,m.name)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {archivedTotalPages > 1 && (
            <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:14,alignItems:'center',flexWrap:'wrap'}}>
              <button className="btn btn-secondary btn-xs" disabled={archivedPage===1} onClick={() => { setArchivedPage(p=>p-1); loadArchived(archivedPage-1); }}>‹ Prev</button>
              <span style={{color:'var(--text3)',fontSize:'0.82rem'}}>Page {archivedPage} of {archivedTotalPages} · {archivedTotal} records</span>
              <button className="btn btn-secondary btn-xs" disabled={archivedPage===archivedTotalPages} onClick={() => { setArchivedPage(p=>p+1); loadArchived(archivedPage+1); }}>Next ›</button>
            </div>
          )}
        </div>
      )}

      {/* Vacate Modal */}
      {showVacateModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowVacateModal(null)}>
          <div className="modal" style={{maxWidth:440}}>
            <div className="modal-header"><h3>📦 Vacate Member</h3><button className="close-btn" onClick={()=>setShowVacateModal(null)}>✕</button></div>
            <div className="modal-body">
              <div style={{background:'rgba(243,156,18,0.08)',border:'1px solid rgba(243,156,18,0.25)',borderRadius:8,padding:'14px',marginBottom:16}}>
                <div style={{fontWeight:600,color:'var(--text)'}}>{showVacateModal.name}</div>
                <div style={{fontSize:'0.82rem',color:'var(--text2)',marginTop:2}}>{showVacateModal.mobileNo} · {showVacateModal.roomNumber ? `Room ${showVacateModal.roomNumber}` : 'No room'}</div>
              </div>
              <p style={{color:'var(--text2)',fontSize:'0.85rem',marginBottom:14}}>This will <strong style={{color:'var(--accent)'}}>move to Archive</strong> and free up their room.</p>
              <div className="form-group">
                <label>Reason for Vacating</label>
                <select value={vacateReason} onChange={e=>setVacateReason(e.target.value)} style={inputStyle}>
                  <option>Plan expired / Left hostel</option>
                  <option>Non-payment of rent</option>
                  <option>Rule violation</option>
                  <option>Personal reasons</option>
                  <option>Transfer / Relocation</option>
                  <option>Other</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowVacateModal(null)}>Cancel</button>
              <button className="btn btn-xs" style={{background:'rgba(243,156,18,0.2)',color:'#f39c12',border:'1px solid rgba(243,156,18,0.4)',padding:'10px 20px',borderRadius:6,fontFamily:'Rajdhani',fontWeight:700,fontSize:'0.95rem',cursor:'pointer'}} onClick={handleVacate}>
                📦 Confirm Vacate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>{editing ? 'Edit Member' : 'Register New Member'}</h3>
              <button className="close-btn" onClick={()=>setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="section-divider">Personal Information</div>
                <div className="form-group"><label>Member ID Number</label><input {...F('memberIdNumber')} type="number" placeholder="e.g. 1, 2, 3" /></div>
                <div className="form-group"><label>Full Name *</label><input {...F('name')} placeholder="Enter full name" /></div>
                <MobileInput label="Mobile No." value={form.mobileNo} onChange={setF('mobileNo')} required />
                <AadharInput value={form.aadharNumber} onChange={setF('aadharNumber')} />
                <div className="form-group"><label>Student / Occupation</label><input {...F('studentOccupation')} placeholder="e.g. B.Com 2nd Year" /></div>
                <div className="form-group"><label>Admission Date</label><input {...F('admissionDate')} type="date" /></div>
                <div className="form-group full"><label>Permanent Address</label><textarea {...F('permanentAddress')} rows={2} style={{resize:'vertical',width:'100%',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'9px 12px',color:'var(--text)',outline:'none',fontSize:'0.88rem'}} /></div>
                <div className="section-divider">Father's Details</div>
                <div className="form-group"><label>Father's Name</label><input {...F('fathersName')} /></div>
                <MobileInput label="Father's Mobile" value={form.fathersMobileNo} onChange={setF('fathersMobileNo')} />
                <div className="form-group"><label>Father's Occupation</label><input {...F('fathersOccupation')} /></div>
                <div className="section-divider">Permanent Address Relative</div>
                <div className="form-group"><label>Name</label><input {...F('permanentAddressRelativeName')} /></div>
                <MobileInput label="Mobile" value={form.permanentAddressRelativeMobile} onChange={setF('permanentAddressRelativeMobile')} />
                <div className="form-group full"><label>Address</label><textarea {...F('permanentAddressRelativeAddress')} rows={2} style={{resize:'vertical',width:'100%',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'9px 12px',color:'var(--text)',outline:'none',fontSize:'0.88rem'}} /></div>
                <div className="section-divider">Local Relative</div>
                <div className="form-group"><label>Name</label><input {...F('localRelativeName')} /></div>
                <MobileInput label="Mobile" value={form.localRelativeMobile} onChange={setF('localRelativeMobile')} />
                <div className="form-group full"><label>Address</label><textarea {...F('localRelativeAddress')} rows={2} style={{resize:'vertical',width:'100%',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:6,padding:'9px 12px',color:'var(--text)',outline:'none',fontSize:'0.88rem'}} /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '⏳ Saving...' : editing ? 'Update' : 'Register'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Print Member Modal */}
      {showPrintMember && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowPrintMember(null)}>
          <div className="modal" style={{maxWidth:700}}>
            <div className="modal-header"><h3>Member Form — {showPrintMember.name}</h3><button className="close-btn" onClick={()=>setShowPrintMember(null)}>✕</button></div>
            <div className="modal-body" style={{background:'white',padding:0}}><div ref={printMemberRef}><MemberPrintCard member={showPrintMember} /></div></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowPrintMember(null)}>Close</button>
              <button className="btn btn-primary" onClick={()=>doPrint(printMemberRef)}>🖨 Print / PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* Rules Modal */}
      {showRules && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowRules(false)}>
          <div className="modal" style={{maxWidth:680}}>
            <div className="modal-header"><h3>हॉस्टल नियम</h3><button className="close-btn" onClick={()=>setShowRules(false)}>✕</button></div>
            <div className="modal-body" style={{background:'white'}}><div ref={printRulesRef}><RulesPrintCard /></div></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setShowRules(false)}>Close</button>
              <button className="btn btn-primary" onClick={()=>doPrint(printRulesRef)}>🖨 Print</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MEMBER PRINT CARD — fits on ONE A4 page
   Changes:
   • Removed Due Date from top bar
   • Member ID + Admission Date shifted left (now positions 2 & 3, right of Room No.)
   • Added Police Verification Date + Hostel Leaving Date boxes (blank for pen)
   • Tighter spacing throughout — guaranteed single page
───────────────────────────────────────────────────────────────────────────── */
function MemberPrintCard({ member }) {
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';

  const row = (label, value, highlight=false) => (
    <div style={{display:'flex',borderBottom:'1px solid #e8e8e8',padding:'4px 0',fontSize:'11.5px',gap:6}}>
      <span style={{minWidth:195,color:'#555',fontWeight:600,flexShrink:0,fontSize:'11px'}}>{label}</span>
      <span style={{color: highlight ? '#111' : '#222',fontWeight: highlight?700:400}}>{value||'—'}</span>
    </div>
  );

  return (
    <div style={{fontFamily:'"Noto Sans","Noto Sans Devanagari",sans-serif',color:'#111',padding:'12px 16px',background:'white'}}>

      {/* ── Header: Title + Photo ── */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,paddingBottom:7,borderBottom:'2.5px solid #111'}}>
        <div>
          <div style={{fontSize:'1.25rem',fontWeight:800,letterSpacing:1.5,lineHeight:1}}>HOSTEL MANAGER</div>
          <div style={{fontSize:'9.5px',color:'#666',marginTop:3,letterSpacing:'0.06em'}}>किरायेदार पंजीकरण फॉर्म / Member Registration Form</div>
        </div>
        <div style={{width:72,height:88,border:'2px dashed #bbb',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',color:'#bbb',fontSize:'9px',textAlign:'center',borderRadius:3,flexShrink:0,marginLeft:10}}>
          <div style={{fontSize:'16px'}}>📷</div><div style={{marginTop:2}}>Paste Photo</div>
        </div>
      </div>

      {/* ── KEY INFO BAR: Room | Member ID | Admission Date | Police Verif. Date | Leaving Date ── */}
      <div style={{display:'grid',gridTemplateColumns:'0.8fr 1.1fr 1.1fr 1.1fr 1.1fr',gap:0,marginBottom:10,border:'2px solid #111',borderRadius:5,overflow:'hidden'}}>
        {/* 1. Room No */}
        <div style={{padding:'7px 9px',borderRight:'1px solid #ddd',background:'#f5f5f5'}}>
          <div style={{fontSize:'8.5px',color:'#888',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:2}}>Room No.</div>
          <div style={{fontSize:'1.5rem',fontWeight:900,color:'#111',fontFamily:'Rajdhani,sans-serif',lineHeight:1}}>
            {member.roomNumber ? `R${member.roomNumber}` : '—'}
          </div>
        </div>
        {/* 2. Member ID */}
        <div style={{padding:'7px 9px',borderRight:'1px solid #ddd',background:'#fff9e6'}}>
          <div style={{fontSize:'8.5px',color:'#888',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:2}}>Member ID</div>
          <div style={{fontSize:'1rem',fontWeight:900,color:'#b8860b',fontFamily:'monospace',letterSpacing:1,lineHeight:1.2}}>
            {member.memberId || '—'}
          </div>
        </div>
        {/* 3. Admission Date */}
        <div style={{padding:'7px 9px',borderRight:'1px solid #ddd',background:'#fff9e6'}}>
          <div style={{fontSize:'8.5px',color:'#888',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:2}}>Admission Date</div>
          <div style={{fontSize:'0.82rem',fontWeight:700,color:'#b8860b',lineHeight:1.2}}>
            {member.admissionDate ? fmtDate(member.admissionDate) : '—'}
          </div>
        </div>
        {/* 4. Police Verification Date — always blank for pen */}
        <div style={{padding:'7px 9px',borderRight:'1px solid #ddd',background:'#f0f8ff'}}>
          <div style={{fontSize:'8.5px',color:'#888',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:2}}>Police Verif. Date</div>
          <div style={{fontSize:'0.78rem',color:'#bbb',borderBottom:'1px dashed #bbb',minHeight:22,marginTop:4}}>
          </div>
        </div>
        {/* 5. Hostel Leaving Date — always blank for pen */}
        <div style={{padding:'7px 9px',background:'#fff5f5'}}>
          <div style={{fontSize:'8.5px',color:'#888',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:2}}>Hostel Leaving Date</div>
          <div style={{fontSize:'0.78rem',color:'#bbb',borderBottom:'1px dashed #bbb',minHeight:22,marginTop:4}}>
          </div>
        </div>
      </div>

      {/* ── Personal Details ── */}
      <div style={{fontWeight:700,fontSize:'9.5px',textTransform:'uppercase',letterSpacing:'0.08em',color:'#444',margin:'7px 0 4px',paddingBottom:2,borderBottom:'1px solid #ddd'}}>
        Personal Information
      </div>
      {row('Name / नाम', member.name, true)}
      {row('Mobile / मोबाइल', member.mobileNo)}
      {row('Aadhar / आधार', member.aadharNumber)}
      {row('Occupation / व्यवसाय', member.studentOccupation)}
      {row('Permanent Address / स्थायी पता', member.permanentAddress)}

      <div style={{fontWeight:700,fontSize:'9.5px',textTransform:'uppercase',letterSpacing:'0.08em',color:'#444',margin:'7px 0 4px',paddingBottom:2,borderBottom:'1px solid #ddd'}}>
        Father's Details / पिता की जानकारी
      </div>
      {row("Father's Name / पिता का नाम", member.fathersName)}
      {row("Father's Mobile / मोबाइल", member.fathersMobileNo)}
      {row("Father's Occupation / व्यवसाय", member.fathersOccupation)}

      <div style={{fontWeight:700,fontSize:'9.5px',textTransform:'uppercase',letterSpacing:'0.08em',color:'#444',margin:'7px 0 4px',paddingBottom:2,borderBottom:'1px solid #ddd'}}>
        Permanent Address Relative / स्थायी पते का परिचित
      </div>
      {row('Name / नाम', member.permanentAddressRelativeName)}
      {row('Mobile / मोबाइल', member.permanentAddressRelativeMobile)}
      {row('Address / पता', member.permanentAddressRelativeAddress)}

      <div style={{fontWeight:700,fontSize:'9.5px',textTransform:'uppercase',letterSpacing:'0.08em',color:'#444',margin:'7px 0 4px',paddingBottom:2,borderBottom:'1px solid #ddd'}}>
        Local Relative / स्थानीय परिचित
      </div>
      {row('Name / नाम', member.localRelativeName)}
      {row('Mobile / मोबाइल', member.localRelativeMobile)}
      {row('Address / पता', member.localRelativeAddress)}

      <div style={{fontWeight:700,fontSize:'9.5px',textTransform:'uppercase',letterSpacing:'0.08em',color:'#444',margin:'7px 0 4px',paddingBottom:2,borderBottom:'1px solid #ddd'}}>
        Room Details / कमरे की जानकारी
      </div>
      {row('Monthly Rent / किराया', member.rent ? `₹${Number(member.rent).toLocaleString('en-IN')}` : '—')}
      {row('Advance / एडवांस', member.advance ? `₹${Number(member.advance).toLocaleString('en-IN')}` : '—')}
      {row('Join Date / प्रवेश दिनांक', member.roomJoinDate ? fmtDate(member.roomJoinDate) : '—')}

      {/* ── Signatures ── */}
      <div style={{display:'flex',justifyContent:'space-between',marginTop:18,paddingTop:12,borderTop:'1px solid #ddd'}}>
        <div style={{textAlign:'center',width:'45%'}}>
          <div style={{borderTop:'1px solid #333',paddingTop:6,fontSize:'10.5px',color:'#555'}}>
            किरायेदार के हस्ताक्षर<br/><span style={{fontSize:'10px'}}>(Tenant Signature)</span>
          </div>
        </div>
        <div style={{textAlign:'center',width:'45%'}}>
          <div style={{borderTop:'1px solid #333',paddingTop:6,fontSize:'10.5px',color:'#555'}}>
            मकान मालिक के हस्ताक्षर<br/><span style={{fontSize:'10px'}}>(Owner Signature)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RulesPrintCard() {
  const rules = ['हॉस्टल का किराया 1 तारीख से 5 तारीख तक जमा करें। अन्यथा 50/- रु. प्रतिदिन जुर्माना होगा।','किरायेदार को दिए गए कमरे पर ही रहना होगा, कमरा बदल नहीं सकते।','हॉस्टल में बिना अनुमति किसी भी महिला का प्रवेश निषेध है।','कमरे के अंदर, बाहर या हॉस्टल से संबंधित क्षेत्र में धूम्रपान, मदिरा या मांस का सेवन निषेध है।','कमरे में दोस्त, रिश्तेदार या अन्य किसी भी व्यक्ति का रात्रि विश्राम हेतु प्रवेश निषेध है। अन्यथा 250/- रु. प्रतिदिन।','हॉस्टल से संबंधित किसी भी सामान को नुकसान नहीं पहुँचाएं।','कूलर, पंखा, टी.वी., फ्रिज, मोबाइल चार्जर एवं बिजली के उपकरण का प्रयोग निषेध है।','कमरे की साफ-सफाई का ध्यान रखना होगा।','हॉस्टल में खाना बनाने पर रविवार को सफाई करनी होगी।','हॉस्टल में शांति 10:30 बजे के पश्चात बनाए रखें।','कमरे में आवश्यकता अनुसार ही बिजली एवं पानी का उपयोग करें।','अपने सामान की सुरक्षा स्वयं करें।'];
  return (
    <div style={{fontFamily:'"Noto Sans Devanagari","Noto Sans",sans-serif',color:'#111',padding:'24px',background:'white',lineHeight:1.9,fontSize:'13.5px'}}>
      <div style={{textAlign:'center',fontWeight:700,fontSize:'1.2rem',marginBottom:20,borderBottom:'2px solid #111',paddingBottom:10}}>हॉस्टल नियम एवं शर्तें</div>
      <ol style={{paddingLeft:20}}>{rules.map((r,i)=><li key={i} style={{marginBottom:4}}>{r}</li>)}</ol>
      <div style={{marginTop:24,padding:'16px',border:'1px solid #333',borderRadius:4}}>
        <div style={{fontWeight:700,marginBottom:8}}>घोषणा पत्र</div>
        <p>मैं ………………………………………… यह घोषणा करता हूँ कि मेरे द्वारा हॉस्टल के उपरोक्त सभी नियम पढ़ कर समझ लिये गए हैं।</p>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:32}}>
        <div>दिनांक : ……/……/20……</div>
        <div>हस्ताक्षर : …………………………</div>
      </div>
    </div>
  );
}
