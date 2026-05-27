import React, { useState } from 'react';
import { authAPI } from '../utils/api';

export default function ForceChangePassword({ user, onDone }) {
  const [form, setForm]     = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.newPassword.length < 6) { setError('New password must be at least 6 characters'); return; }
    if (form.newPassword !== form.confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      await authAPI.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      onDone();
    } catch(err) {
      setError(err.response?.data?.message || 'Failed to change password');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:420 }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ fontSize:'2.5rem', marginBottom:10 }}>🔐</div>
          <div style={{ fontFamily:'Rajdhani,sans-serif', fontSize:'1.6rem', fontWeight:700, color:'var(--accent)', letterSpacing:2 }}>
            Change Password
          </div>
          <div style={{ color:'var(--text3)', fontSize:'0.82rem', marginTop:6 }}>
            Welcome, <strong style={{ color:'var(--text2)' }}>{user?.name}</strong>. You must set a new password before continuing.
          </div>
        </div>

        <div style={{ background:'var(--bg2)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:12, padding:'24px' }}>
          <div style={{ background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.2)', borderRadius:8, padding:'10px 14px', marginBottom:20, fontSize:'0.82rem', color:'var(--danger)' }}>
            ⚠️ Your password must be changed before you can use the system.
          </div>

          {error && (
            <div style={{ background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:6, padding:'10px 14px', marginBottom:16, color:'var(--danger)', fontSize:'0.83rem' }}>
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {[
              { key:'currentPassword', label:'Current Password', placeholder:'Your current / temporary password' },
              { key:'newPassword',     label:'New Password',     placeholder:'At least 6 characters' },
              { key:'confirm',         label:'Confirm Password', placeholder:'Re-enter new password' },
            ].map(f => (
              <div key={f.key} className="form-group" style={{ marginBottom:14 }}>
                <label>{f.label}</label>
                <div style={{ position:'relative' }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={form[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    required
                    style={{ paddingRight:40 }}
                  />
                  {f.key === 'newPassword' && (
                    <button type="button" onClick={() => setShowPw(p => !p)} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:'1rem', padding:0 }}>
                      {showPw ? '🙈' : '👁️'}
                    </button>
                  )}
                </div>
              </div>
            ))}

            <button type="submit" disabled={loading} style={{
              width:'100%', padding:'13px', border:'none', borderRadius:8,
              background:'var(--accent)', color:'#111',
              fontFamily:'Rajdhani', fontWeight:700, fontSize:'1rem', letterSpacing:1,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
            }}>
              {loading ? '⏳ Updating...' : '🔐 Set New Password & Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
