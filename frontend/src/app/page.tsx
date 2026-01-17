'use client';

import { useState, useEffect, useRef } from 'react';
import { auth, db, googleProvider, requestFcmToken } from '../lib/firebase';
import { signInWithPopup, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, setDoc, getDoc } from 'firebase/firestore';
import { getMessaging, onMessage } from 'firebase/messaging';
import { MagneticButton } from '@/components/magnetic-button';
import { useReveal } from '@/hooks/use-reveal';

const VAPID_KEY = "BPNkW11fORIDrPxfHtKT8QM65DSp6jfW2gHrKBy-Dmtxbzd52vq4Lrf1FZaPCEwPNC8fbfGCSFjGYn5ReHhI_fQ";

const MAJOR_STATIONS = [
  '서울', '용산', '광명', '천안아산', '오송', '대전', '김천구미', '동대구', '신경주', '울산', '부산',
  '수원', '평택', '천안', '조치원', '대구', '구포', '영등포', '안양', '익산', '전주', '광주송정', '목포', '순천', '여수EXPO', '포항', '마산', '창원중앙', '강릉'
].sort();

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  
  // States
  const [fcmToken, setFcmToken] = useState('');
  const [korailId, setKorailId] = useState('');
  const [korailPw, setKorailPw] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('search');
  
  // Telegram settings
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');

  // Search params
  const [dep, setDep] = useState('서울');
  const [arr, setArr] = useState('부산');
  const [displayDate, setDisplayDate] = useState('');
  const [time, setTime] = useState('06');
  const [interval, setInterval] = useState(3.0);
  const [trains, setTrains] = useState<any[]>([]);
  
  // Tasks from Firestore
  const [tasks, setTasks] = useState<any>({});

  // Reveal effect for hero
  const { ref: heroRef, isVisible: heroVisible } = useReveal(0.1);

  // Auto-hide message
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Auth & Initial Data Loading
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setDisplayDate(today);

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Foreground messaging
        try {
          const messaging = getMessaging();
          onMessage(messaging, (payload) => {
            if (payload.notification) {
              setMessage(`🔔 ${payload.notification.title}`);
            }
          });
        } catch (e) {}

        // Load User Settings
        const userRef = doc(db, 'users', u.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setKorailId(data.korailId || '');
          setKorailPw(data.korailPw || '');
          setTgToken(data.tgToken || '');
          setTgChatId(data.tgChatId || '');
          setFcmToken(data.fcmToken || '');
        }

        // Tasks Listener
        const q = query(collection(db, 'tasks'), where('uid', '==', u.uid));
        const unsubscribeTasks = onSnapshot(q, (snapshot) => {
          const newTasks: any = {};
          snapshot.forEach((doc) => {
            newTasks[doc.id] = { id: doc.id, ...doc.data() };
          });
          setTasks(newTasks);
        });
        return () => unsubscribeTasks();
      } else {
        setTasks({});
      }
    });

    return () => unsubscribeAuth();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setMessage('✅ 로그인 성공');
    } catch (e: any) {
      setMessage(`❌ 로그인 실패: ${e.code || e.message}`);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setMessage('👋 로그아웃');
  };

  const saveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), {
        korailId,
        korailPw,
        tgToken,
        tgChatId,
        fcmToken
      }, { merge: true });
      setMessage('✅ 설정이 저장되었습니다.');
    } catch (e) {
      setMessage('⚠️ 저장 실패');
    }
  };

  const handleEnablePush = async () => {
    const token = await requestFcmToken(VAPID_KEY);
    if (token) {
      setFcmToken(token);
      setMessage('🔔 푸시 알림이 활성화되었습니다!');
    } else {
      setMessage('❌ 푸시 권한을 허용해야 합니다.');
    }
  };

  const handleTestPush = async () => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'tasks'), {
        uid: user.uid,
        type: 'TEST_NOTIFICATION',
        is_running: true,
        status: 'PENDING',
        createdAt: new Date(),
        train_name: '테스트 열차'
      });
      setMessage('⏳ 10초 뒤에 알림이 발송됩니다...');
    } catch (e) {
      setMessage('❌ 요청 실패');
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setTrains([]);
    setMessage('⏳ 조회 요청 중...');

    try {
      const reqRef = await addDoc(collection(db, 'search_requests'), {
        uid: user.uid,
        dep,
        arr,
        date: displayDate.replace(/-/g, ''),
        time: time.padStart(2, '0') + '0000',
        createdAt: new Date(),
        status: 'PENDING'
      });

      const unsubscribe = onSnapshot(doc(db, 'search_requests', reqRef.id), (docSnap) => {
        const data = docSnap.data();
        if (data && data.status === 'COMPLETED') {
          setTrains(data.results || []);
          setMessage(`📅 ${data.results?.length || 0}개 열차 조회됨`);
          setLoading(false);
          unsubscribe();
        } else if (data && data.status === 'ERROR') {
          setMessage(`❌ 오류: ${data.error}`);
          setLoading(false);
          unsubscribe();
        }
      });

      setTimeout(() => {
        setLoading((currentLoading) => {
          if (currentLoading) setMessage('⚠️ 응답이 지연되고 있습니다...');
          return currentLoading;
        });
      }, 15000);

    } catch (e) {
      setMessage('⚠️ 요청 실패');
      setLoading(false);
    }
  };

  const handleReserveLoop = async (train: any) => {
    if (!user) return;
    if (!korailId || !korailPw) {
      alert('⚠️ 먼저 설정 탭에서 코레일 계정을 저장해주세요.');
      setActiveTab('settings');
      return;
    }
    
    try {
      await addDoc(collection(db, 'tasks'), {
        uid: user.uid,
        train_no: train.train_no,
        train_name: train.train_name,
        dep_date: train.dep_date,
        dep_time: train.dep_time,
        dep_name: train.dep_name,
        arr_name: train.arr_name,
        interval: interval,
        is_running: true,
        status: 'RUNNING',
        attempts: 0,
        createdAt: new Date(),
        last_check: '-'
      });
      setMessage('🚀 예약 작업이 추가되었습니다.');
    } catch (e) {
      alert('⚠️ 작업 추가 실패');
    }
  };

  const handleStopTask = async (taskId: string) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        is_running: false,
        status: 'STOPPED'
      });
    } catch (e) {}
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'tasks', taskId));
      setMessage('🗑️ 작업이 삭제되었습니다.');
    } catch (e) {
      setMessage('⚠️ 삭제 실패');
    }
  };

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div ref={heroRef} className={`w-full max-w-xl text-center transition-all duration-1000 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}>
          <h1 className="text-6xl md:text-8xl font-light tracking-tighter mb-4 text-foreground">
            Korail<span className="text-foreground/30">Bot</span>
          </h1>
          <p className="text-xl md:text-2xl font-light text-foreground/60 mb-12 tracking-tight">
            Seamless travel, automated.
          </p>
          <div className="flex flex-col gap-4 items-center">
            <MagneticButton size="lg" onClick={handleLogin} className="w-64 py-6 text-lg">
              Get Started with Google
            </MagneticButton>
          </div>
          {message && <p className="mt-8 text-sm font-medium text-red-500 animate-pulse">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background pb-24 font-sans selection:bg-foreground selection:text-background">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-foreground/5">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between h-20">
          <div className="text-2xl font-light tracking-tighter text-foreground">
            Korail<span className="text-foreground/30">Bot</span>
          </div>
          <div className="flex gap-1 bg-foreground/5 p-1 rounded-full">
            {[
              { id: 'search', label: 'Search', icon: '🔍' },
              { id: 'manage', label: `Manage (${Object.values(tasks).filter((t: any) => t.is_running).length})`, icon: '⚡' },
              { id: 'settings', label: 'Settings', icon: '⚙️' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-2 rounded-full text-xs font-medium transition-all ${activeTab === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-foreground/40 hover:text-foreground'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 mt-12">
        {activeTab === 'search' ? (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Search Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 border-b border-foreground/10 pb-12">
              <div className="space-y-2">
                <h2 className="text-5xl font-light tracking-tighter text-foreground">Find Trains</h2>
                <p className="text-foreground/40 font-light">Select your destination and preferred time.</p>
              </div>
              <form onSubmit={handleSearch} className="flex flex-wrap gap-4 items-end bg-foreground/5 p-6 rounded-[2rem] border border-foreground/5">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-foreground/30 ml-2">From</label>
                  <select value={dep} onChange={e => setDep(e.target.value)} className="bg-transparent border-none text-lg font-light focus:ring-0 cursor-pointer">
                    {MAJOR_STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="w-px h-10 bg-foreground/10 hidden md:block" />
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-foreground/30 ml-2">To</label>
                  <select value={arr} onChange={e => setArr(e.target.value)} className="bg-transparent border-none text-lg font-light focus:ring-0 cursor-pointer">
                    {MAJOR_STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="w-px h-10 bg-foreground/10 hidden md:block" />
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-foreground/30 ml-2">Date</label>
                  <input type="date" value={displayDate} onChange={e => setDisplayDate(e.target.value)} className="bg-transparent border-none text-lg font-light focus:ring-0 cursor-pointer p-0" />
                </div>
                <MagneticButton type="submit" disabled={loading} className="ml-4">
                  {loading ? '...' : 'Search'}
                </MagneticButton>
              </form>
            </div>

            {/* Results Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {trains.map((train, i) => (
                <div key={i} className="group relative bg-foreground/[0.02] hover:bg-foreground/[0.04] border border-foreground/5 rounded-[2rem] p-8 transition-all duration-500">
                  <div className="flex justify-between items-start mb-8">
                    <div className="px-3 py-1 rounded-full bg-foreground/5 text-[10px] font-bold tracking-widest text-foreground/40 uppercase">
                      {train.train_name}
                    </div>
                    <div className={`text-xs font-medium ${train.reserve_possible ? 'text-green-500' : 'text-foreground/20'}`}>
                      {train.general_seat}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mb-8">
                    <span className="text-4xl font-light tracking-tighter text-foreground">
                      {train.dep_time.substring(8, 10)}:{train.dep_time.substring(10, 12)}
                    </span>
                    <div className="flex-1 h-px bg-foreground/10 relative">
                      <div className="absolute right-0 -top-1 w-2 h-2 rounded-full bg-foreground/20" />
                    </div>
                    <span className="text-4xl font-light tracking-tighter text-foreground/40">
                      {train.arr_time.substring(8, 10)}:{train.arr_time.substring(10, 12)}
                    </span>
                  </div>
                  <MagneticButton 
                    variant="secondary"
                    onClick={() => handleReserveLoop(train)}
                    disabled={Object.values(tasks).some((t: any) => t.is_running && t.train_no === train.train_no)}
                    className="w-full py-4 text-xs tracking-widest uppercase opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-4 group-hover:translate-y-0"
                  >
                    {Object.values(tasks).some((t: any) => t.is_running && t.train_no === train.train_no) ? 'Monitoring' : 'Standby'}
                  </MagneticButton>
                </div>
              ))}
            </div>
          </div>
        ) : activeTab === 'manage' ? (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="border-b border-foreground/10 pb-12">
              <h2 className="text-5xl font-light tracking-tighter text-foreground">Active Tasks</h2>
              <p className="text-foreground/40 font-light mt-2">Real-time status of your automated reservations.</p>
            </div>
            
            {Object.keys(tasks).length === 0 ? (
              <div className="text-center py-32 border-2 border-dashed border-foreground/5 rounded-[3rem]">
                <p className="text-foreground/20 text-xl font-light tracking-tight italic">No active monitoring sessions.</p>
              </div>
            ) : (
              <div className="grid gap-6">
                {Object.values(tasks).map((task: any) => (
                  <div key={task.id} className={`group relative p-10 rounded-[2.5rem] border-2 transition-all duration-700 ${task.is_running ? 'bg-foreground/[0.02] border-foreground/5' : 'bg-transparent border-foreground/5 opacity-50'}`}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                      <div className="flex items-center gap-6">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl ${task.status === 'SUCCESS' ? 'bg-green-500/10 text-green-500' : (task.is_running ? 'bg-foreground/5 text-foreground animate-pulse' : 'bg-foreground/5 text-foreground/20')}`}>
                          {task.status === 'SUCCESS' ? '✓' : '⚡'}
                        </div>
                        <div>
                          <span className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase block mb-1">
                            {task.status}
                          </span>
                          <h3 className="text-3xl font-light tracking-tight text-foreground">{task.train_name}</h3>
                        </div>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-6xl font-light tracking-tighter text-foreground">{task.attempts || 0}</span>
                        <span className="text-xs font-bold tracking-widest text-foreground/30 uppercase">tries</span>
                      </div>
                      <div className="flex gap-3">
                        {task.is_running ? (
                          <MagneticButton variant="ghost" onClick={() => handleStopTask(task.id)} className="text-red-500 hover:bg-red-500/5 px-8 py-4">
                            Stop
                          </MagneticButton>
                        ) : (
                          <MagneticButton variant="ghost" onClick={() => handleDeleteTask(task.id)} className="text-foreground/40 hover:bg-foreground/5 px-8 py-4">
                            Clear
                          </MagneticButton>
                        )}
                      </div>
                    </div>
                    <div className="mt-8 pt-8 border-t border-foreground/5 flex justify-between items-center text-[10px] font-bold tracking-widest text-foreground/20 uppercase">
                      <span>Ref: {task.id.substring(0, 8)}</span>
                      <span>Last checked: {task.last_check}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-2xl mx-auto">
            <div className="text-center space-y-4 mb-16">
              <h2 className="text-5xl font-light tracking-tighter text-foreground">Account</h2>
              <p className="text-foreground/40 font-light">Manage your credentials and notifications.</p>
            </div>

            <div className="bg-foreground/[0.02] border border-foreground/5 rounded-[3rem] p-12 space-y-12">
              <form onSubmit={saveSettings} className="space-y-10">
                <div className="grid gap-8">
                  <div className="space-y-4">
                    <label className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase ml-2">Korail Account</label>
                    <input type="text" value={korailId} onChange={e => setKorailId(e.target.value)} className="w-full bg-foreground/5 border-none rounded-2xl p-5 text-lg font-light focus:ring-2 focus:ring-foreground/10 transition-all" placeholder="Membership Number" />
                    <input type="password" value={korailPw} onChange={e => setKorailPw(e.target.value)} className="w-full bg-foreground/5 border-none rounded-2xl p-5 text-lg font-light focus:ring-2 focus:ring-foreground/10 transition-all" placeholder="Password" />
                  </div>
                  <div className="space-y-4 pt-8 border-t border-foreground/5">
                    <label className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase ml-2">Telegram Integration (Optional)</label>
                    <input type="text" value={tgToken} onChange={e => setTgToken(e.target.value)} className="w-full bg-foreground/5 border-none rounded-2xl p-5 text-sm font-light focus:ring-2 focus:ring-foreground/10 transition-all" placeholder="Bot Token" />
                    <input type="text" value={tgChatId} onChange={e => setTgChatId(e.target.value)} className="w-full bg-foreground/5 border-none rounded-2xl p-5 text-sm font-light focus:ring-2 focus:ring-foreground/10 transition-all" placeholder="Chat ID" />
                  </div>
                </div>

                <div className="pt-8 border-t border-foreground/5 space-y-4">
                  <label className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase ml-2">Device Notifications</label>
                  <MagneticButton type="button" variant={fcmToken ? 'secondary' : 'primary'} onClick={handleEnablePush} className="w-full py-5">
                    {fcmToken ? '✓ Notifications Enabled' : 'Enable Push Notifications'}
                  </MagneticButton>
                  {fcmToken && (
                    <button type="button" onClick={handleTestPush} className="w-full text-[10px] font-bold tracking-widest text-foreground/20 uppercase hover:text-foreground transition-colors">
                      Test 10s Delay Notification
                    </button>
                  )}
                </div>

                <MagneticButton type="submit" className="w-full py-6 text-lg">
                  Save Changes
                </MagneticButton>
              </form>
              
              <div className="pt-8 border-t border-foreground/5 flex justify-center">
                <button onClick={handleLogout} className="text-xs font-bold tracking-widest text-red-500/40 hover:text-red-500 uppercase transition-colors">
                  Disconnect Account
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Persistent Message Overlay */}
      {message && (
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="bg-foreground text-background px-8 py-4 rounded-full text-xs font-bold tracking-widest uppercase shadow-2xl backdrop-blur-xl">
            {message}
          </div>
        </div>
      )}
    </main>
  );
}
