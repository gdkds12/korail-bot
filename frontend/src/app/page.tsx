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
  '서울', '용산', '영등포', '광명', '수원', '천안아산', '오송', '대전', '김천구미', '동대구', '신경주', '울산', '부산',
  '포항', '마산', '창원중앙', '진주', '익산', '전주', '광주송정', '목포', '순천', '여수EXPO', '강릉', '평창', '안동'
];

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  
  // States
  const [fcmToken, setFcmToken] = useState('');
  const [korailId, setKorailId] = useState('');
  const [korailPw, setKorailPw] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('search');
  
  // Search params
  const [dep, setDep] = useState('서울');
  const [arr, setArr] = useState('부산');
  const [displayDate, setDisplayDate] = useState('');
  const [time, setTime] = useState('06');
  const [interval, setInterval] = useState(3.0);
  const [trains, setTrains] = useState<any[]>([]);
  
  // UI States
  const [showPicker, setShowPicker] = useState<'dep' | 'arr' | null>(null);
  
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
          setFcmToken(data.fcmToken || '');
          if (data.interval) setInterval(data.interval);
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
        fcmToken,
        interval
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

  const StationPicker = () => {
    if (!showPicker) return null;
    const currentVal = showPicker === 'dep' ? dep : arr;
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-300">
        <div className="bg-white border border-foreground/10 w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 max-h-[80vh] overflow-hidden flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-2xl font-light tracking-tight">{showPicker === 'dep' ? '출발역' : '도착역'} 선택</h3>
            <button onClick={() => setShowPicker(null)} className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center text-xl">✕</button>
          </div>
          <div className="grid grid-cols-3 gap-3 overflow-y-auto pr-2 custom-scrollbar">
            {MAJOR_STATIONS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  if (showPicker === 'dep') setDep(s);
                  else setArr(s);
                  setShowPicker(null);
                }}
                className={`py-4 rounded-2xl text-sm transition-all ${currentVal === s ? 'bg-foreground text-background font-bold' : 'bg-foreground/5 hover:bg-foreground/10'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-background overflow-hidden text-black">
        <div ref={heroRef} className={`w-full max-w-xl text-center transition-all duration-1000 ${heroVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}>
          <h1 className="text-6xl md:text-8xl font-light tracking-tighter mb-4">
            코레일<span className="text-foreground/30">봇</span>
          </h1>
          <p className="text-lg md:text-2xl font-light text-foreground/60 mb-12 tracking-tight px-4">
            가장 빠르고 편한 기차 예매 자동화
          </p>
          <div className="flex flex-col gap-4 items-center px-6">
            <MagneticButton size="lg" onClick={handleLogin} className="w-full max-w-xs py-6 text-base md:text-lg">
              Google 계정으로 시작하기
            </MagneticButton>
          </div>
          {message && <p className="mt-8 text-sm font-medium text-red-500 animate-pulse">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background pb-24 font-sans selection:bg-foreground selection:text-background text-black">
      <StationPicker />
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-foreground/5">
        <div className="max-w-5xl mx-auto px-4 md:px-6 flex items-center justify-center h-20 md:h-24">
          <div className="flex gap-2 bg-foreground/5 p-1.5 rounded-full w-full max-w-md">
            {[
              { id: 'search', label: '열차 조회' },
              { id: 'manage', label: `매크로 관리` },
              { id: 'settings', label: '설정' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3 md:py-4 rounded-full text-xs md:text-sm font-bold transition-all ${activeTab === tab.id ? 'bg-background text-foreground shadow-md' : 'text-foreground/40 hover:text-foreground hover:bg-foreground/5'}`}
              >
                {tab.id === 'manage' ? `${tab.label} (${Object.values(tasks).filter((t: any) => t.is_running).length})` : tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 md:px-6 mt-8 md:mt-12">
        {activeTab === 'search' ? (
          <div className="space-y-8 md:space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Search Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-foreground/10 pb-8 md:pb-12">
              <div className="space-y-1 md:space-y-2">
                <h2 className="text-3xl md:text-5xl font-light tracking-tighter">열차 검색</h2>
                <p className="text-sm md:text-base text-foreground/40 font-light">출발지와 도착지, 시간을 선택하세요.</p>
              </div>
              <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4 items-stretch md:items-end bg-foreground/5 p-4 md:p-6 rounded-[1.5rem] md:rounded-[2rem] border border-foreground/5 w-full md:w-auto shadow-sm">
                <div className="flex-1 grid grid-cols-2 md:flex md:flex-row gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-foreground/30 ml-2 text-center md:text-left">출발</label>
                    <button type="button" onClick={() => setShowPicker('dep')} className="bg-transparent border-none text-xl md:text-2xl font-bold py-1 px-4 hover:bg-foreground/5 rounded-xl transition-all">
                      {dep}
                    </button>
                  </div>
                  <div className="flex items-center justify-center md:pt-4">
                    <span className="text-foreground/20 text-2xl md:text-3xl font-light">→</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-foreground/30 ml-2 text-center md:text-left">도착</label>
                    <button type="button" onClick={() => setShowPicker('arr')} className="bg-transparent border-none text-xl md:text-2xl font-bold py-1 px-4 hover:bg-foreground/5 rounded-xl transition-all">
                      {arr}
                    </button>
                  </div>
                </div>
                <div className="w-full h-px bg-foreground/10 md:hidden" />
                <div className="w-px h-10 bg-foreground/10 hidden md:block" />
                <div className="grid grid-cols-2 md:flex md:flex-row gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-foreground/30 ml-2">날짜</label>
                    <input type="date" value={displayDate} onChange={e => setDisplayDate(e.target.value)} className="bg-transparent border-none text-base md:text-lg font-bold focus:ring-0 cursor-pointer p-0 px-2" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-foreground/30 ml-2">시간</label>
                    <select value={time} onChange={e => setTime(e.target.value)} className="bg-transparent border-none text-base md:text-lg font-bold focus:ring-0 cursor-pointer appearance-none px-2 py-1">
                      {Array.from({length: 24}, (_, i) => i).map(h => <option key={h} value={h.toString().padStart(2, '0')}>{h}시 이후</option>)}
                    </select>
                  </div>
                </div>
                <MagneticButton type="submit" disabled={loading} className="w-full md:w-auto md:ml-4 py-3 md:py-4">
                  {loading ? '조회중...' : '검색'}
                </MagneticButton>
              </form>
            </div>

            {/* Results Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 text-black">
              {trains.map((train, i) => (
                <div key={i} className="group relative bg-foreground/[0.02] hover:bg-foreground/[0.04] border border-foreground/5 rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 transition-all duration-500">
                  <div className="flex justify-between items-start mb-6 md:mb-8">
                    <div className="px-2 md:px-3 py-1 rounded-full bg-foreground/5 text-[9px] md:text-[10px] font-bold tracking-widest text-foreground/40 uppercase">
                      {train.train_name}
                    </div>
                    <div className={`text-xs font-bold ${train.reserve_possible ? 'text-green-600' : 'text-foreground/20'}`}>
                      {train.general_seat}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
                    <span className="text-3xl md:text-4xl font-light tracking-tighter">
                      {train.dep_time.substring(8, 10)}:{train.dep_time.substring(10, 12)}
                    </span>
                    <div className="flex-1 h-px bg-foreground/10 relative">
                      <div className="absolute right-0 -top-1 w-1.5 md:w-2 h-1.5 md:h-2 rounded-full bg-foreground/20" />
                    </div>
                    <span className="text-3xl md:text-4xl font-light tracking-tighter text-foreground/40">
                      {train.arr_time.substring(8, 10)}:{train.arr_time.substring(10, 12)}
                    </span>
                  </div>
                  <MagneticButton 
                    variant="secondary"
                    onClick={() => handleReserveLoop(train)}
                    disabled={Object.values(tasks).some((t: any) => t.is_running && t.train_no === train.train_no)}
                    className="w-full py-3 md:py-4 text-[10px] md:text-xs tracking-widest uppercase md:opacity-0 group-hover:opacity-100 transition-all duration-500 md:translate-y-4 group-hover:translate-y-0 shadow-sm"
                  >
                    {Object.values(tasks).some((t: any) => t.is_running && t.train_no === train.train_no) ? '감시 중' : '예약 대기'}
                  </MagneticButton>
                </div>
              ))}
              {trains.length === 0 && !loading && (
                <div className="col-span-full py-20 text-center text-foreground/20 font-light italic">
                  검색 결과가 여기에 표시됩니다.
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'manage' ? (
          <div className="space-y-8 md:space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="border-b border-foreground/10 pb-8 md:pb-12 text-black">
              <h2 className="text-3xl md:text-5xl font-light tracking-tighter">활성 작업</h2>
              <p className="text-sm md:text-base text-foreground/40 font-light mt-2">자동 예약 매크로의 실시간 현황입니다.</p>
            </div>
            
            {Object.keys(tasks).length === 0 ? (
              <div className="text-center py-20 md:py-32 border-2 border-dashed border-foreground/5 rounded-[2rem] md:rounded-[3rem]">
                <p className="text-foreground/20 text-lg md:text-xl font-light tracking-tight italic">실행 중인 예약 작업이 없습니다.</p>
              </div>
            ) : (
              <div className="grid gap-4 md:gap-6">
                {Object.values(tasks).map((task: any) => (
                  <div key={task.id} className={`group relative p-6 md:p-10 rounded-[1.5rem] md:rounded-[2.5rem] border-2 transition-all duration-700 ${task.is_running ? 'bg-foreground/[0.02] border-foreground/5' : 'bg-transparent border-foreground/5 opacity-50'}`}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 md:gap-8">
                      <div className="flex items-center gap-4 md:gap-6">
                        <div className={`w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center text-xl md:text-2xl ${task.status === 'SUCCESS' ? 'bg-green-500/10 text-green-500' : (task.is_running ? 'bg-foreground/5 text-foreground animate-pulse' : 'bg-foreground/5 text-foreground/20')}`}>
                          {task.status === 'SUCCESS' ? '✓' : '⚡'}
                        </div>
                        <div>
                          <span className="text-[9px] md:text-[10px] font-bold tracking-widest text-foreground/30 uppercase block mb-1">
                            {task.status}
                          </span>
                          <h3 className="text-xl md:text-3xl font-light tracking-tight">{task.train_name}</h3>
                        </div>
                      </div>
                      <div className="flex items-baseline justify-end md:justify-start gap-2">
                        <span className="text-4xl md:text-6xl font-light tracking-tighter">{task.attempts || 0}</span>
                        <span className="text-[9px] md:text-xs font-bold tracking-widest text-foreground/30 uppercase">회 시도</span>
                      </div>
                      <div className="flex gap-2 md:gap-3">
                        {task.is_running ? (
                          <MagneticButton variant="ghost" onClick={() => handleStopTask(task.id)} className="flex-1 md:flex-none text-red-500 hover:bg-red-500/5 px-4 md:px-8 py-3 md:py-4 text-xs">
                            정지
                          </MagneticButton>
                        ) : (
                          <MagneticButton variant="ghost" onClick={() => handleDeleteTask(task.id)} className="flex-1 md:flex-none text-foreground/40 hover:bg-foreground/5 px-4 md:px-8 py-3 md:py-4 text-xs">
                            기록 삭제
                          </MagneticButton>
                        )}
                      </div>
                    </div>
                    <div className="mt-6 md:mt-8 pt-6 md:pt-8 border-t border-foreground/5 flex justify-between items-center text-[9px] md:text-[10px] font-bold tracking-widest text-foreground/20 uppercase">
                      <span>ID: {task.id.substring(0, 8)}</span>
                      <span>최근 확인: {task.last_check}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-8 md:space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-2xl mx-auto text-black">
            <div className="text-center space-y-2 md:space-y-4 mb-8 md:mb-16">
              <h2 className="text-3xl md:text-5xl font-light tracking-tighter">계정 및 설정</h2>
              <p className="text-sm md:text-base text-foreground/40 font-light">코레일 계정 및 앱 설정을 관리합니다.</p>
            </div>

            <div className="bg-foreground/[0.02] border border-foreground/5 rounded-[2rem] md:rounded-[3rem] p-6 md:p-12 space-y-8 md:space-y-12 shadow-sm">
              <form onSubmit={saveSettings} className="space-y-8 md:space-y-10">
                <div className="grid gap-6 md:gap-8">
                  <div className="space-y-4">
                    <label className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase ml-2">코레일 계정</label>
                    <input type="text" value={korailId} onChange={e => setKorailId(e.target.value)} className="w-full bg-foreground/5 border-none rounded-xl md:rounded-2xl p-4 md:p-5 text-base md:text-lg font-light focus:ring-2 focus:ring-foreground/10 transition-all" placeholder="회원번호" />
                    <input type="password" value={korailPw} onChange={e => setKorailPw(e.target.value)} className="w-full bg-foreground/5 border-none rounded-xl md:rounded-2xl p-4 md:p-5 text-base md:text-lg font-light focus:ring-2 focus:ring-foreground/10 transition-all" placeholder="비밀번호" />
                  </div>
                  
                  <div className="space-y-4 pt-6 md:pt-8 border-t border-foreground/5">
                    <label className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase ml-2">매크로 설정</label>
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-light">조회 빈도 (새로고침 주기)</span>
                        <span className="text-lg font-bold">{interval}초</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.5" 
                        max="10" 
                        step="0.1" 
                        value={interval} 
                        onChange={e => setInterval(parseFloat(e.target.value))} 
                        className="w-full h-2 bg-foreground/10 rounded-lg appearance-none cursor-pointer accent-foreground"
                      />
                      <p className="text-[10px] text-foreground/30 mt-1">※ 너무 짧으면 코레일 서버에서 차단될 수 있습니다 (권장: 2.0초 이상)</p>
                    </div>
                  </div>
                </div>

                <div className="pt-6 md:pt-8 border-t border-foreground/5 space-y-4">
                  <label className="text-[10px] font-bold tracking-widest text-foreground/30 uppercase ml-2">스마트폰 알림</label>
                  <MagneticButton type="button" variant={fcmToken ? 'secondary' : 'primary'} onClick={handleEnablePush} className="w-full py-4 md:py-5 text-sm md:text-base">
                    {fcmToken ? '✓ 앱 푸시 알림 활성화됨' : '앱 푸시 권한 요청'}
                  </MagneticButton>
                  {fcmToken && (
                    <button type="button" onClick={handleTestPush} className="w-full text-[9px] md:text-[10px] font-bold tracking-widest text-foreground/20 uppercase hover:text-foreground transition-colors py-2">
                      10초 뒤 알림 테스트 실행
                    </button>
                  )}
                </div>

                <MagneticButton type="submit" className="w-full py-5 md:py-6 text-base md:text-lg">
                  설정 저장
                </MagneticButton>
              </form>
              
              <div className="pt-6 md:pt-8 border-t border-foreground/5 flex justify-center">
                <button onClick={handleLogout} className="text-[10px] md:text-xs font-bold tracking-widest text-red-500/40 hover:text-red-500 uppercase transition-colors">
                  계정 연결 해제 (로그아웃)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Persistent Message Overlay */}
      {message && (
        <div className="fixed bottom-8 md:bottom-12 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-8 duration-500 w-[90%] md:w-auto">
          <div className="bg-foreground text-background px-6 md:px-8 py-3 md:py-4 rounded-full text-[10px] md:text-xs font-bold tracking-widest uppercase shadow-2xl backdrop-blur-xl text-center">
            {message}
          </div>
        </div>
      )}
    </main>
  );
}