import React, { createContext, useContext, useState, useCallback } from 'react';
import { hostelAPI } from '../utils/api';

const HostelContext = createContext(null);

export function HostelProvider({ children }) {
  const [activeHostel, setActiveHostel] = useState(null);
  // A counter that increments every time the hostel changes.
  // Pages useEffect on this number to re-fetch when hostel switches.
  const [hostelSwitchCount, setHostelSwitchCount] = useState(0);

  const switchHostel = useCallback((hostel) => {
    localStorage.setItem('hm_hostel_id', hostel._id);
    setActiveHostel(hostel);
    setHostelSwitchCount(c => c + 1); // triggers re-fetch in all pages
  }, []);

  const loadHostel = useCallback(async () => {
    try {
      const r = await hostelAPI.getAll();
      const hostelId = localStorage.getItem('hm_hostel_id');
      const list = r.data || [];
      const h = hostelId ? list.find(x => x._id === hostelId) : list[0];
      const chosen = h || list[0];
      if (chosen) {
        localStorage.setItem('hm_hostel_id', chosen._id);
        setActiveHostel(chosen);
      }
    } catch (_) {}
  }, []);

  return (
    <HostelContext.Provider value={{ activeHostel, setActiveHostel, switchHostel, loadHostel, hostelSwitchCount }}>
      {children}
    </HostelContext.Provider>
  );
}

export const useHostel = () => useContext(HostelContext);
