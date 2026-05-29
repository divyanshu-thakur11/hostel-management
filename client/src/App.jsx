import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { ToastProvider, useToast } from './context/ToastContext';
import useAutoLogout from './hooks/useAutoLogout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Rooms from './pages/Rooms';
import Members from './pages/Members';
import RoomDetails from './pages/RoomDetails';
import Receipts from './pages/Receipts';
import Electric from './pages/Electric';
import PoliceVerification from './pages/PoliceVerification';
import FinalBilling from './pages/FinalBilling';
import Reports from './pages/Reports';
import Salary from './pages/Salary';
import Managers from './pages/Managers';
import Hostels from './pages/Hostels';
import Notifications from './pages/Notifications';
import AuditLog from './pages/AuditLog';
import DuesAndPayments from './pages/DuesAndPayments';
import { authAPI, hostelAPI, notificationsAPI } from './utils/api';
import { HostelProvider, useHostel } from './context/HostelContext';
import ForceChangePassword from './pages/ForceChangePassword';

const OWNER_NAV = [
  { path: '/',             label: 'Dashboard',       icon: '📊' },
  { path: '/hostels',      label: 'Hostels',          icon: '🏠' },
  { path: '/rooms',        label: 'Rooms',            icon: '🚪' },
  { path: '/members',      label: 'Members',          icon: '👥' },
  { path: '/room-details', label: 'Room Details',     icon: '📋' },
  { path: '/receipts',     label: 'Receipts',         icon: '🧾' },
  { path: '/final-billing',label: 'Final Billing',    icon: '📑' },
  { path: '/electric',     label: 'Electric',         icon: '⚡' },
  { path: '/dues',         label: 'Dues & Payments',  icon: '⚠️' },
  { path: '/police',       label: 'Police Form',      icon: '🚔' },
  { path: '/reports',      label: 'Reports & Export', icon: '📈' },
  { path: '/salary',       label: 'Salary',           icon: '💰' },
  { path: '/audit',        label: 'Audit Log',        icon: '🔍' },
  { path: '/managers',     label: 'Managers',         icon: '👨‍💼' },
];

const MANAGER_NAV = [
  { path: '/',             label: 'Dashboard',      icon: '📊' },
  { path: '/rooms',        label: 'Rooms',          icon: '🚪' },
  { path: '/members',      label: 'Members',        icon: '👥' },
  { path: '/room-details', label: 'Room Details',   icon: '📋' },
  { path: '/receipts',     label: 'Receipts',       icon: '🧾' },
  { path: '/final-billing',label: 'Final Billing',  icon: '📑' },
  { path: '/electric',     label: 'Electric',       icon: '⚡' },
  { path: '/dues',         label: 'Dues & Payments',icon: '⚠️' },
  { path: '/police',       label: 'Police Form',    icon: '🚔' },
  { path: '/managers',     label: 'My Account',     icon: '🔑' },
];

function Sidebar({ user, activeHostel, unreadCount, sidebarOpen, onClose, onLogout, onSwitchRole, onHostelSwitch }) {
  const location = useLocation();
  const navigate = useNavigate();
  const nav = user?.role === 'owner' ? OWNER_NAV : MANAGER_NAV;
  const isOwner = user?.role === 'owner';
  const [showSwitch, setShowSwitch] = useState(false);
  const [switchForm, setSwitchForm] = useState({ username: '', password: '' });
  const [switchError, setSwitchError] = useState('');
  const [switchLoading, setSwitchLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [hostels, setHostels] = useState([]);
  const [showHostelPicker, setShowHostelPicker] = useState(false);
  const targetRole = isOwner ? 'manager' : 'owner';

  useEffect(() => {
    if (isOwner) hostelAPI.getAll().then(r => setHostels(r.data || [])).catch(() => {});
  }, [isOwner]);

  const go = (path) => { navigate(path); onClose(); };

  const handleSwitch = async (e) => {
    e.preventDefault(); setSwitchError(''); setSwitchLoading(true);
    try {
      const res = await authAPI.login(switchForm);
      const { user: newUser, requirePasswordChange } = res.data;
      if (newUser.role !== targetRole) { setSwitchError(`Not a ${targetRole} account.`); setSwitchLoading(false); return; }
      localStorage.setItem('hm_user', JSON.stringify(newUser));
      setShowSwitch(false); setSwitchForm({ username: '', password: '' });
      navigate('/'); onSwitchRole(newUser); onClose();
    } catch(err) { setSwitchError(err.response?.data?.message || 'Login failed.'); }
    finally { setSwitchLoading(false); }
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div className={`sidebar-backdrop ${sidebarOpen ? 'open' : ''}`} onClick={onClose} />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <h1>HOSTEL<br/>MANAGER</h1>
            <p>v9 Pro</p>
          </div>
        </div>

        {/* Active hostel */}
        {isOwner && activeHostel && (
          <div style={{ padding:'0 10px 8px' }}>
            <button onClick={() => setShowHostelPicker(true)} style={{ width:'100%', textAlign:'left', background:'rgba(240,165,0,0.06)', border:'1px solid rgba(240,165,0,0.2)', borderRadius:7, padding:'6px 10px', cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:'0.85rem' }}>🏠</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:'0.65rem', color:'var(--accent)', fontWeight:700, fontFamily:'Rajdhani', letterSpacing:1 }}>ACTIVE HOSTEL</div>
                <div style={{ fontSize:'0.7rem', color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{activeHostel.name}</div>
              </div>
              <span style={{ fontSize:'0.6rem', color:'var(--text3)' }}>▼</span>
            </button>
          </div>
        )}

        {/* Role badge */}
        <div style={{ padding:'0 10px 6px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:6, background: isOwner ? 'rgba(240,165,0,0.08)' : 'rgba(52,152,219,0.08)', border:`1px solid ${isOwner ? 'rgba(240,165,0,0.2)' : 'rgba(52,152,219,0.2)'}` }}>
            <span style={{ fontSize:'0.85rem' }}>{isOwner ? '👑' : '👨‍💼'}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:'0.65rem', fontWeight:700, color: isOwner ? 'var(--accent)' : 'var(--info)', fontFamily:'Rajdhani', textTransform:'uppercase', letterSpacing:1 }}>{user?.role}</div>
              <div style={{ fontSize:'0.65rem', color:'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.name}</div>
            </div>
            <button onClick={() => { setShowSwitch(true); setSwitchError(''); setSwitchForm({ username:'', password:'' }); }}
              style={{ background: isOwner ? 'rgba(52,152,219,0.12)' : 'rgba(240,165,0,0.12)', border:`1px solid ${isOwner ? 'rgba(52,152,219,0.3)' : 'rgba(240,165,0,0.3)'}`, borderRadius:5, padding:'2px 6px', cursor:'pointer', fontSize:'0.62rem', fontWeight:700, color: isOwner ? 'var(--info)' : 'var(--accent)', fontFamily:'Rajdhani', flexShrink:0 }}>
              Switch
            </button>
          </div>
        </div>

        {/* Notification bell */}
        <div style={{ padding:'0 10px 4px' }}>
          <button onClick={() => go('/notifications')} style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:6, background: unreadCount > 0 ? 'rgba(231,76,60,0.08)' : 'transparent', border:`1px solid ${unreadCount > 0 ? 'rgba(231,76,60,0.2)' : 'var(--border)'}`, cursor:'pointer', color: unreadCount > 0 ? 'var(--danger)' : 'var(--text3)', fontFamily:'Rajdhani', fontWeight:600, fontSize:'0.78rem' }}>
            <span>{unreadCount > 0 ? '🔔' : '🔕'}</span>
            <span>{unreadCount > 0 ? `${unreadCount} new` : 'Notifications'}</span>
          </button>
        </div>

        <nav className="sidebar-nav">
          {nav.map(n => (
            <button key={n.path} className={`nav-item ${location.pathname === n.path ? 'active' : ''}`} onClick={() => go(n.path)}>
              <span className="nav-icon">{n.icon}</span><span>{n.label}</span>
            </button>
          ))}
        </nav>

        <div style={{ padding:'10px', borderTop:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:6 }}>
          <ThemeToggle />
          <button onClick={onLogout} style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.2)', color:'var(--danger)', borderRadius:6, padding:'7px', cursor:'pointer', fontSize:'0.78rem', fontWeight:600, fontFamily:'Rajdhani', width:'100%' }}>
            🚪 Logout
          </button>
        </div>
      </aside>

      {/* Switch Role Modal */}
      {showSwitch && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000, padding:20 }} onClick={e => e.target===e.currentTarget && setShowSwitch(false)}>
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'26px', maxWidth:360, width:'100%' }}>
            <div style={{ textAlign:'center', marginBottom:18 }}>
              <div style={{ fontSize:'1.8rem', marginBottom:6 }}>{targetRole==='owner'?'👑':'👨‍💼'}</div>
              <h3 style={{ fontFamily:'Rajdhani', fontSize:'1.1rem', color:'var(--text)' }}>Switch to {targetRole==='owner'?'Owner':'Manager'}</h3>
            </div>
            {switchError && <div style={{ background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:6, padding:'10px', marginBottom:12, color:'var(--danger)', fontSize:'0.82rem' }}>⚠️ {switchError}</div>}
            <form onSubmit={handleSwitch}>
              <div className="form-group" style={{ marginBottom:10 }}><label>Username</label><input value={switchForm.username} onChange={e => setSwitchForm(p=>({...p,username:e.target.value}))} autoFocus required /></div>
              <div className="form-group" style={{ marginBottom:18 }}>
                <label>Password</label>
                <div style={{ position:'relative' }}>
                  <input type={showPw?'text':'password'} value={switchForm.password} onChange={e => setSwitchForm(p=>({...p,password:e.target.value}))} required style={{ paddingRight:38 }} />
                  <button type="button" onClick={() => setShowPw(s=>!s)} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:'0.95rem', padding:0 }}>{showPw?'🙈':'👁️'}</button>
                </div>
              </div>
              <div style={{ display:'flex', gap:10 }}>
                <button type="button" onClick={() => setShowSwitch(false)} style={{ flex:1, padding:'9px', borderRadius:7, border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text2)', cursor:'pointer', fontFamily:'Rajdhani', fontWeight:600 }}>Cancel</button>
                <button type="submit" disabled={switchLoading} style={{ flex:1, padding:'9px', borderRadius:7, border:'none', background: targetRole==='owner'?'var(--accent)':'var(--info)', color: targetRole==='owner'?'#111':'white', cursor: switchLoading?'not-allowed':'pointer', fontFamily:'Rajdhani', fontWeight:700, opacity: switchLoading?0.7:1 }}>
                  {switchLoading ? '⏳' : `→ ${targetRole==='owner'?'Owner':'Manager'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hostel Picker */}
      {showHostelPicker && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000, padding:20 }} onClick={e => e.target===e.currentTarget && setShowHostelPicker(false)}>
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:14, padding:'22px', maxWidth:360, width:'100%' }}>
            <h3 style={{ fontFamily:'Rajdhani', fontSize:'1.05rem', color:'var(--text)', marginBottom:14 }}>🏠 Switch Hostel</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:300, overflowY:'auto' }}>
              {hostels.map(h => (
                <button key={h._id} onClick={() => { localStorage.setItem('hm_hostel_id',h._id); setShowHostelPicker(false); onHostelSwitch(h); onClose(); }} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px', borderRadius:8, cursor:'pointer', textAlign:'left', background: h._id===activeHostel?._id?'rgba(240,165,0,0.1)':'var(--bg3)', border:`1px solid ${h._id===activeHostel?._id?'rgba(240,165,0,0.3)':'var(--border)'}` }}>
                  <span>🏠</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, color:'var(--text)', fontSize:'0.88rem' }}>{h.name}</div>
                    <div style={{ color:'var(--text3)', fontSize:'0.72rem' }}>{h.totalRooms} rooms · {h.city}</div>
                  </div>
                  {h._id===activeHostel?._id && <span style={{ color:'var(--accent)', fontWeight:700 }}>✓</span>}
                </button>
              ))}
            </div>
            <button onClick={() => setShowHostelPicker(false)} style={{ marginTop:12, width:'100%', padding:'8px', borderRadius:7, border:'1px solid var(--border)', background:'var(--bg3)', color:'var(--text2)', cursor:'pointer', fontFamily:'Rajdhani', fontWeight:600 }}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => localStorage.getItem('hm_theme') !== 'light');
  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem('hm_theme', next ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
  };
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, []);
  return (
    <button onClick={toggle} title={dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      style={{display:'flex',alignItems:'center',gap:7,width:'100%',padding:'8px 12px',border:'none',background:'none',cursor:'pointer',color:'var(--text3)',fontSize:'0.8rem',borderRadius:6,transition:'all 0.15s'}}
      onMouseEnter={e=>e.currentTarget.style.background='var(--bg3)'}
      onMouseLeave={e=>e.currentTarget.style.background='none'}>
      <span style={{fontSize:'1rem'}}>{dark ? '☀️' : '🌙'}</span>
      {dark ? 'Light Mode' : 'Dark Mode'}
    </button>
  );
}
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('hm_user')); } catch { return null; } });
  const [mustChangePw, setMustChangePw] = useState(false);
  const { activeHostel, loadHostel, switchHostel } = useHostel();
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toast = useToast();

  const doLogout = useCallback(async (reason) => {
    try { await authAPI.logout(); } catch(_) {}
    localStorage.removeItem('hm_user');
    setUser(null); setMustChangePw(false); setUnreadCount(0);
    if (reason === 'inactivity') toast('Logged out due to 2 hours of inactivity', 'error');
  }, [toast]);

  useAutoLogout(doLogout);

  const pollNotifications = useCallback(async () => {
    try {
      const res = await notificationsAPI.getAll({ unread:'true' });
      setUnreadCount(res.data?.unreadCount || 0);
    } catch(_) {}
  }, []);

  useEffect(() => {
    if (!user) return;
    loadHostel();
    pollNotifications();
    const iv = setInterval(pollNotifications, 5*60*1000);
    return () => clearInterval(iv);
  }, [user, loadHostel, pollNotifications]);

  const handleLogin       = (u, requirePasswordChange) => { setUser(u); if (requirePasswordChange) setMustChangePw(true); };
  const handleSwitchRole  = (newUser) => { setUser(newUser); loadHostel(); };
  const handleHostelSwitch = (h) => switchHostel(h);

  if (!user) return <Login onLogin={handleLogin} />;
  if (mustChangePw) return <ForceChangePassword user={user} onDone={() => setMustChangePw(false)} />;

  return (
    <div className="app-shell">
      <Sidebar
        user={user} activeHostel={activeHostel} unreadCount={unreadCount}
        sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}
        onLogout={doLogout} onSwitchRole={handleSwitchRole} onHostelSwitch={handleHostelSwitch}
      />
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column' }}>
        {/* Mobile top bar */}
        <div className="mobile-topbar" style={{ display:'none' }}>
          <button className="menu-toggle" onClick={() => setSidebarOpen(s=>!s)}>☰</button>
          <span style={{ fontFamily:'Rajdhani', fontWeight:700, color:'var(--accent)', letterSpacing:2 }}>HOSTEL MANAGER</span>
          <button onClick={() => setSidebarOpen(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:'0.75rem', padding:0 }}>
            {unreadCount > 0 ? `🔔 ${unreadCount}` : ''}
          </button>
        </div>
        <main className="main-content">
          <Routes>
            <Route path="/"              element={<Dashboard />} />
            <Route path="/hostels"       element={user.role==='owner' ? <Hostels onHostelChange={handleHostelSwitch}/> : <Navigate to="/"/>} />
            <Route path="/rooms"         element={<Rooms />} />
            <Route path="/members"       element={<Members />} />
            <Route path="/room-details"  element={<RoomDetails />} />
            <Route path="/receipts"      element={<Receipts />} />
            <Route path="/final-billing" element={<FinalBilling />} />
            <Route path="/electric"      element={<Electric />} />
            <Route path="/dues"          element={<DuesAndPayments />} />
            <Route path="/police"        element={<PoliceVerification />} />
            <Route path="/reports"       element={user.role==='owner' ? <Reports /> : <Navigate to="/"/>} />
            <Route path="/salary"        element={user.role==='owner' ? <Salary />  : <Navigate to="/"/>} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/audit"         element={user.role==='owner' ? <AuditLog /> : <Navigate to="/"/>} />
            <Route path="/managers"      element={<Managers />} />
            <Route path="*"              element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter><ToastProvider><HostelProvider><AppShell /></HostelProvider></ToastProvider></BrowserRouter>
  );
}
